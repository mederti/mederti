"""
CBG-MEB Netherlands Drug Shortages Scraper
───────────────────────────────────────────
Source:  College ter Beoordeling van Geneesmiddelen (CBG-MEB)
URL:     https://www.cbg-meb.nl/onderwerpen/geneesmiddelentekorten

KNOWN LIMITATION
────────────────
CBG-MEB website uses Next.js SPA rendering. The shortage data is loaded
client-side via JavaScript. The server-side HTML returned by a plain GET
request contains no shortage table or drug records — only the Next.js
skeleton and __NEXT_DATA__ bootstrap JSON (which contains CMS page metadata,
not shortage records). Returns 0 records until a REST API endpoint that
serves the shortage data directly is identified.

Data source UUID:  10000000-0000-0000-0000-000000000011  (CBG-MEB, NL)
Country:           Netherlands
Country code:      NL
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class CbgMebScraper(BaseScraper):
    """
    Scraper for CBG-MEB Netherlands drug shortage notices.

    Currently non-functional: the page is a Next.js SPA. The raw HTML
    contains no shortage table. normalize() returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000011"
    SOURCE_NAME:  str = "CBG-MEB (Netherlands)"
    BASE_URL:     str = "https://www.cbg-meb.nl/onderwerpen/geneesmiddelentekorten"
    COUNTRY:      str = "Netherlands"
    COUNTRY_CODE: str = "NL"

    RATE_LIMIT_DELAY: float = 2.0

    KNOWN_LIMITATION: str = (
        "CBG-MEB website uses Next.js SPA. Data not available in server-side "
        "HTML. Returns 0 records until API endpoint is identified."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        GET BASE_URL and return the raw HTML with metadata.
        HTTP errors are caught and surfaced in the returned dict.
        """
        self.log.info("Fetching CBG-MEB shortage page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "CBG-MEB response received",
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
                "CBG-MEB HTTP error during fetch",
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
                "CBG-MEB fetch failed",
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
        Inspect the fetched HTML for an actual shortage table.

        Markers that indicate real shortage data:
          - '<table' present in HTML
          - OR 'tekort' appears alongside drug info (i.e. more than 3 times,
            since the page title/nav may mention it once or twice)

        The Next.js SPA skeleton typically scores 0 or 1 on these checks.
        If no real data is found, log a warning and return [].
        """
        html:        str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code       = raw.get("status_code")

        self.log.info(
            "Inspecting CBG-MEB response for shortage table",
            extra={
                "byte_length":      byte_length,
                "status_code":      status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        html_lower  = html.lower()
        has_table   = "<table" in html_lower
        # Count occurrences of 'tekort' (Dutch for 'shortage') with drug data
        tekort_count = html_lower.count("tekort")

        if not has_table and tekort_count < 4:
            self.log.warning(
                "CBG-MEB: no shortage table found in HTML (Next.js SPA) — returning []",
                extra={
                    "byte_length":   byte_length,
                    "has_table":     has_table,
                    "tekort_count":  tekort_count,
                    "status_code":   status_code,
                    "limitation":    self.KNOWN_LIMITATION,
                },
            )
            return []

        self.log.info(
            "CBG-MEB: shortage data appears present — "
            "full parsing not yet implemented",
            extra={"byte_length": byte_length, "tekort_count": tekort_count},
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

        scraper = CbgMebScraper(db_client=MagicMock())
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
    scraper = CbgMebScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
