"""NHSBSA Serious Shortage Protocol (SSP) scraper — UK.

Source: https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/serious-shortage-protocols-ssps

The NHSBSA renders two HTML tables on the page:

  Active SSPs (table 0)
    cols: Name / ref no | Start and end date | Supporting guidance
    sample: "SSP087 Ramipril 1.25 mg capsules (PDF:240KB)"
            "22 April 2026 to 29 May 2026"
            "Ramipril 1.25 mg capsules supporting guidance plus Q&A"

  Expired SSPs (table 1)
    Same column layout. Date cell may contain "to <end>This SSP was
    withdrawn early on <date>" or "...This SSP was amended on <date>".

Strategy:
  1. Fetch the page (server returns 403 to default UAs; base.py uses a
     browser-style User-Agent that works).
  2. Walk both tables. Map active → status='active'; expired → status='lapsed'
     with a withdrawn_at parsed from the trailing prose where present.
  3. Use the SSP reference (e.g. SSP087) as scheme_reference — the page's
     stable identifier.

Run:
    source .env
    python3 -m backend.scrapers.eligibility.mhra_ssp
"""

from __future__ import annotations

import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from typing import Iterable

from .base import EligibilityRow, EligibilityScraper


class _TableExtractor(HTMLParser):
    """Multi-table extractor — returns list[list[list[str]]] of rows×cells."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._t = False; self._r = False; self._c = False
        self._tab: list[list[str]] = []
        self._row: list[str] = []
        self._cell: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag == "table": self._t = True; self._tab = []
        elif tag == "tr" and self._t: self._r = True; self._row = []
        elif tag in ("td", "th") and self._r: self._c = True; self._cell = []

    def handle_endtag(self, tag: str):
        if tag in ("td", "th") and self._c:
            self._row.append(" ".join("".join(self._cell).split()))
            self._c = False
        elif tag == "tr" and self._r:
            if self._row: self._tab.append(self._row)
            self._r = False
        elif tag == "table" and self._t:
            if self._tab: self.tables.append(self._tab)
            self._t = False

    def handle_data(self, d: str):
        if self._c: self._cell.append(d)


SSP_REF_RE = re.compile(r"\bSSP\d{3,4}\b", re.IGNORECASE)
DATE_RE = re.compile(r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})")
DATE_FORMATS = ("%d %B %Y", "%d %b %Y")


def _parse_date(s: str) -> str | None:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _strip_pdf_suffix(s: str) -> str:
    """Remove trailing '(PDF:240KB)' and similar size annotations."""
    return re.sub(r"\s*\(PDF[^)]*\)\s*", "", s).strip()


def _parse_name_cell(cell: str) -> tuple[str | None, str]:
    """Return (ssp_ref, drug_name_with_strength)."""
    m = SSP_REF_RE.search(cell)
    ref = m.group(0).upper() if m else None
    rest = cell[m.end():] if m else cell
    return ref, _strip_pdf_suffix(rest)


def _parse_date_cell(cell: str) -> tuple[str | None, str | None, str | None]:
    """Return (listed_at, expires_at, withdrawn_at) from 'start to end[Notes]'."""
    dates = DATE_RE.findall(cell)
    listed_at = _parse_date(dates[0]) if len(dates) >= 1 else None
    expires_at = _parse_date(dates[1]) if len(dates) >= 2 else None
    withdrawn_at: str | None = None
    m = re.search(r"withdrawn\s+early\s+on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", cell, re.IGNORECASE)
    if m:
        withdrawn_at = _parse_date(m.group(1))
    return listed_at, expires_at, withdrawn_at


class NhsbsaSsp(EligibilityScraper):
    SCHEME = "mhra_ssp"
    COUNTRY_CODE = "GB"
    SOURCE_NAME = "NHSBSA Serious Shortage Protocols"
    SOURCE_URL = (
        "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/"
        "serious-shortage-protocols-ssps"
    )

    def fetch(self) -> str:
        return self._http_get(self.SOURCE_URL).decode("utf-8", "replace")

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        ex = _TableExtractor()
        ex.feed(payload)
        if not ex.tables:
            self.log("no tables found; layout may have changed", level="warning")
            return []

        rows: list[EligibilityRow] = []
        for i, table in enumerate(ex.tables):
            if len(table) < 2:
                continue
            headers = [h.lower() for h in table[0]]
            if not any("ssp" in h or "name" in h for h in headers):
                continue
            status_default = "active" if i == 0 else "lapsed"
            for r in table[1:]:
                if len(r) < 2:
                    continue
                ref, name = _parse_name_cell(r[0])
                if not name:
                    continue
                listed_at, expires_at, withdrawn_at = _parse_date_cell(r[1] if len(r) > 1 else "")
                guidance = _strip_pdf_suffix(r[2]) if len(r) > 2 else None
                description = (
                    f"Permitted substitution per NHSBSA SSP {ref or ''}. {guidance}".strip()
                    if guidance else None
                )
                effective_status = status_default
                if status_default == "active" and withdrawn_at:
                    effective_status = "lapsed"
                rows.append(EligibilityRow(
                    generic_name=name,
                    country_code=self.COUNTRY_CODE,
                    scheme=self.SCHEME,
                    status=effective_status,
                    scheme_reference=ref,
                    description=description,
                    listed_at=listed_at,
                    expires_at=expires_at,
                    withdrawn_at=withdrawn_at,
                    source_url=self.SOURCE_URL,
                    source_name=self.SOURCE_NAME,
                    raw_data={"row": r, "headers": table[0], "table_index": i},
                ))
        return rows


if __name__ == "__main__":
    summary = NhsbsaSsp().run()
    print(summary)
    sys.exit(0 if summary["errors"] == 0 else 1)
