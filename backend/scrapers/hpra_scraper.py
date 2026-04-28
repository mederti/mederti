"""
HPRA Ireland Medicine Shortages Scraper
────────────────────────────────────────
Source:  Health Products Regulatory Authority (Ireland)
URL:     https://www.hpra.ie/find-a-medicine/for-human-use/medicine-shortages
API:     https://sfapi.hpra.ie/api/Shortages (POST, Azure Functions)

The HPRA shortage data is served by an Azure Functions API. The API
requires a POST request with a JSON payload and two key details:
  1. A function code parameter (publicly embedded in the HPRA webpage JS)
  2. An X-Client-App header containing a base64-encoded UTC timestamp

The function code is scraped from the HPRA webpage on each run to ensure
it stays current if HPRA rotates the key.

Data source UUID:  10000000-0000-0000-0000-000000000014  (HPRA, IE)
Country:           Ireland
Country code:      IE
"""

from __future__ import annotations

import base64
import os
import re
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class HpraScraper(BaseScraper):
    """
    Scraper for HPRA Ireland medicine shortage data.

    Two-step fetch:
      1. GET the HPRA shortage webpage to extract the API function code
      2. POST to the Azure Functions API with the code, payload, and
         X-Client-App header
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000014"
    SOURCE_NAME:  str = "HPRA (Health Products Regulatory Authority, Ireland)"
    BASE_URL:     str = "https://www.hpra.ie/find-a-medicine/for-human-use/medicine-shortages"
    API_BASE:     str = "https://sfapi.hpra.ie/api/Shortages"
    COUNTRY:      str = "Ireland"
    COUNTRY_CODE: str = "IE"

    RATE_LIMIT_DELAY: float = 2.0

    # Regex to extract the Azure Functions code from the page JS
    _RE_API_CODE = re.compile(
        r'sfapi\.hpra\.ie/api/Shortages\?code=([A-Za-z0-9+/=_-]+)',
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        1. Fetch the HPRA shortage page to extract the API function code.
        2. POST to the Azure Functions API with the code and a JSON payload
           requesting all records.
        """
        self.log.info("Fetching HPRA shortage page to extract API code",
                      extra={"url": self.BASE_URL})

        try:
            self._enforce_rate_limit()
            with httpx.Client(
                headers=self.DEFAULT_HEADERS,
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                # Step 1: Get the page HTML to extract API code
                page_resp = client.get(self.BASE_URL)
                page_resp.raise_for_status()

                match = self._RE_API_CODE.search(page_resp.text)
                if not match:
                    self.log.warning("HPRA: could not find API code in page HTML")
                    return {
                        "status":     "error",
                        "items":      [],
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "error":      "API function code not found in page HTML",
                    }

                api_code = match.group(1)
                api_url = f"{self.API_BASE}?code={api_code}"
                self.log.info("HPRA API code extracted",
                              extra={"code_prefix": api_code[:8] + "..."})

                # Step 2: POST to the API
                self._enforce_rate_limit()
                timestamp = datetime.now(timezone.utc).isoformat()
                x_client_app = base64.b64encode(timestamp.encode()).decode()

                resp = client.post(
                    api_url,
                    json={
                        "id": None,
                        "skip": 0,
                        "take": 1000,
                        "query": None,
                        "order": "productname",
                        "filter": "All",
                    },
                    headers={
                        "Content-Type": "application/json",
                        "X-Client-App": x_client_app,
                        "Origin": "https://www.hpra.ie",
                        "Referer": "https://www.hpra.ie/",
                    },
                )

            if resp.status_code == 403:
                self.log.warning("HPRA API returned 403 on POST",
                                 extra={"url": api_url})
                return {
                    "status":      "blocked",
                    "status_code": 403,
                    "items":       [],
                    "fetched_at":  datetime.now(timezone.utc).isoformat(),
                }

            resp.raise_for_status()
            data = resp.json()

            items = data.get("items", []) if isinstance(data, dict) else []
            total = data.get("currentFilterCount", len(items)) if isinstance(data, dict) else len(items)
            last_updated = data.get("lastUpdated") if isinstance(data, dict) else None

            self.log.info(
                "HPRA API response received",
                extra={
                    "status":       resp.status_code,
                    "records":      len(items),
                    "total":        total,
                    "last_updated": last_updated,
                },
            )
            return {
                "status":       "ok",
                "status_code":  resp.status_code,
                "items":        items,
                "total":        total,
                "last_updated": last_updated,
                "fetched_at":   datetime.now(timezone.utc).isoformat(),
            }

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self.log.warning("HPRA API HTTP error",
                             extra={"status": status})
            return {
                "status":      "error",
                "status_code": status,
                "items":       [],
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
                "error":       str(exc),
            }
        except Exception as exc:
            self.log.warning("HPRA fetch failed",
                             extra={"error": str(exc)})
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
        Parse the HPRA API response items into normalised shortage events.

        Each item has keys like productName, activeProductIngredient,
        expectedDateToImpact, expectedResolutionDate, shortageReason,
        shortageResolutionDate, etc.

        Items with a shortageResolutionDate are marked 'resolved'.
        """
        fetch_status = raw.get("status", "error")

        self.log.info("Normalising HPRA response",
                      extra={"fetch_status": fetch_status})

        if fetch_status != "ok":
            self.log.warning("HPRA: fetch did not succeed — returning []",
                             extra={"fetch_status": fetch_status})
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
                generic_name = (item.get("productName") or "").strip()
                if not generic_name:
                    skipped += 1
                    continue

                # Extract active ingredient if available
                ingredients = item.get("activeProductIngredient") or []
                if ingredients and isinstance(ingredients, list):
                    substance = ingredients[0].get("substanceName", "")
                    if substance and substance.lower() != generic_name.lower():
                        generic_name = f"{generic_name} ({substance})"

                # Dates
                start_date = (
                    item.get("expectedDateToImpact")
                    or item.get("websiteFirstUpdated")
                    or today
                )
                if start_date and "T" in str(start_date):
                    start_date = str(start_date)[:10]

                resolution_date = item.get("expectedResolutionDate")
                if resolution_date and "T" in str(resolution_date):
                    resolution_date = str(resolution_date)[:10]

                # Status: resolved if shortageResolutionDate is set
                shortage_resolution = item.get("shortageResolutionDate")
                if shortage_resolution:
                    status = "resolved"
                    end_date = str(shortage_resolution)[:10] if "T" in str(shortage_resolution) else str(shortage_resolution)[:10]
                else:
                    status = "active"
                    end_date = None

                # Reason
                reason = item.get("shortageReason") or None

                normalised.append({
                    "generic_name":            generic_name,
                    "status":                  status,
                    "severity":                "medium",
                    "reason":                  reason,
                    "reason_category":         "supply_chain" if reason else "unknown",
                    "start_date":              str(start_date)[:10] if start_date else today,
                    "end_date":                end_date,
                    "estimated_resolution_date": resolution_date,
                    "source_url":              self.BASE_URL,
                    "raw_record":              item,
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
        from collections import Counter

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = HpraScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  fetch_status : {raw.get('status')}")
        print(f"  status_code  : {raw.get('status_code')}")
        print(f"  items        : {len(raw.get('items', []))}")
        print(f"  total        : {raw.get('total', '?')}")
        print(f"  last_updated : {raw.get('last_updated', '?')}")
        if raw.get("error"):
            print(f"  error        : {raw['error']}")

        events = scraper.normalize(raw)
        print(f"\n── Normalised events    : {len(events)}")

        if events:
            print(f"\n── Sample events (first 2):")
            for ev in events[:2]:
                sample = {k: v for k, v in ev.items() if k != "raw_record"}
                print(_json.dumps(sample, indent=2, default=str))

            print(f"\n── Status breakdown:")
            status_counts = Counter(e["status"] for e in events)
            for s, c in status_counts.most_common():
                print(f"   {s:25} {c}")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = HpraScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
