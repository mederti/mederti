"""
Medsafe New Zealand Medicine Shortages Scraper
───────────────────────────────────────────────
Source:  Medsafe — New Zealand Medicines and Medical Devices Safety Authority
URL:     https://www.medsafe.govt.nz/medicines/shortageslist.asp

KNOWN LIMITATION
────────────────
Medsafe NZ website appears restructured. The shortageslist.asp URL returns a
~9 KB "page not found" HTML response. No shortage table is present. This scraper
returns 0 records until the correct URL is identified and confirmed.

Data source UUID:  10000000-0000-0000-0000-000000000004  (Medsafe NZ)
Country:           New Zealand
Country code:      NZ
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class MedsafeScraper(BaseScraper):
    """
    Scraper for Medsafe NZ medicine shortages.

    Currently non-functional: the shortageslist.asp URL returns a page-not-found
    response (~9 KB). Fetch is attempted and the result is inspected; if no
    shortage table is present, normalize() returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000004"
    SOURCE_NAME:  str = "Medsafe (New Zealand)"
    BASE_URL:     str = "https://www.medsafe.govt.nz/medicines/shortageslist.asp"
    COUNTRY:      str = "New Zealand"
    COUNTRY_CODE: str = "NZ"

    RATE_LIMIT_DELAY: float = 2.0

    KNOWN_LIMITATION: str = (
        "Medsafe NZ website appears restructured. URL returns ~9 KB "
        "'page not found' HTML. Returns 0 records until correct URL is identified."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        GET BASE_URL and return a dict with the raw HTML and metadata.
        Any HTTP error is caught and surfaced in the returned dict so that
        normalize() can handle it gracefully.
        """
        self.log.info("Fetching Medsafe shortage list", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "Medsafe response received",
                extra={"status": resp.status_code, "bytes": len(html)},
            )
            return {
                "html":        html,
                "byte_length": len(html.encode("utf-8")),
                "status_code": resp.status_code,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }
        except httpx.HTTPStatusError as exc:
            self.log.warning(
                "Medsafe HTTP error during fetch",
                extra={"status": exc.response.status_code, "url": self.BASE_URL},
            )
            return {
                "html":        "",
                "byte_length": 0,
                "status_code": exc.response.status_code,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except Exception as exc:
            self.log.warning(
                "Medsafe fetch failed",
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
        Inspect the fetched HTML for real shortage data.

        Real shortage data criteria:
          - Response body > 20,000 bytes  (page-not-found pages are ~9 KB)
          - AND HTML contains '<table' or the word 'shortage'

        If either condition fails, log a warning and return [].
        """
        html: str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code = raw.get("status_code")

        self.log.info(
            "Inspecting Medsafe response for shortage data",
            extra={
                "byte_length": byte_length,
                "status_code": status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        has_table    = "<table" in html.lower()
        has_shortage = "shortage" in html.lower()
        is_large     = byte_length > 20_000

        if not (is_large and (has_table or has_shortage)):
            self.log.warning(
                "Medsafe: no shortage table data found in response — returning []",
                extra={
                    "byte_length":   byte_length,
                    "has_table":     has_table,
                    "has_shortage":  has_shortage,
                    "is_large":      is_large,
                    "status_code":   status_code,
                    "limitation":    self.KNOWN_LIMITATION,
                },
            )
            return []

        # If a future run does find data, log it so the developer can
        # implement proper parsing.
        self.log.info(
            "Medsafe: shortage data appears present — "
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

        scraper = MedsafeScraper(db_client=MagicMock())
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
    scraper = MedsafeScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
