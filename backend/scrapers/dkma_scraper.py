"""
DKMA Danish Medicines Agency Drug Shortages Scraper
────────────────────────────────────────────────────
Source:  Danish Medicines Agency (Lægemiddelstyrelsen)
URL:     https://www.laegemiddelstyrelsen.dk/en/pharmacies/drug-shortages/

KNOWN LIMITATION
────────────────
The DKMA shortage listing URL returns HTTP 404. The Sitecore CMS route that
previously served this page is no longer accessible. Returns 0 records until
the correct URL is identified or the agency publishes a direct data export.

Data source UUID:  10000000-0000-0000-0000-000000000012  (DKMA, DK)
Country:           Denmark
Country code:      DK
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class DkmaScraper(BaseScraper):
    """
    Scraper for DKMA Denmark drug shortage notices.

    Currently non-functional: the shortage listing URL returns HTTP 404.
    fetch() captures the status code; normalize() returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000012"
    SOURCE_NAME:  str = "DKMA (Danish Medicines Agency)"
    BASE_URL:     str = "https://www.laegemiddelstyrelsen.dk/en/pharmacies/drug-shortages/"
    COUNTRY:      str = "Denmark"
    COUNTRY_CODE: str = "DK"

    RATE_LIMIT_DELAY: float = 2.0

    KNOWN_LIMITATION: str = (
        "DKMA website returns HTTP 404 for shortage listing. "
        "Sitecore CMS route not accessible. Returns 0 records."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Attempt GET BASE_URL. Catches HTTPStatusError (expected 404) and
        returns the status code in the result dict so normalize() can inspect it.
        """
        self.log.info("Fetching DKMA shortage page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "DKMA response received",
                extra={"status": resp.status_code, "bytes": len(html)},
            )
            return {
                "html":        html,
                "byte_length": len(html.encode("utf-8")),
                "status_code": resp.status_code,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self.log.warning(
                "DKMA HTTP error — expected (404 Sitecore route)",
                extra={"status": status, "url": self.BASE_URL},
            )
            return {
                "html":        exc.response.text if exc.response else "",
                "byte_length": len(exc.response.content) if exc.response else 0,
                "status_code": status,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except Exception as exc:
            self.log.warning(
                "DKMA fetch failed",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            return {
                "html":        "",
                "byte_length": 0,
                "status_code": None,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """
        Check if the response contains a usable shortage table.

        A 404 response or a page with no <table element cannot be parsed.
        Log a warning and return [].
        """
        html:        str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code       = raw.get("status_code")

        self.log.info(
            "Inspecting DKMA response for shortage data",
            extra={
                "byte_length":      byte_length,
                "status_code":      status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        # 404 or connection failure
        if status_code != 200:
            self.log.warning(
                "DKMA: non-200 status code — returning []",
                extra={
                    "status_code": status_code,
                    "limitation":  self.KNOWN_LIMITATION,
                },
            )
            return []

        html_lower = html.lower()
        has_table  = "<table" in html_lower

        if not has_table:
            self.log.warning(
                "DKMA: no shortage table found in HTML — returning []",
                extra={
                    "byte_length": byte_length,
                    "has_table":   has_table,
                    "limitation":  self.KNOWN_LIMITATION,
                },
            )
            return []

        self.log.info(
            "DKMA: shortage data appears present — "
            "full parsing not yet implemented",
            extra={"byte_length": byte_length},
        )
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json as _json
    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = DkmaScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  byte_length : {raw.get('byte_length', 0)}")
        print(f"  status_code : {raw.get('status_code')}")
        print(f"  error       : {raw.get('error', 'none')}")

        events = scraper.normalize(raw)
        print(f"  events      : {len(events)}")
        print(f"  limitation  : {scraper.KNOWN_LIMITATION}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = DkmaScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
