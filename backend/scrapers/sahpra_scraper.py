"""
SAHPRA South African Drug Shortage Scraper
───────────────────────────────────────────
Source:  SAHPRA — South African Health Products Regulatory Authority
URL:     https://www.sahpra.org.za/medicines-information/medicine-shortages/

Data access
───────────
SAHPRA publishes medicine shortage information as:
  1. HTML content on the shortage page
  2. PDF or Excel documents linked from the page
  3. Individual shortage notices

Primary strategy: Scrape the SAHPRA shortage listing page for drug names and dates.

Data source UUID:  10000000-0000-0000-0000-000000000034  (SAHPRA, ZA)
Country:           South Africa
Country code:      ZA
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class SahpraScraper(BaseScraper):
    """Scraper for SAHPRA South African drug shortage data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000039"
    SOURCE_NAME:  str = "SAHPRA (South African Health Products Regulatory Authority)"
    BASE_URL:     str = "https://www.sahpra.org.za/medicines-information/medicine-shortages/"
    COUNTRY:      str = "South Africa"
    COUNTRY_CODE: str = "ZA"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "en-ZA,en;q=0.9",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> str:
        """GET the SAHPRA medicine shortages page."""
        self.log.info("Fetching SAHPRA shortage page", extra={"url": self.BASE_URL})
        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()
        self.log.info(
            "SAHPRA page fetched",
            extra={"bytes": len(resp.content), "status": resp.status_code},
        )
        return resp.text

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: str) -> list[dict]:
        """
        Parse SAHPRA shortage HTML to extract drug records.

        Looks for:
        - Links to individual shortage notices
        - Tables with drug names and dates
        - List items with shortage information
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed.")
            return []

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        # Strategy 1: Find table rows
        tables = soup.find_all("table")
        for table in tables:
            headers_row = table.find("tr")
            headers = [th.get_text(strip=True).lower() for th in headers_row.find_all(["th", "td"])] if headers_row else []
            # Identify name column
            name_col = next((i for i, h in enumerate(headers) if any(w in h for w in ["medicine", "drug", "product", "name"])), 0)
            date_col = next((i for i, h in enumerate(headers) if any(w in h for w in ["date", "shortage"])), None)

            for tr in table.find_all("tr")[1:]:
                cells = tr.find_all("td")
                if len(cells) <= name_col:
                    continue
                try:
                    name = cells[name_col].get_text(strip=True)
                    if not name or len(name) < 3:
                        skipped += 1
                        continue
                    date_raw = cells[date_col].get_text(strip=True) if date_col and date_col < len(cells) else ""
                    start_date = self._parse_date(date_raw) or today
                    normalised.append(self._build_record(name, start_date, cells))
                except Exception as exc:
                    skipped += 1
                    self.log.warning("SAHPRA: table row error", extra={"error": str(exc)})

        # Strategy 2: Find shortage links (article/notice titles)
        if not normalised:
            for a in soup.find_all("a", href=True):
                text = a.get_text(strip=True)
                href = a.get("href", "")
                if not text or len(text) < 5:
                    continue
                if any(w in text.lower() for w in ["shortage", "medicine", "drug", "unavailable"]):
                    normalised.append(self._build_record(text, today, []))

        # Strategy 3: List items
        if not normalised:
            for li in soup.find_all("li"):
                text = li.get_text(strip=True)
                if text and len(text) > 5 and any(
                    w in text.lower() for w in ["shortage", "medicine", "drug"]
                ):
                    normalised.append(self._build_record(text[:100], today, []))

        self.log.info(
            "SAHPRA normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _build_record(self, name: str, start_date: str, cells) -> dict:
        return {
            "generic_name":    name,
            "brand_names":     [],
            "status":          "active",
            "severity":        "medium",
            "reason_category": "supply_chain",
            "start_date":      start_date,
            "source_url":      self.BASE_URL,
            "notes":           f"South African medicine shortage from SAHPRA.",
            "raw_record":      {"name": name, "start_date": start_date},
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d %B %Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(raw.strip(), fmt).date().isoformat()
            except Exception:
                pass
        return None


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — SAHPRA South Africa"); print("=" * 60)
        scraper = SahpraScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  HTML size: {len(raw)} chars")
        events = scraper.normalize(raw)
        print(f"  events  : {len(events)}")
        sys.exit(0)
    scraper = SahpraScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
