"""
Health Canada Drug Shortage Scraper (Railway)
Fetches active shortage data from the Health Canada bulk CSV export.

Source: https://healthproductshortages.ca/search/export (POST, no auth)
Returns ZIP containing shortage_report_export.csv.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import zipfile
import requests
from datetime import datetime, date
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

EXPORT_URL = "https://healthproductshortages.ca/search/export"

# Status filters to fetch (skip resolved — too large and times out)
EXPORT_STATUSES = ["active_confirmed", "anticipated_shortage"]

# HC status string → severity modifier
SEVERITY_KEYWORDS_HIGH = [
    "intravenous", "parenteral", "infusion", "injection",
    "insulin", "antidiabetic", "cardiac", "antineoplastic",
    "blood glucose", "immunosuppressant", "transplant",
    "antiinfective", "antibacterial", "antifungal",
]


class HealthCanadaShortageScraper(BaseScraper):
    scraper_name = "health_canada_shortage"
    country      = "CA"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching Health Canada shortages...")

        all_rows: list[dict] = []
        for status_filter in EXPORT_STATUSES:
            rows = self._fetch_export(status_filter)
            log.info(f"  HC export '{status_filter}': {len(rows)} rows")
            all_rows.extend(rows)

        log.info(f"  Total HC rows fetched: {len(all_rows)}")

        records = []
        for row in all_rows:
            rec = self._process_row(row)
            if rec:
                records.append(rec)

        log.info(f"  Matched {len(records)} records to products/ingredients")
        return records

    def _fetch_export(self, status_filter: str) -> list[dict]:
        """POST to HC export endpoint, get ZIP, extract CSV, parse to dicts."""
        form_data = {
            "filter_types[]":          "shortages",
            "filter_statuses[]":       status_filter,
            "export[filter_types]":    "shortages",
            "export[filter_statuses]": status_filter,
        }

        r = requests.post(
            EXPORT_URL,
            data=form_data,
            timeout=120,
            headers={
                "User-Agent": "Mederti-Scraper/1.0 (https://mederti.com)",
                "Accept": "*/*",
            },
        )
        r.raise_for_status()

        # Unzip
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            csv_name = zf.namelist()[0]
            raw_csv = zf.read(csv_name).decode("utf-8-sig")

        # Row 0 is a disclaimer banner — skip it
        lines = raw_csv.splitlines()
        csv_body = "\n".join(lines[1:])

        reader = csv.DictReader(io.StringIO(csv_body))
        return list(reader)

    def _process_row(self, row: dict) -> dict | None:
        """Convert a single HC CSV row to a drug_availability record."""
        # ── Drug identity ────────────────────────────────────────────────
        ingredients_raw = (row.get("Ingredients") or "").strip()
        common_name     = (row.get("Common or Proper name") or "").strip()

        if ingredients_raw:
            ingredient_name = ingredients_raw.split(";")[0].strip()
        elif common_name:
            ingredient_name = common_name
        else:
            return None

        # ── Product lookup via DIN ───────────────────────────────────────
        din = (row.get("Drug Identification Number") or "").strip()
        product_id = None
        if din:
            product_id = self.lookup_product_id(din, "HC_DPD")

        # ── Ingredient fallback ──────────────────────────────────────────
        ingredient_id = None
        if not product_id:
            ingredient_id = self.lookup_ingredient_id(ingredient_name.lower().strip())

        if not product_id and not ingredient_id:
            log.debug(f"  No match for: {ingredient_name} (DIN: {din})")
            return None

        # ── Severity ─────────────────────────────────────────────────────
        severity = self._infer_severity(row, ingredient_name)

        # ── Expected resolution ──────────────────────────────────────────
        estimated_end = self._as_date(row.get("Estimated end date"))

        # ── Reason ───────────────────────────────────────────────────────
        reason = (row.get("Reason") or "").strip() or None

        return {
            "product_id":         product_id,
            "ingredient_id":      ingredient_id,
            "country":            "CA",
            "status":             "shortage",
            "severity":           severity,
            "shortage_reason":    reason,
            "expected_resolution": estimated_end,
            "source_agency":      "Health Canada",
            "source_url":         EXPORT_URL,
            "last_verified_at":   self.now_iso(),
        }

    def _infer_severity(self, row: dict, ingredient_name: str) -> str:
        """Derive severity from Tier 3 flag, route, ATC, and drug name."""
        tier3 = (row.get("Tier 3") or "No").strip().lower() == "yes"
        if tier3:
            return "critical"

        route    = (row.get("Route of administration") or "").lower()
        atc_desc = (row.get("ATC description") or "").lower()
        combined = f"{route} {atc_desc} {ingredient_name.lower()}"

        for kw in SEVERITY_KEYWORDS_HIGH:
            if kw in combined:
                return "high"

        return "medium"

    @staticmethod
    def _as_date(raw: str | None) -> str | None:
        """Validate HC date (already YYYY-MM-DD). Return None if invalid."""
        if not raw:
            return None
        s = raw.strip()
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            return s
        return None
