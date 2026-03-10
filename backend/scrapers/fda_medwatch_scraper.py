"""
FDA MedWatch Drug Safety Alerts Scraper
─────────────────────────────────────────
Source:  FDA MedWatch — Safety Information and Adverse Event Reporting
URL:     https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program

Data access
───────────
FDA provides safety alerts via RSS and via the openFDA API:

    https://api.fda.gov/drug/enforcement.json
    (Already scraped by fda_enforcement_scraper — this scraper focuses on safety alerts)

MedWatch RSS feed:
    https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml

openFDA drug recalls (distinct from enforcement):
    https://api.fda.gov/drug/enforcement.json?search=status:Ongoing&limit=100

Maps to shortage events where safety concerns create supply disruptions.
Severity: high (recalls) or critical (Class I recalls).

Data source UUID:  10000000-0000-0000-0000-000000000027  (FDA MedWatch, US)
Country:           United States
Country code:      US
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class FdaMedwatchScraper(BaseScraper):
    """Scraper for FDA MedWatch safety alerts and drug recalls."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000028"
    SOURCE_NAME:  str = "FDA MedWatch — Drug Safety Alerts"
    BASE_URL:     str = "https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program"
    RSS_URL:      str = "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml"
    API_URL:      str = "https://api.fda.gov/drug/enforcement.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 30.0
    PAGE_SIZE:        int   = 100

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Fetch FDA drug recall/enforcement data from openFDA API.

        Returns:
            {"records": list[dict], "total": int, "fetched_at": str}
        """
        all_records: list[dict] = []
        skip = 0
        total = None

        self.log.info("Fetching FDA MedWatch/enforcement data", extra={"url": self.API_URL})

        while True:
            params = {
                "search": "status:Ongoing",
                "limit":  self.PAGE_SIZE,
                "skip":   skip,
            }
            try:
                time.sleep(self.RATE_LIMIT_DELAY)
                resp = httpx.get(
                    self.API_URL,
                    params=params,
                    timeout=self.REQUEST_TIMEOUT,
                    follow_redirects=True,
                )
                resp.raise_for_status()
                data = resp.json()

                records = data.get("results", [])
                all_records.extend(records)

                if total is None:
                    total = data.get("meta", {}).get("results", {}).get("total", len(records))

                self.log.debug(
                    "FDA MedWatch page fetched",
                    extra={"skip": skip, "count": len(records), "total": total},
                )

                if len(all_records) >= min(total or 9999, 2000):  # cap at 2000
                    break
                if len(records) < self.PAGE_SIZE:
                    break
                skip += self.PAGE_SIZE

            except httpx.HTTPStatusError as exc:
                self.log.error(
                    "FDA MedWatch API error",
                    extra={"status": exc.response.status_code, "skip": skip},
                )
                break
            except Exception as exc:
                self.log.error("FDA MedWatch fetch error", extra={"error": str(exc)})
                break

        self.log.info(
            "FDA MedWatch fetch complete",
            extra={"total_records": len(all_records)},
        )
        return {
            "records":   all_records,
            "total":     total,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """Convert FDA enforcement records to shortage events."""
        records = raw.get("records", [])
        if not records:
            self.log.warning("FDA MedWatch: no records")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        for item in records:
            try:
                # Filter to drug products only (not devices/foods)
                product_type = (item.get("product_type") or "").lower()
                if product_type and product_type not in ("drugs", "drug"):
                    continue

                brand_name = (item.get("product_description") or "").strip()
                if not brand_name:
                    skipped += 1
                    continue

                # Truncate to first meaningful name (product descriptions can be long)
                generic_name = self._extract_generic(brand_name)

                recall_class = item.get("classification") or "Class III"
                severity = {
                    "Class I":   "critical",
                    "Class II":  "high",
                    "Class III": "medium",
                }.get(recall_class, "medium")

                status_raw = (item.get("status") or "Ongoing").lower()
                status = "resolved" if "terminat" in status_raw or "complet" in status_raw else "active"

                start_raw = item.get("recall_initiation_date") or item.get("center_classification_date") or ""
                end_raw   = item.get("termination_date") or ""
                start_date = self._parse_fda_date(start_raw) or today
                end_date   = self._parse_fda_date(end_raw)

                reason = item.get("reason_for_recall") or ""

                normalised.append({
                    "generic_name":    generic_name,
                    "brand_names":     [brand_name[:100]] if brand_name != generic_name else [],
                    "status":          status,
                    "severity":        severity,
                    "reason":          reason[:500] if reason else None,
                    "reason_category": "regulatory_action",
                    "start_date":      start_date,
                    "end_date":        end_date if status == "resolved" else None,
                    "source_url":      self.BASE_URL,
                    "notes": (
                        f"FDA enforcement action: {recall_class}. "
                        f"Recalling firm: {item.get('recalling_firm', '')}. "
                        f"Distribution: {(item.get('distribution_pattern', ''))[:100]}."
                    ),
                    "raw_record": {
                        "recall_number": item.get("recall_number"),
                        "classification": recall_class,
                        "recalling_firm": item.get("recalling_firm"),
                        "reason": reason[:200] if reason else "",
                    },
                })
            except Exception as exc:
                skipped += 1
                self.log.warning("FDA MedWatch: item error", extra={"error": str(exc)})

        self.log.info(
            "FDA MedWatch normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    @staticmethod
    def _extract_generic(product_desc: str) -> str:
        """Extract a usable generic name from FDA product description."""
        # FDA descriptions often start with brand name then active ingredient
        # e.g. "METFORMIN HCL Tablets, 500 MG; Rx only"
        name = product_desc.split(",")[0].split(";")[0].strip()
        # Remove dosage info (digits + units at end)
        name = re.sub(r"\s+\d+[\d.]*\s*(MG|MCG|ML|G|IU|%)\b.*$", "", name, flags=re.IGNORECASE)
        return name[:80] if name else product_desc[:40]

    @staticmethod
    def _parse_fda_date(raw: str) -> str | None:
        """Parse FDA date formats: YYYYMMDD or YYYY-MM-DD."""
        if not raw:
            return None
        compact = str(raw).replace("-", "").replace("/", "")[:8]
        if len(compact) == 8 and compact.isdigit():
            return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"
        return None


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — FDA MedWatch"); print("=" * 60)
        scraper = FdaMedwatchScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  records: {len(raw.get('records', []))}, total: {raw.get('total')}")
        events = scraper.normalize(raw)
        print(f"  events : {len(events)}")
        if events:
            print(f"  sample : {json.dumps({k:v for k,v in events[0].items() if k!='raw_record'})}")
        sys.exit(0)
    scraper = FdaMedwatchScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
