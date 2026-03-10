"""
SÚKL Czech State Institute for Drug Control Shortages Scraper
──────────────────────────────────────────────────────────────
Source:  SÚKL — Státní ústav pro kontrolu léčiv (Czech Republic)
URL:     https://prehledy.sukl.cz/prehled_leciv.html

KNOWN LIMITATION
────────────────
SÚKL uses a JavaScript SPA (React/Vue) for its medicine overview portal.
The prehled_leciv.html page renders entirely client-side; the server-side
HTML response contains only an empty app shell. The underlying API endpoints
(e.g. /api/v1/shortage) either timeout or return 404/403. Returns 0 records
until the correct API endpoint is identified and confirmed accessible.

Data source UUID:  10000000-0000-0000-0000-000000000016  (SÚKL, CZ)
Country:           Czech Republic
Country code:      CZ
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class SuklScraper(BaseScraper):
    """
    Scraper for SÚKL Czech Republic drug shortage data.

    Currently non-functional: JavaScript SPA, no SSR data. normalize()
    returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000016"
    SOURCE_NAME:  str = "SÚKL (Czech State Institute for Drug Control)"
    BASE_URL:     str = "https://prehledy.sukl.cz/prehled_leciv.html"
    COUNTRY:      str = "Czech Republic"
    COUNTRY_CODE: str = "CZ"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 15.0

    KNOWN_LIMITATION: str = (
        "SÚKL uses a JavaScript SPA. API endpoints timeout. "
        "Returns 0 records until API endpoint is identified."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Attempt GET BASE_URL with a 15-second timeout. The SPA shell is
        typically returned quickly; timeout is set conservatively to avoid
        hanging on non-responsive API endpoints.
        """
        self.log.info("Fetching SÚKL shortage page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "SÚKL response received",
                extra={"status": resp.status_code, "bytes": len(html)},
            )
            return {
                "html":        html,
                "byte_length": len(html.encode("utf-8")),
                "status_code": resp.status_code,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }
        except (httpx.TimeoutException, httpx.ConnectTimeout) as exc:
            self.log.warning(
                "SÚKL request timed out",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            return {
                "html":        "",
                "byte_length": 0,
                "status_code": None,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       f"Timeout: {exc}",
            }
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self.log.warning(
                "SÚKL HTTP error",
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
                "SÚKL fetch failed",
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
        The SPA loads shortage data via JavaScript after page load. The SSR
        HTML contains only the application shell — no drug records. Check for
        the presence of an actual shortage table; if not found, return [].
        """
        html:        str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code       = raw.get("status_code")

        self.log.info(
            "Inspecting SÚKL response for shortage data",
            extra={
                "byte_length":      byte_length,
                "status_code":      status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        html_lower   = html.lower()
        has_table    = "<table" in html_lower
        # SPA markers (React root / Vite / webpack)
        is_spa = (
            'id="root"' in html_lower
            or 'id="app"' in html_lower
            or "vite" in html_lower
            or "__webpack" in html_lower
        )

        if is_spa or not has_table:
            self.log.warning(
                "SÚKL: SPA shell detected / no shortage table — returning []",
                extra={
                    "byte_length": byte_length,
                    "is_spa":      is_spa,
                    "has_table":   has_table,
                    "limitation":  self.KNOWN_LIMITATION,
                },
            )
            return []

        self.log.info(
            "SÚKL: shortage data appears present — "
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

        scraper = SuklScraper(db_client=MagicMock())
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
    scraper = SuklScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
