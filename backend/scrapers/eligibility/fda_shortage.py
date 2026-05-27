"""FDA Drug Shortage list scraper — US.

Source: https://www.accessdata.fda.gov/scripts/drugshortages/

Page structure (verified):
  <table id="cont"> — Currently in Shortage. Two cols: Generic Name | Status
  <table id="dis">  — Discontinued / Resolved. One col: Generic Name

The page is server-rendered (DataTables enhances it client-side, but the
underlying HTML carries the data). We scrape the static HTML and map
status → eligibility:
  Currently in Shortage / Currently in shortage → status='active'
  any row in #dis                                → status='lapsed'

Each FDA shortage entry gates many emergency pathways (503A/B compounding,
hospital-pharmacy exemptions). Being on the list IS the eligibility signal.

Run:
    source .env
    python3 -m backend.scrapers.eligibility.fda_shortage
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from typing import Iterable

from .base import EligibilityRow, EligibilityScraper


class _IdTableExtractor(HTMLParser):
    """Extracts only tables that carry one of the named IDs."""

    def __init__(self, want_ids: set[str]) -> None:
        super().__init__()
        self.want_ids = want_ids
        self.tables: dict[str, list[list[str]]] = {}
        self._cur_id: str | None = None
        self._t = False; self._r = False; self._c = False
        self._tab: list[list[str]] = []
        self._row: list[str] = []
        self._cell: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        a = dict(attrs)
        if tag == "table":
            tid = a.get("id")
            if tid in self.want_ids:
                self._t = True; self._tab = []; self._cur_id = tid
            else:
                self._t = False; self._cur_id = None
        elif tag == "tr" and self._t:
            self._r = True; self._row = []
        elif tag in ("td", "th") and self._r:
            self._c = True; self._cell = []

    def handle_endtag(self, tag: str):
        if tag in ("td", "th") and self._c:
            self._row.append(" ".join("".join(self._cell).split()))
            self._c = False
        elif tag == "tr" and self._r:
            if self._row: self._tab.append(self._row)
            self._r = False
        elif tag == "table" and self._t:
            if self._tab and self._cur_id:
                self.tables[self._cur_id] = self._tab
            self._t = False; self._cur_id = None

    def handle_data(self, d: str):
        if self._c: self._cell.append(d)


def _normalize_status(s: str) -> str:
    s = s.lower().strip()
    if "shortage" in s or "current" in s:
        return "active"
    if "resolved" in s or "discontinued" in s:
        return "lapsed"
    return "active"  # default — defer to base's missing-as-lapsed pass


class FdaShortageList(EligibilityScraper):
    SCHEME = "fda_shortage"
    COUNTRY_CODE = "US"
    SOURCE_NAME = "FDA Drug Shortage list"
    SOURCE_URL = "https://www.accessdata.fda.gov/scripts/drugshortages/"

    def fetch(self) -> str:
        return self._http_get(self.SOURCE_URL).decode("utf-8", "replace")

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        ex = _IdTableExtractor({"cont", "dis"})
        ex.feed(payload)
        if not ex.tables:
            self.log("no matching tables (#cont, #dis) found; page layout may have changed", level="warning")
            return []

        rows: list[EligibilityRow] = []

        # Currently in Shortage table — col 0 = Generic, col 1 = Status
        cont = ex.tables.get("cont", [])
        for r in cont[1:]:  # skip header row
            if not r:
                continue
            generic = r[0].strip()
            if not generic:
                continue
            status_str = r[1] if len(r) > 1 else "Currently in Shortage"
            rows.append(EligibilityRow(
                generic_name=generic,
                country_code=self.COUNTRY_CODE,
                scheme=self.SCHEME,
                status=_normalize_status(status_str),
                # The FDA page doesn't publish a stable shortage ID per row
                # — use the generic name + table marker as the conflict key
                # via the fallback uniqueness index in migration 040.
                scheme_reference=f"FDA-DSL:{re.sub(r'[^A-Za-z0-9]+', '_', generic).strip('_')}",
                description=status_str,
                source_url=self.SOURCE_URL,
                source_name=self.SOURCE_NAME,
                raw_data={"row": r, "table": "cont"},
            ))

        # Discontinued / Resolved table — col 0 = Generic
        dis = ex.tables.get("dis", [])
        for r in dis[1:]:  # skip header
            if not r:
                continue
            generic = r[0].strip()
            if not generic:
                continue
            rows.append(EligibilityRow(
                generic_name=generic,
                country_code=self.COUNTRY_CODE,
                scheme=self.SCHEME,
                status="lapsed",
                scheme_reference=f"FDA-DSL:{re.sub(r'[^A-Za-z0-9]+', '_', generic).strip('_')}",
                description="Resolved / discontinued per FDA Drug Shortage list",
                source_url=self.SOURCE_URL,
                source_name=self.SOURCE_NAME,
                raw_data={"row": r, "table": "dis"},
            ))
        return rows


if __name__ == "__main__":
    summary = FdaShortageList().run()
    print(summary)
    sys.exit(0 if summary["errors"] == 0 else 1)
