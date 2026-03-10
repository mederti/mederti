"""
PMDA Japanese Drug Shortage Scraper
────────────────────────────────────
Source:  PMDA — Pharmaceuticals and Medical Devices Agency (Japan)
URL:     https://www.pmda.go.jp/safety/info-services/drugs/shortages/0001.html

Data access
───────────
PMDA publishes shortage information as an HTML table at the above URL.
The page lists drugs with manufacturing suspensions and supply disruptions.
PMDA also publishes periodic Excel files with shortage details.

HTML table columns (Japanese → English):
    販売名        → brand name (product name)
    成分名        → generic name (active ingredient)
    製造販売業者   → manufacturer/MAH
    規格          → specification/strength
    措置内容      → measure/action taken
    措置年月日    → measure date

Alternative: Excel file at /files/000247895.xlsx (static — may change)

Data source UUID:  10000000-0000-0000-0000-000000000032  (PMDA, JP)
Country:           Japan
Country code:      JP
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from bs4 import BeautifulSoup

import httpx

from backend.scrapers.base_scraper import BaseScraper


class PmdaScraper(BaseScraper):
    """Scraper for PMDA Japanese drug shortage data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000037"
    SOURCE_NAME:  str = "PMDA (Pharmaceuticals and Medical Devices Agency, Japan)"
    BASE_URL:     str = "https://www.pmda.go.jp/safety/info-services/drugs/shortages/0001.html"
    COUNTRY:      str = "Japan"
    COUNTRY_CODE: str = "JP"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "ja,en;q=0.8",
        "Referer":         "https://www.pmda.go.jp/",
    }

    # Regex for Japanese dates: YYYY年MM月DD日
    _DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> str:
        """GET the PMDA drug shortage HTML page."""
        self.log.info("Fetching PMDA shortage page", extra={"url": self.BASE_URL})
        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()
        self.log.info("PMDA page fetched", extra={"bytes": len(resp.content), "status": resp.status_code})
        return resp.text

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: str) -> list[dict]:
        """
        Parse PMDA HTML table and extract shortage records.

        Handles:
        - Standard <table> with <tr>/<td> rows
        - Multi-row entries (rowspan)
        - Japanese date format: YYYY年MM月DD日
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed. Run: pip install beautifulsoup4")
            return []

        soup = BeautifulSoup(raw, "html.parser")
        tables = soup.find_all("table")

        if not tables:
            self.log.warning("PMDA: no tables found in HTML")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        for table in tables:
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue

            # Detect header row to determine column positions
            headers = [th.get_text(strip=True) for th in rows[0].find_all(["th", "td"])]
            if not any(h for h in headers if h):
                continue

            # Column index map (best-effort Japanese header matching)
            col_map = self._map_columns(headers)
            if not col_map.get("name_col") and not col_map.get("generic_col"):
                continue  # Not a shortage table

            for row in rows[1:]:
                cells = row.find_all(["td", "th"])
                if not cells:
                    continue

                try:
                    def cell(idx: int) -> str:
                        if idx is None or idx >= len(cells):
                            return ""
                        return cells[idx].get_text(" ", strip=True)

                    brand_name   = cell(col_map.get("name_col"))
                    generic_name = cell(col_map.get("generic_col")) or brand_name
                    manufacturer = cell(col_map.get("mfr_col"))
                    date_raw     = cell(col_map.get("date_col"))
                    measure      = cell(col_map.get("measure_col"))

                    if not generic_name or len(generic_name) < 2:
                        skipped += 1
                        continue

                    start_date = self._parse_jp_date(date_raw) or today

                    notes_parts = ["Japanese drug shortage from PMDA."]
                    if manufacturer: notes_parts.append(f"Manufacturer: {manufacturer}.")
                    if measure:      notes_parts.append(f"Measure: {measure}.")

                    normalised.append({
                        "generic_name":    generic_name,
                        "brand_names":     [brand_name] if brand_name != generic_name else [],
                        "status":          "active",
                        "severity":        "medium",
                        "reason_category": "manufacturing_issue",
                        "start_date":      start_date,
                        "source_url":      self.BASE_URL,
                        "notes":           " ".join(notes_parts),
                        "raw_record": {
                            "brand_name":   brand_name,
                            "generic_name": generic_name,
                            "manufacturer": manufacturer,
                            "date_raw":     date_raw,
                            "measure":      measure,
                        },
                    })
                except Exception as exc:
                    skipped += 1
                    self.log.warning("PMDA: row parse error", extra={"error": str(exc)})

        self.log.info(
            "PMDA normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped, "tables": len(tables)},
        )
        return normalised

    def _map_columns(self, headers: list[str]) -> dict:
        """Map header text to column indices for PMDA table."""
        col_map: dict = {}
        for i, h in enumerate(headers):
            if any(w in h for w in ["販売名", "商品名", "品名", "製品名"]):
                col_map["name_col"] = i
            elif any(w in h for w in ["成分名", "一般名", "有効成分"]):
                col_map["generic_col"] = i
            elif any(w in h for w in ["製造販売業者", "製造業者", "会社"]):
                col_map["mfr_col"] = i
            elif any(w in h for w in ["年月日", "措置年", "日付", "日"]):
                col_map["date_col"] = i
            elif any(w in h for w in ["措置", "内容", "状況"]):
                col_map["measure_col"] = i
        return col_map

    def _parse_jp_date(self, raw: str) -> str | None:
        """Parse Japanese date format YYYY年MM月DD日 to ISO-8601."""
        match = self._DATE_RE.search(raw)
        if match:
            year, month, day = match.groups()
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
        return None


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — PMDA Japan"); print("=" * 60)
        scraper = PmdaScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  HTML size: {len(raw)} chars")
        events = scraper.normalize(raw)
        print(f"  events  : {len(events)}")
        if events:
            print(f"  sample  : {json.dumps({k:v for k,v in events[0].items() if k!='raw_record'}, ensure_ascii=False)}")
        sys.exit(0)
    scraper = PmdaScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
