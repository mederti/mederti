"""
MHRA (UK) Drug Recall Scraper

Uses the GOV.UK search API for medical_safety_alert items
(type: medicines-recall-notification).

SPS NHS shortage data requires login — not available publicly.
"""
from __future__ import annotations

import logging
import requests
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

GOV_UK_SEARCH = "https://www.gov.uk/api/search.json"
PAGE_SIZE = 100


class MHRARecallScraper(BaseScraper):
    scraper_name = "mhra_recall"
    country      = "GB"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching MHRA recalls from GOV.UK...")
        all_items = []
        start = 0

        while True:
            r = requests.get(GOV_UK_SEARCH, params={
                "filter_format": "medical_safety_alert",
                "filter_alert_type": "medicines-recall-notification",
                "count": PAGE_SIZE,
                "start": start,
                "fields": "title,link,public_timestamp,alert_type",
            }, timeout=30)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            if not results:
                break

            all_items.extend(results)
            total = data.get("total", 0)
            log.info(f"  Fetched {len(all_items)}/{total} recall alerts...")

            if len(all_items) >= total:
                break
            start += PAGE_SIZE

        log.info(f"  Total MHRA recall alerts: {len(all_items)}")
        return self._build_records(all_items)

    def _build_records(self, items: list) -> list[dict]:
        records = []
        for item in items:
            title = item.get("title") or ""
            link  = item.get("link") or ""

            # Extract drug name from title pattern:
            # "Class 2 Medicines Recall: Company, Drug Name, EL(...)..."
            drug_name = self._extract_drug_name(title)
            if not drug_name:
                continue

            # Try to match to our ingredient database
            first_word = drug_name.split()[0].lower() if drug_name.split() else ""
            if not first_word or len(first_word) < 3:
                continue

            ingredient_id = self.lookup_ingredient_id(first_word)
            if not ingredient_id:
                continue

            severity = "critical" if "Class 1" in title else "high" if "Class 2" in title else "medium"

            records.append({
                "product_id":       None,
                "ingredient_id":    ingredient_id,
                "country":          "GB",
                "status":           "recalled",
                "severity":         severity,
                "shortage_reason":  title,
                "source_agency":    "MHRA",
                "source_url":       f"https://www.gov.uk{link}" if link.startswith("/") else link,
                "last_verified_at": self.now_iso(),
            })

        return records

    def _extract_drug_name(self, title: str) -> str:
        """Extract drug name from MHRA recall title format."""
        # Pattern: "Class N Medicines Recall: Company, Drug Name Dose, EL(...)..."
        if ":" not in title:
            return ""
        after_colon = title.split(":", 1)[1].strip()
        # Split by comma — drug name is usually the second part
        parts = [p.strip() for p in after_colon.split(",")]
        if len(parts) >= 2:
            return parts[1].split(" EL(")[0].strip()
        return parts[0].split(" EL(")[0].strip()
