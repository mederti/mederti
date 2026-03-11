"""
TGA (Australia) Drug Shortage Scraper
Scrapes the TGA Medicine Shortage Information page.

The TGA embeds shortage data as a JS variable (tabularData) in the HTML.
Source: https://apps.tga.gov.au/Prod/msi/search
"""
from __future__ import annotations

import json
import logging
import re
import requests
from datetime import datetime
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

TGA_URL = "https://apps.tga.gov.au/Prod/msi/search"


class TGAShortageScraper(BaseScraper):
    scraper_name = "tga_shortage"
    country      = "AU"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching TGA shortages...")

        r = requests.get(TGA_URL, timeout=30)
        r.raise_for_status()

        # Extract embedded tabularData JS variable
        match = re.search(r'var\s+tabularData\s*=\s*(\{.*?\});', r.text, re.DOTALL)
        if not match:
            log.error("Could not find tabularData in TGA page")
            return []

        data = json.loads(match.group(1))
        items = data.get("records", [])
        log.info(f"  Found {len(items)} shortage items")

        records = []
        for item in items:
            # TGA fields: active_ingredients, artg_numb, trade_names,
            #   status (C=Current), availability, shortage_impact, shortage_end
            ingredient_name = item.get("active_ingredients") or ""
            artg_id   = item.get("artg_numb") or ""
            status    = item.get("status") or ""
            avail     = item.get("availability") or ""

            if not ingredient_name:
                continue

            # Skip resolved/deleted shortages
            if status not in ("C", ""):
                continue

            product_id = None
            if artg_id:
                product_id = self.lookup_product_id(str(artg_id).strip(), "TGA_ARTG")

            ingredient_id = None
            if not product_id:
                ingredient_id = self.lookup_ingredient_id(ingredient_name.lower().strip())

            if not product_id and not ingredient_id:
                log.debug(f"  No match for: {ingredient_name} (ARTG: {artg_id})")
                continue

            severity = self._map_severity(
                item.get("shortage_impact") or item.get("availability") or ""
            )

            records.append({
                "product_id":        product_id,
                "ingredient_id":     ingredient_id,
                "country":           "AU",
                "status":            "shortage",
                "severity":          severity,
                "shortage_reason":   item.get("tga_shortage_management_action_raw"),
                "expected_resolution": self._parse_date(item.get("shortage_end")),
                "source_agency":     "TGA",
                "source_url":        TGA_URL,
                "last_verified_at":  self.now_iso(),
            })

        return records

    def _map_severity(self, raw: str) -> str:
        if not raw:
            return "medium"
        r = raw.lower()
        if "critical" in r or "unavailable" in r:
            return "critical"
        if "high" in r:
            return "high"
        if "low" in r or "minor" in r:
            return "low"
        return "medium"

    def _parse_date(self, val) -> str | None:
        if not val:
            return None
        for fmt in ("%d %b %Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%B %Y"):
            try:
                return datetime.strptime(str(val).strip(), fmt).date().isoformat()
            except ValueError:
                continue
        return None
