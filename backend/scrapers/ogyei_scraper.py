"""
OGYÉI Hungarian National Institute of Pharmacy Shortages Scraper
─────────────────────────────────────────────────────────────────
Source:  OGYÉI — Országos Gyógyszerészeti és Élelmezés-egészségügyi Intézet
         (now merged into NNGYK — National Centre for Public Health and
         Pharmaceutical Affairs)
URL:     https://ogyei.gov.hu/gyogyszerhiany

KNOWN LIMITATION
────────────────
The OGYÉI domain (now NNGYK after a 2022 institutional merger) either times
out or returns a page with no machine-readable shortage data accessible via
plain HTTP requests. The gyogyszerhiany URL has not been confirmed accessible
since the merger. Returns 0 records until the correct URL under the new
NNGYK domain (nngyk.hu) is identified.

Data source UUID:  10000000-0000-0000-0000-000000000017  (OGYÉI, HU)
Country:           Hungary
Country code:      HU
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class OgyeiScraper(BaseScraper):
    """
    Scraper for OGYÉI / NNGYK Hungary drug shortage data.

    Attempts to fetch the known URL with a 15-second timeout. Connection
    errors and timeouts are caught and returned in the dict so normalize()
    can handle them gracefully. Returns [] until a working endpoint is found.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000017"
    SOURCE_NAME:  str = "OGYÉI (Hungarian National Institute of Pharmacy)"
    BASE_URL:     str = "https://ogyei.gov.hu/gyogyszerhiany"
    COUNTRY:      str = "Hungary"
    COUNTRY_CODE: str = "HU"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 15.0

    KNOWN_LIMITATION: str = (
        "OGYÉI website (now merged into NNGYK) times out or returns no "
        "shortage data accessible via HTTP. Returns 0 records."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Attempt GET BASE_URL with a 15-second timeout.
        Connection errors and timeouts are caught gracefully.
        """
        self.log.info("Fetching OGYÉI shortage page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL)
            html = resp.text
            self.log.info(
                "OGYÉI response received",
                extra={"status": resp.status_code, "bytes": len(html)},
            )
            return {
                "html":        html,
                "byte_length": len(html.encode("utf-8")),
                "status_code": resp.status_code,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }
        except (
            httpx.TimeoutException,
            httpx.ConnectTimeout,
            httpx.ConnectError,
            httpx.NetworkError,
        ) as exc:
            self.log.warning(
                "OGYÉI connection/timeout error — expected (domain may be unreachable)",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            return {
                "html":        "",
                "byte_length": 0,
                "status_code": None,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self.log.warning(
                "OGYÉI HTTP error",
                extra={"status": status, "url": self.BASE_URL},
            )
            return {
                "html":        exc.response.text if exc.response else "",
                "byte_length": len(exc.response.content) if exc.response else 0,
                "status_code": status,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except Exception as exc:
            self.log.warning(
                "OGYÉI fetch failed",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            return {
                "html":        "",
                "byte_length": 0,
                "status_code": None,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """
        Inspect the fetched HTML for a usable shortage table.
        If no table is found (timeout, error, or empty page), return [].
        """
        html:        str = raw.get("html", "")
        byte_length: int = raw.get("byte_length", 0)
        status_code       = raw.get("status_code")

        self.log.info(
            "Inspecting OGYÉI response for shortage data",
            extra={
                "byte_length":      byte_length,
                "status_code":      status_code,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        html_lower = html.lower()
        has_table  = "<table" in html_lower

        if not html or not has_table:
            self.log.warning(
                "OGYÉI: no shortage table found — returning []",
                extra={
                    "byte_length": byte_length,
                    "has_table":   has_table,
                    "status_code": status_code,
                    "limitation":  self.KNOWN_LIMITATION,
                },
            )
            return []

        self.log.info(
            "OGYÉI: shortage data appears present — "
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

        scraper = OgyeiScraper(db_client=MagicMock())
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
    scraper = OgyeiScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
