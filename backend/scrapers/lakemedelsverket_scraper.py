"""
Läkemedelsverket (Swedish MPA) Drug Shortages Scraper
──────────────────────────────────────────────────────
Source:  Läkemedelsverket — Medical Products Agency, Sweden
URL:     https://www.lakemedelsverket.se/en/human-medicinal-products/medicines-in-shortage

KNOWN LIMITATION
────────────────
Läkemedelsverket uses an Angular SPA. The shortage listing page returns HTTP 404
on the English-language URL. The previously documented REST endpoint
/api/lmfrest/searchmedprod also returns 404. No server-side rendered shortage
data is available in the HTTP response. Returns 0 records until the correct API
URL or a data export endpoint is identified.

Data source UUID:  10000000-0000-0000-0000-000000000015  (Läkemedelsverket, SE)
Country:           Sweden
Country code:      SE
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class LakemedelsverketScraper(BaseScraper):
    """
    Scraper for Läkemedelsverket Sweden drug shortage data.

    Currently non-functional: Angular SPA, 404 HTTP response. normalize()
    returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000015"
    SOURCE_NAME:  str = "Läkemedelsverket (Swedish MPA)"
    BASE_URL:     str = (
        "https://www.lakemedelsverket.se/en/human-medicinal-products/"
        "medicines-in-shortage"
    )
    COUNTRY:      str = "Sweden"
    COUNTRY_CODE: str = "SE"

    RATE_LIMIT_DELAY: float = 2.0

    KNOWN_LIMITATION: str = (
        "Läkemedelsverket uses Angular SPA. Shortage page returns HTTP 404. "
        "API endpoint /api/lmfrest/searchmedprod returns 404. "
        "Returns 0 records until correct API URL is identified."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Attempt GET BASE_URL. Catches HTTPStatusError (expected 404) and
        returns the status code in the result dict.
        """
        self.log.info(
            "Fetching Läkemedelsverket shortage page",
            extra={"url": self.BASE_URL},
        )
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "Läkemedelsverket response received",
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
                "Läkemedelsverket HTTP error — expected (Angular SPA / 404)",
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
                "Läkemedelsverket fetch failed",
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
        The Angular SPA returns a 404 page with no shortage data in the SSR
        payload. Check for a real shortage table and return [] if not found.
        """
        html:        str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code       = raw.get("status_code")

        self.log.info(
            "Inspecting Läkemedelsverket response",
            extra={
                "byte_length":      byte_length,
                "status_code":      status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        html_lower = html.lower()
        has_table  = "<table" in html_lower
        # Angular app bootstrap marker — confirms it's SPA, not real data
        is_angular = "ng-version" in html_lower or "ng-app" in html_lower

        if status_code != 200 or is_angular or not has_table:
            self.log.warning(
                "Läkemedelsverket: Angular SPA / 404 — no shortage data — returning []",
                extra={
                    "status_code": status_code,
                    "is_angular":  is_angular,
                    "has_table":   has_table,
                    "limitation":  self.KNOWN_LIMITATION,
                },
            )
            return []

        self.log.info(
            "Läkemedelsverket: shortage data appears present — "
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

        scraper = LakemedelsverketScraper(db_client=MagicMock())
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
    scraper = LakemedelsverketScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
