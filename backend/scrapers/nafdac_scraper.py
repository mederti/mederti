"""
NAFDAC Nigerian Drug Shortage Scraper
──────────────────────────────────────
Source:  NAFDAC — National Agency for Food and Drug Administration and Control (Nigeria)
URL:     https://www.nafdac.gov.ng/

Data access
───────────
NAFDAC publishes shortage and recall information on their website.
Shortage notices are typically listed as news items or regulatory alerts.

Primary strategy: Scrape NAFDAC news/alerts page for shortage-related content.

Data source UUID:  10000000-0000-0000-0000-000000000035  (NAFDAC, NG)
Country:           Nigeria
Country code:      NG
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class NafdacScraper(BaseScraper):
    """Scraper for NAFDAC Nigerian drug shortage/regulatory alert data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000040"
    SOURCE_NAME:  str = "NAFDAC (National Agency for Food and Drug Administration and Control, Nigeria)"
    BASE_URL:     str = "https://www.nafdac.gov.ng/drug-shortage-alert/"
    COUNTRY:      str = "Nigeria"
    COUNTRY_CODE: str = "NG"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "en-NG,en;q=0.9",
    }

    # Additional URLs to check
    _FALLBACK_URLS: list[str] = [
        "https://www.nafdac.gov.ng/drug-shortage-alert/",
        "https://www.nafdac.gov.ng/category/regulatory-alerts/",
        "https://www.nafdac.gov.ng/medicines/",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """Fetch NAFDAC shortage/alert pages."""
        all_html: dict[str, str] = {}

        for url in self._FALLBACK_URLS:
            self.log.info("Fetching NAFDAC page", extra={"url": url})
            try:
                with httpx.Client(
                    headers=self._HEADERS,
                    timeout=self.REQUEST_TIMEOUT,
                    follow_redirects=True,
                ) as client:
                    resp = client.get(url)
                    if resp.status_code == 200:
                        all_html[url] = resp.text
                        self.log.info(
                            "NAFDAC page fetched",
                            extra={"url": url, "bytes": len(resp.content)},
                        )
                    else:
                        self.log.debug("NAFDAC: non-200", extra={"url": url, "status": resp.status_code})
            except Exception as exc:
                self.log.warning("NAFDAC: fetch error", extra={"url": url, "error": str(exc)})

            import time
            time.sleep(self.RATE_LIMIT_DELAY)

        return {"pages": all_html, "fetched_at": datetime.now(timezone.utc).isoformat()}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """Parse NAFDAC HTML pages for shortage-related drug information."""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed.")
            return []

        from bs4 import BeautifulSoup
        pages = raw.get("pages", {})
        if not pages:
            self.log.warning("NAFDAC: no pages fetched")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        seen: set[str] = set()

        for url, html in pages.items():
            soup = BeautifulSoup(html, "html.parser")

            # Look for article titles, list items, or table content
            # that mention drugs/medicines/shortages
            selectors = [
                "article h2", "article h3", "article .title",
                ".post-title", ".entry-title", "h2.title",
                "td:first-child", "li > a",
            ]

            for sel in selectors:
                for el in soup.select(sel):
                    text = el.get_text(strip=True)
                    if not text or len(text) < 5 or text in seen:
                        continue
                    if not any(w in text.lower() for w in
                               ["drug", "medicine", "shortage", "pharmaceutical", "supply"]):
                        continue
                    seen.add(text)

                    # Get the date from parent article if available
                    parent = el.find_parent("article") or el.find_parent("div")
                    date_el = parent.find(class_=re.compile(r"date|time|published")) if parent else None
                    date_raw = date_el.get_text(strip=True) if date_el else ""
                    start_date = self._parse_date(date_raw) or today

                    normalised.append({
                        "generic_name":    text[:80],
                        "brand_names":     [],
                        "status":          "active",
                        "severity":        "medium",
                        "reason_category": "supply_chain",
                        "start_date":      start_date,
                        "source_url":      url,
                        "notes":           f"Nigerian drug regulatory alert from NAFDAC.",
                        "raw_record":      {"text": text, "url": url},
                    })

        self.log.info(
            "NAFDAC normalisation done",
            extra={"normalised": len(normalised), "pages": len(pages)},
        )
        return normalised

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%B %d, %Y", "%d %B %Y", "%Y-%m-%d", "%d/%m/%Y"):
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
        print("=" * 60); print("DRY RUN — NAFDAC Nigeria"); print("=" * 60)
        scraper = NafdacScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  pages: {list(raw.get('pages', {}).keys())}")
        events = scraper.normalize(raw)
        print(f"  events: {len(events)}")
        sys.exit(0)
    scraper = NafdacScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
