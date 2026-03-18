#!/usr/bin/env python3
"""
Populate drug_catalogue with MHRA (GB) and EMA (EU) data from existing
drug_products + product_ingredients tables.

Usage:
    python scripts/catalogue_import_mhra_ema.py --dry-run
    python scripts/catalogue_import_mhra_ema.py
"""
from __future__ import annotations

import os
import re
import sys
import logging

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DRY_RUN = "--dry-run" in sys.argv

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

SALT_SUFFIXES = [
    "hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium",
    "sulfate", "sulphate", "phosphate", "acetate", "citrate", "tartrate",
    "maleate", "fumarate", "succinate", "mesylate", "besylate", "pamoate",
    "monohydrate", "dihydrate", "trihydrate", "hemihydrate",
    "disodium", "trisodium", "dipotassium",
]

SOURCE_MAP = {
    "GB": {"source_name": "MHRA", "db_source": "MHRA"},
    "EU": {"source_name": "EMA EPAR", "db_source": "EMA"},
}


def strip_salt(name: str) -> str:
    name = name.lower().strip()
    for suffix in SALT_SUFFIXES:
        pattern = r'\s+' + re.escape(suffix) + r'$'
        name = re.sub(pattern, '', name).strip()
    return name


def fetch_all(supabase, table, select, **filters):
    all_rows: list[dict] = []
    offset = 0
    batch_size = 1000
    while True:
        q = supabase.table(table).select(select)
        for k, v in filters.items():
            q = q.eq(k, v)
        result = q.range(offset, offset + batch_size - 1).execute()
        all_rows.extend(result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size
    return all_rows


def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Load drugs table for linking
    log.info("Fetching drugs for linking...")
    all_drugs = fetch_all(supabase, "drugs", "id, generic_name")
    drug_index: dict[str, str] = {}
    for d in all_drugs:
        gn = (d.get("generic_name") or "").lower().strip()
        if gn:
            drug_index[gn] = d["id"]
            stripped = strip_salt(gn)
            if stripped != gn:
                drug_index.setdefault(stripped, d["id"])
            first = stripped.split()[0]
            if len(first) > 5:
                drug_index.setdefault(first, d["id"])
    log.info(f"  Drug index: {len(drug_index)} entries")

    for country_code, cfg in SOURCE_MAP.items():
        source_name = cfg["source_name"]
        db_source = cfg["db_source"]

        # Check existing
        existing = supabase.table("drug_catalogue").select("id", count="exact") \
            .eq("source_name", source_name).execute()
        log.info(f"\n{'='*50}")
        log.info(f"Processing {source_name} ({country_code})")
        log.info(f"Existing in drug_catalogue: {existing.count}")
        if existing.count and existing.count > 100:
            log.info("Already imported — skipping.")
            continue

        # Fetch products
        log.info(f"Fetching {country_code} drug_products...")
        products = fetch_all(supabase, "drug_products",
                             "id, product_name, trade_name, strength, dosage_form, "
                             "registry_id, registry_status, registration_date, "
                             "country, source, sponsors(name)",
                             country=country_code)
        log.info(f"  {len(products)} products")

        if not products:
            log.info("No products found — skipping.")
            continue

        # Fetch ingredients via product_ingredients junction
        log.info("Fetching ingredients...")
        product_ids = [p["id"] for p in products]
        ingredient_map: dict[str, str] = {}  # product_id -> ingredient name

        for i in range(0, len(product_ids), 200):
            batch_ids = product_ids[i:i + 200]
            # Get primary ingredients first
            result = supabase.table("product_ingredients") \
                .select("product_id, is_primary, active_ingredients(name)") \
                .in_("product_id", batch_ids) \
                .execute()
            for r in result.data:
                pid = r["product_id"]
                ing = r.get("active_ingredients", {})
                name = ing.get("name", "") if isinstance(ing, dict) else ""
                if name and pid not in ingredient_map:
                    ingredient_map[pid] = name

        log.info(f"  {len(ingredient_map)} products have ingredients")

        # Build catalogue rows
        log.info("Building catalogue rows...")
        catalogue_rows = []
        stats = {"with_ingredient": 0, "fallback": 0, "linked": 0}

        for p in products:
            product_name = p.get("product_name", "")
            reg_id = p.get("registry_id", "")

            # Get generic name from ingredient map
            ingredient = ingredient_map.get(p["id"])
            if ingredient:
                generic_name = ingredient.title()
                stats["with_ingredient"] += 1
            else:
                generic_name = product_name
                stats["fallback"] += 1

            # Get sponsor
            sponsor = p.get("sponsors")
            sponsor_name = sponsor.get("name") if isinstance(sponsor, dict) else None

            # Link to drugs table
            drug_id = None
            if ingredient:
                gn_lower = ingredient.lower().strip()
                drug_id = drug_index.get(gn_lower)
                if not drug_id:
                    stripped = strip_salt(gn_lower)
                    drug_id = drug_index.get(stripped)
                if not drug_id:
                    first = gn_lower.split()[0]
                    if len(first) > 5:
                        drug_id = drug_index.get(first)
            if drug_id:
                stats["linked"] += 1

            row = {
                "generic_name": generic_name,
                "brand_name": product_name,
                "registration_number": reg_id,
                "source_country": country_code,
                "source_name": source_name,
                "registration_status": (p.get("registry_status") or "active").lower(),
                "sponsor": sponsor_name,
                "dosage_form": p.get("dosage_form"),
                "strength": p.get("strength"),
                "drug_id": drug_id,
            }
            catalogue_rows.append(row)

        total = len(catalogue_rows)
        log.info(f"  {total} rows built")
        log.info(f"  With ingredient name: {stats['with_ingredient']} ({round(stats['with_ingredient']/total*100,1)}%)")
        log.info(f"  Fallback (product name): {stats['fallback']}")
        log.info(f"  Linked to drugs: {stats['linked']} ({round(stats['linked']/total*100,1)}%)")

        # Show samples
        log.info("")
        log.info("Sample records:")
        shown = 0
        for r in catalogue_rows:
            if r["drug_id"] and shown < 3:
                log.info(f"  [LINKED]   generic={r['generic_name'][:35]:35s}  brand={r['brand_name'][:30]:30s}  reg={r['registration_number']}")
                shown += 1
        shown = 0
        for r in catalogue_rows:
            if not r["drug_id"] and r["generic_name"] != r["brand_name"] and shown < 2:
                log.info(f"  [UNLINKED] generic={r['generic_name'][:35]:35s}  brand={r['brand_name'][:30]:30s}  reg={r['registration_number']}")
                shown += 1

        if DRY_RUN:
            log.info(f"\nDRY RUN — {total} {source_name} rows would be inserted.")
            continue

        # Insert
        log.info(f"\nInserting {total} rows...")
        BATCH = 200
        inserted = 0
        for i in range(0, total, BATCH):
            chunk = catalogue_rows[i:i + BATCH]
            supabase.table("drug_catalogue").insert(chunk).execute()
            inserted += len(chunk)
            if (i // BATCH) % 10 == 0 or inserted == total:
                log.info(f"  {inserted}/{total}")

        log.info(f"Complete. Inserted {total} {source_name} records.")

    log.info("\nAll done.")


if __name__ == "__main__":
    main()
