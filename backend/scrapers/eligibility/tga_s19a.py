"""TGA Section 19A approvals scraper.

Source: https://www.tga.gov.au/resources/section-19a-approvals

The TGA publishes the full Section 19A approvals register as an HTML table
with one row per approval. Each row carries:
  • The substance / overseas product name
  • The Australian shortage being addressed
  • The approval holder (sponsor)
  • The approval reference number
  • Dates (granted, expiry / lapse)

This scraper hits the page, extracts the table, and upserts one row per
approval into regulatory_eligibility with scheme='tga_s19a'.

Run:
    source .env  # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    python3 -m backend.scrapers.eligibility.tga_s19a
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from typing import Any, Iterable

from .base import EligibilityRow, EligibilityScraper


class _TableExtractor(HTMLParser):
    """Minimal HTML table extractor — returns list[list[str]] of rows×cells."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._cell_text: list[str] = []
        self._row: list[str] = []
        self._table: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs):
        if tag == "table":
            self._in_table = True; self._table = []
        elif tag == "tr" and self._in_table:
            self._in_row = True; self._row = []
        elif tag in ("td", "th") and self._in_row:
            self._in_cell = True; self._cell_text = []

    def handle_endtag(self, tag: str):
        if tag in ("td", "th") and self._in_cell:
            self._row.append("".join(self._cell_text).strip())
            self._in_cell = False
        elif tag == "tr" and self._in_row:
            if self._row:
                self._table.append(self._row)
            self._in_row = False
        elif tag == "table" and self._in_table:
            if self._table:
                self.tables.append(self._table)
            self._in_table = False

    def handle_data(self, data: str):
        if self._in_cell:
            self._cell_text.append(data)


class TgaSection19A(EligibilityScraper):
    SCHEME = "tga_s19a"
    COUNTRY_CODE = "AU"
    SOURCE_NAME = "TGA Section 19A approvals"
    SOURCE_URL = "https://www.tga.gov.au/resources/section-19a-approvals"

    def fetch(self) -> str:
        return self._http_get(self.SOURCE_URL).decode("utf-8", "replace")

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        ex = _TableExtractor()
        ex.feed(payload)

        # The published page contains a single substantive table — the approvals
        # register — usually with a header row. Pick the largest table on the
        # page and treat its first row as headers; map columns by name.
        if not ex.tables:
            self.log("no tables found on page; layout may have changed", level="warning")
            return []

        table = max(ex.tables, key=len)
        if len(table) < 2:
            return []

        headers = [self._slug(h) for h in table[0]]
        idx = {h: i for i, h in enumerate(headers)}

        # Tolerate slight header naming changes by searching for keywords.
        def col(*candidates: str) -> int | None:
            for c in candidates:
                for h, i in idx.items():
                    if c in h:
                        return i
            return None

        i_product = col("overseas", "product", "medicine")
        i_substance = col("substance", "active", "ingredient")
        i_sponsor = col("sponsor", "holder", "applicant")
        i_ref = col("approval", "reference", "number")
        i_granted = col("granted", "approved", "issued", "from", "start")
        i_expires = col("lapse", "expiry", "expires", "until", "end")

        rows: list[EligibilityRow] = []
        for r in table[1:]:
            if len(r) < 2:
                continue
            substance = (r[i_substance] if i_substance is not None and i_substance < len(r) else "").strip()
            product = (r[i_product] if i_product is not None and i_product < len(r) else "").strip()
            # generic_name = substance (preferred) else product
            generic = substance or product
            if not generic:
                continue
            sponsor = (r[i_sponsor] if i_sponsor is not None and i_sponsor < len(r) else "").strip() or None
            ref = (r[i_ref] if i_ref is not None and i_ref < len(r) else "").strip() or None
            granted = self._parse_date(r[i_granted]) if i_granted is not None and i_granted < len(r) else None
            expires = self._parse_date(r[i_expires]) if i_expires is not None and i_expires < len(r) else None
            description = product if (substance and product) else None

            rows.append(EligibilityRow(
                generic_name=generic,
                brand_name=product if product != generic else None,
                country_code=self.COUNTRY_CODE,
                scheme=self.SCHEME,
                status="active",  # base will mark missing-on-next-run as lapsed
                scheme_reference=ref,
                description=description and f"Overseas-registered: {description}. Sponsor: {sponsor or 'unknown'}",
                listed_at=granted,
                expires_at=expires,
                source_url=self.SOURCE_URL,
                source_name=self.SOURCE_NAME,
                raw_data={"row": r, "headers": headers},
            ))
        return rows

    # ── helpers ──
    @staticmethod
    def _slug(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", s.strip().lower()).strip("_")

    @staticmethod
    def _parse_date(s: str) -> str | None:
        s = (s or "").strip()
        if not s:
            return None
        # TGA uses "DD Month YYYY" most commonly
        from datetime import datetime
        for fmt in ("%d %B %Y", "%d %b %Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return None


if __name__ == "__main__":
    summary = TgaSection19A().run()
    print(summary)
    sys.exit(0 if summary["errors"] == 0 else 1)
