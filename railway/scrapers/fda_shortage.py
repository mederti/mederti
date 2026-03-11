"""
FDA (USA) Drug Shortage Scraper
Uses the FDA Drug Shortages database.

API docs: https://open.fda.gov/apis/drug/shortages/
Direct:   https://api.fda.gov/drug/shortages.json
"""
from __future__ import annotations

import logging
import requests
import time
from datetime import datetime
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

FDA_SHORTAGE_API = "https://api.fda.gov/drug/shortages.json"
PAGE_SIZE        = 100


class FDAShortageScraper(BaseScraper):
    scraper_name = "fda_shortage"
    country      = "US"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching FDA shortages...")
        all_items = []
        skip = 0

        while True:
            try:
                r = requests.get(
                    FDA_SHORTAGE_API,
                    params={"limit": PAGE_SIZE, "skip": skip},
                    timeout=30
                )
                r.raise_for_status()
                data = r.json()
            except requests.HTTPError as e:
                if e.response.status_code == 404:
                    break
                raise

            results = data.get("results", [])
            if not results:
                break

            all_items.extend(results)
            log.info(f"  Fetched {len(all_items)} shortages so far...")

            total = data.get("meta", {}).get("results", {}).get("total", 0)
            if len(all_items) >= total:
                break

            skip += PAGE_SIZE
            time.sleep(0.25)

        log.info(f"  Total FDA shortage items: {len(all_items)}")
        return self._build_records(all_items)

    def _build_records(self, items: list) -> list[dict]:
        records = []
        for item in items:
            # FDA shortage API actual fields: package_ndc, generic_name, status,
            # company_name, related_info, discontinued_date, dosage_form, etc.
            ndc         = item.get("package_ndc") or item.get("product_ndc") or ""
            drug_name   = item.get("generic_name") or ""
            raw_status  = item.get("status") or "Current"

            status_map = {
                "Current":   "shortage",
                "Resolved":  "available",
                "Discontinued": "discontinued",
            }
            status = status_map.get(raw_status, "shortage")

            if status not in ("shortage", "limited"):
                continue

            product_id = None
            if ndc:
                # NDC in API is hyphenated (e.g. "0310-6615-02") — try both formats
                ndc_base = "-".join(ndc.split("-")[:2]) if "-" in ndc else ndc
                product_id = self.lookup_product_id(ndc_base, "FDA_NDC")
                if not product_id:
                    product_id = self.lookup_product_id(ndc.replace("-", ""), "FDA_NDC")

            ingredient_id = None
            if not product_id and drug_name:
                # Try full generic name first, then first word
                ingredient_id = self.lookup_ingredient_id(drug_name.lower().strip())
                if not ingredient_id:
                    first_word = drug_name.split()[0].lower() if drug_name.split() else ""
                    if first_word and len(first_word) > 2:
                        ingredient_id = self.lookup_ingredient_id(first_word)

            if not product_id and not ingredient_id:
                continue

            records.append({
                "product_id":          product_id,
                "ingredient_id":       ingredient_id,
                "country":             "US",
                "status":              status,
                "severity":            self._map_severity(item),
                "shortage_reason":     item.get("related_info"),
                "expected_resolution": self._parse_resolution(item),
                "source_agency":       "FDA",
                "source_url":          "https://www.accessdata.fda.gov/scripts/drugshortages/",
                "last_verified_at":    self.now_iso(),
            })

        return records

    def _map_severity(self, item: dict) -> str:
        reason = (item.get("related_info") or "").lower()
        if any(w in reason for w in ["discontinu", "no longer", "permanent"]):
            return "critical"
        if any(w in reason for w in ["manufacturing", "supply", "demand increase"]):
            return "high"
        return "medium"

    def _parse_resolution(self, item: dict) -> str | None:
        val = item.get("discontinued_date") or item.get("resolution_date")
        if not val:
            return None
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%Y", "%B %Y"):
            try:
                return datetime.strptime(str(val).strip(), fmt).date().isoformat()
            except ValueError:
                continue
        return None


class FDARecallScraper(BaseScraper):
    scraper_name = "fda_recall"
    country      = "US"

    FDA_RECALL_API = "https://api.fda.gov/drug/enforcement.json"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching FDA recalls (Ongoing)...")

        try:
            r = requests.get(
                self.FDA_RECALL_API,
                params={
                    "search": "status:Ongoing",
                    "sort":   "report_date:desc",
                    "limit":  PAGE_SIZE,
                },
                timeout=30,
            )
            r.raise_for_status()
            items = r.json().get("results", [])
        except Exception as e:
            log.error(f"FDA recall API error: {e}")
            return []

        records = []
        for item in items:
            drug_name = item.get("product_description") or ""
            classification = item.get("classification") or ""

            ingredient_id = None
            if drug_name:
                first_word = drug_name.split()[0].lower() if drug_name.split() else ""
                if first_word and len(first_word) > 2:
                    ingredient_id = self.lookup_ingredient_id(first_word)
            if not ingredient_id:
                continue

            severity = "critical" if classification == "Class I" else "high"

            records.append({
                "product_id":       None,
                "ingredient_id":    ingredient_id,
                "country":          "US",
                "status":           "recalled",
                "severity":         severity,
                "shortage_reason":  item.get("reason_for_recall"),
                "source_agency":    "FDA",
                "source_url":       self.FDA_RECALL_API,
                "last_verified_at": self.now_iso(),
            })

        log.info(f"  {len(records)} active FDA recalls")
        return records
