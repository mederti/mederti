"""
HPRA Ireland Medicine Shortages Scraper
────────────────────────────────────────
Source:  Health Products Regulatory Authority (Ireland)
URL:     https://www.hpra.ie/find-a-medicine/for-human-use/medicine-shortages
API:     https://sfapi.hpra.ie/api/Shortages?code=<HPRA_API_CODE env var>

KNOWN LIMITATION
────────────────
HPRA hosts shortage data via an Azure Functions API (sfapi.hpra.ie). Direct
requests to the API return HTTP 403 Forbidden. The function key embedded in
the URL is publicly visible in the HPRA website's JavaScript bundle, but the
API also enforces Referer / CORS origin validation that rejects requests not
originating from a browser session on hpra.ie. Returns 0 records until the
access restriction is resolved or a permitted alternative endpoint is found.

Data source UUID:  10000000-0000-0000-0000-000000000014  (HPRA, IE)
Country:           Ireland
Country code:      IE
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class HpraScraper(BaseScraper):
    """
    Scraper for HPRA Ireland medicine shortage data.

    Attempts to call the Azure Functions API with appropriate browser-like
    headers. If the API returns 403, fetch() returns a blocked sentinel and
    normalize() returns [] gracefully.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000014"
    SOURCE_NAME:  str = "HPRA (Health Products Regulatory Authority, Ireland)"
    BASE_URL:     str = "https://www.hpra.ie/find-a-medicine/for-human-use/medicine-shortages"
    API_URL:      str = (
        "https://sfapi.hpra.ie/api/Shortages"
        "?code=" + os.environ.get("HPRA_API_CODE", "")
    )
    COUNTRY:      str = "Ireland"
    COUNTRY_CODE: str = "IE"

    RATE_LIMIT_DELAY: float = 2.0

    KNOWN_LIMITATION: str = (
        "HPRA Azure Functions API returns HTTP 403. "
        "Access blocked to direct API calls. "
        "Returns 0 records until authorization is resolved."
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Attempt to call the HPRA Azure Functions API with browser-like headers.
        A 403 response is caught and returned as a blocked sentinel dict.
        """
        self.log.info("Fetching HPRA shortage API", extra={"url": self.API_URL})

        headers = {
            "Accept":   "application/json",
            "Referer":  "https://www.hpra.ie/",
            "Origin":   "https://www.hpra.ie",
        }

        try:
            self._enforce_rate_limit()
            with httpx.Client(
                headers={**self.DEFAULT_HEADERS, **headers},
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(self.API_URL)

            if resp.status_code == 403:
                self.log.warning(
                    "HPRA API returned 403 Forbidden",
                    extra={"url": self.API_URL, "limitation": self.KNOWN_LIMITATION},
                )
                return {
                    "status":      "blocked",
                    "status_code": 403,
                    "items":       [],
                    "fetched_at":  datetime.now(timezone.utc).isoformat(),
                }

            resp.raise_for_status()
            data = resp.json()
            self.log.info(
                "HPRA API response received",
                extra={
                    "status":  resp.status_code,
                    "records": len(data) if isinstance(data, list) else "?",
                },
            )
            return {
                "status":      "ok",
                "status_code": resp.status_code,
                "items":       data if isinstance(data, list) else [],
                "raw":         data,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self.log.warning(
                "HPRA API HTTP error",
                extra={"status": status, "url": self.API_URL},
            )
            return {
                "status":      "blocked" if status == 403 else "error",
                "status_code": status,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except Exception as exc:
            self.log.warning(
                "HPRA API fetch failed",
                extra={"error": str(exc), "url": self.API_URL},
            )
            return {
                "status":      "error",
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
        If the fetch was blocked (status == 'blocked'), return [].
        Otherwise, attempt to parse the JSON array.

        Each item expected keys (checked in order):
          - generic_name: 'productName' or 'product' or 'genericName'
          - status: always 'active' (current shortages endpoint)
          - severity: 'medium' (no severity field in HPRA API)
          - source_url: BASE_URL
        """
        fetch_status = raw.get("status", "error")

        self.log.info(
            "Normalising HPRA response",
            extra={
                "fetch_status":     fetch_status,
                "known_limitation": self.KNOWN_LIMITATION,
            },
        )

        if fetch_status == "blocked":
            self.log.warning(
                "HPRA: API access blocked (403) — returning []",
                extra={"limitation": self.KNOWN_LIMITATION},
            )
            return []

        if fetch_status != "ok":
            self.log.warning(
                "HPRA: fetch did not succeed — returning []",
                extra={"fetch_status": fetch_status},
            )
            return []

        items: list[dict] = raw.get("items", [])
        if not items:
            self.log.info("HPRA: no items in API response — returning []")
            return []

        normalised: list[dict] = []
        skipped = 0
        today = datetime.now(timezone.utc).date().isoformat()

        for item in items:
            try:
                # Discover the generic name key
                generic_name = (
                    item.get("productName")
                    or item.get("product")
                    or item.get("genericName")
                    or item.get("name")
                    or ""
                ).strip()

                if not generic_name:
                    skipped += 1
                    continue

                start_date = (
                    item.get("startDate")
                    or item.get("dateOfShortage")
                    or item.get("notificationDate")
                    or today
                )
                # Normalise ISO date strings
                if start_date and "T" in str(start_date):
                    start_date = str(start_date)[:10]

                normalised.append({
                    "generic_name": generic_name,
                    "status":       "active",
                    "severity":     "medium",
                    "start_date":   str(start_date)[:10] if start_date else today,
                    "source_url":   self.BASE_URL,
                    "raw_record":   item,
                })
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "HPRA: failed to normalise item",
                    extra={"error": str(exc), "item": str(item)[:200]},
                )

        self.log.info(
            "HPRA normalisation done",
            extra={
                "total":      len(items),
                "normalised": len(normalised),
                "skipped":    skipped,
            },
        )
        return normalised


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

        scraper = HpraScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  fetch_status : {raw.get('status')}")
        print(f"  status_code  : {raw.get('status_code')}")
        print(f"  items        : {len(raw.get('items', []))}")
        print(f"  error        : {raw.get('error', 'none')}")

        events = scraper.normalize(raw)
        print(f"  events       : {len(events)}")
        print(f"  limitation   : {scraper.KNOWN_LIMITATION}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = HpraScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
