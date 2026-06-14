"""
CMS NADAC (National Average Drug Acquisition Cost) Scraper
──────────────────────────────────────────────────────────
Source:  data.medicaid.gov — official CMS open-data API (no key required)
Dataset: "NADAC (National Average Drug Acquisition Cost) <year>"
Docs:    https://data.medicaid.gov/about

NADAC is the US benchmark for what pharmacies actually pay to acquire drugs
(invoice-based survey, published weekly on Wednesdays). Each weekly snapshot
covers ~30k NDCs. We ingest only the LATEST snapshot per run — the weekly
cron builds the time series, and dedup_hash makes re-runs idempotent.

price_type: pharmacy_purchase (acquisition cost, not retail/reimbursement).
Identifier: NDC — joins onto FDA shortage/DMF/recall data downstream.

Cadence: weekly cron (Thursdays, after the CMS Wednesday refresh).
"""
from __future__ import annotations

import os
import re

from backend.scrapers.pricing.base import PricingScraper

METASTORE_URL = "https://data.medicaid.gov/api/1/metastore/schemas/dataset/items"
DATASTORE_URL = "https://data.medicaid.gov/api/1/datastore/query/{dataset_id}/0"
DATASET_TITLE = re.compile(
    r"^NADAC \(National Average Drug Acquisition Cost\) (\d{4})$"
)
PAGE_SIZE = 2000

# "AMOXICILLIN 500 MG CAPSULE" → name before the first digit, then strength,
# then whatever follows the strength as the form.
_STRENGTH_RE = re.compile(
    r"(\d[\d.,/\-]*\s*(?:MG|MCG|GM|G|ML|MG/ML|MCG/ML|UNIT|UNITS|IU|%|MEQ|MMOL)(?:/[\d.]*\s*(?:ML|GM|HR|ACT))?)",
    re.IGNORECASE,
)


class NADACScraper(PricingScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000100"
    SOURCE_NAME:  str = "CMS NADAC (National Average Drug Acquisition Cost)"
    BASE_URL:     str = "https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 0.6
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    def fetch(self) -> dict:
        # 1. Discover the current-year dataset (CMS publishes one per year).
        items = self._get_json(METASTORE_URL)
        datasets: list[tuple[int, str]] = []
        for item in items:
            m = DATASET_TITLE.match(item.get("title", "").strip())
            if m:
                datasets.append((int(m.group(1)), item["identifier"]))
        if not datasets:
            raise RuntimeError("No NADAC dataset found in data.medicaid.gov metastore")
        year, dataset_id = max(datasets)
        url = DATASTORE_URL.format(dataset_id=dataset_id)
        self.log.info("NADAC dataset resolved", extra={"year": year, "dataset_id": dataset_id})

        # 2. Find the latest weekly snapshot date.
        probe = self._get_json(url, params={
            "limit": 1,
            "sorts[0][property]": "as_of_date",
            "sorts[0][order]": "desc",
        })
        if not probe.get("results"):
            raise RuntimeError(f"NADAC dataset {dataset_id} returned no rows")
        as_of_date = probe["results"][0]["as_of_date"]

        # 3. Page through that snapshot only (~30k rows → ~15 pages).
        #    Dry runs cap at 2 pages so the smoke test stays fast.
        max_pages = 2 if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1" else 100
        rows: list[dict] = []
        offset = 0
        for _ in range(max_pages):
            page = self._get_json(url, params={
                "limit": PAGE_SIZE,
                "offset": offset,
                "conditions[0][property]": "as_of_date",
                "conditions[0][value]": as_of_date,
                "conditions[0][operator]": "=",
            })
            results = page.get("results", [])
            rows.extend(results)
            if len(results) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

        self.log.info(
            "NADAC snapshot fetched",
            extra={"as_of_date": as_of_date, "rows": len(rows)},
        )
        return {
            "dataset_id": dataset_id,
            "year": year,
            "as_of_date": as_of_date,
            "rows": rows,
        }

    def normalize(self, raw: dict) -> list[dict]:
        out: list[dict] = []
        for row in raw.get("rows", []):
            desc = (row.get("ndc_description") or "").strip()
            price = row.get("nadac_per_unit")
            if not desc or not price:
                continue
            try:
                unit_price = float(price)
            except (TypeError, ValueError):
                continue
            if unit_price <= 0:
                continue

            strength_m = _STRENGTH_RE.search(desc)
            strength = strength_m.group(1).strip() if strength_m else None
            # Name = text before the first digit (the resolver strips the rest anyway)
            name = re.split(r"\d", desc, maxsplit=1)[0].strip(" -,") or desc
            form = desc[strength_m.end():].strip(" -,") if strength_m else None

            out.append({
                "product_name":     desc,
                "generic_name":     name,
                "strength":         strength,
                "dosage_form":      (form or "")[:60] or None,
                "pack_description": f"per {row.get('pricing_unit', 'unit')}",
                "price_type":       "pharmacy_purchase",
                "category":         row.get("classification_for_rate_setting"),
                "unit_price":       unit_price,
                "currency":         "USD",
                "effective_date":   row.get("effective_date"),
                "identifier_type":  "NDC",
                "identifier_value": row.get("ndc"),
                "source_url":       self.BASE_URL,
                "raw_record":       row,
            })
        return out


if __name__ == "__main__":
    import json as _json
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1":
        from unittest.mock import MagicMock
        print("=" * 60)
        print("DRY RUN — CMS NADAC (capped at 2 pages)")
        print("=" * 60)
        scraper = NADACScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  snapshot: {raw['as_of_date']}  rows fetched: {len(raw['rows'])}")
        rows = scraper.normalize(raw)
        print(f"  normalized: {len(rows)}")
        for r in rows[:8]:
            print(f"    {r['effective_date']}  {r['product_name'][:45]:45} "
                  f"NDC {r['identifier_value']:>12}  ${r['unit_price']:<9} {r['pack_description']}")
        sys.exit(0)

    scraper = NADACScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
