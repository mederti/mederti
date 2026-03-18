#!/usr/bin/env python3
"""
Populate drug_catalogue with TGA ARTG data from existing drug_products table.

Extracts generic/ingredient names from TGA product names using the pattern:
  "BRAND ingredient strength form packaging"
  e.g. "AMOXICILLIN MLABS amoxicillin (as trihydrate) 125 mg/5 mL powder"
       → generic_name = "Amoxicillin"

Usage:
    python scripts/catalogue_import_tga.py --dry-run
    python scripts/catalogue_import_tga.py
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

# Salt forms to strip for drug matching
SALT_SUFFIXES = [
    "hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium",
    "sulfate", "sulphate", "phosphate", "acetate", "citrate", "tartrate",
    "maleate", "fumarate", "succinate", "gluconate", "chloride", "bromide",
    "mesylate", "besylate", "tosylate", "pamoate",
    "monohydrate", "dihydrate", "trihydrate", "hemihydrate", "anhydrous",
    "disodium", "trisodium", "dipotassium",
]


def extract_ingredient(product_name: str) -> str | None:
    """
    Extract generic/ingredient name from TGA ARTG product name.

    Pattern: "BRAND ingredient strength form packaging"
    The ingredient appears in lowercase between the UPPER brand and the numeric strength.
    """
    if not product_name:
        return None

    parts = product_name.split()
    lowercase_parts = []

    for p in parts:
        # Stop at digits (strength), parenthetical (salt form qualifier)
        if re.match(r'^\d', p):
            break
        if p.startswith('('):
            break
        # Collect lowercase words (ingredient name)
        if p == p.lower() and len(p) > 1:
            lowercase_parts.append(p)

    if not lowercase_parts:
        return None

    ingredient = " ".join(lowercase_parts)

    # Skip junk matches
    if ingredient in ("for", "and", "with", "plus", "the", "in"):
        return None
    if len(ingredient) < 3:
        return None

    return ingredient


def strip_salt(name: str) -> str:
    """Strip salt/ester suffixes for matching."""
    name = name.lower().strip()
    for suffix in SALT_SUFFIXES:
        pattern = r'\s+' + re.escape(suffix) + r'$'
        name = re.sub(pattern, '', name).strip()
    return name


def fetch_all(supabase, table, select, **filters):
    """Fetch all rows handling Supabase pagination."""
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

    # Check existing
    existing = supabase.table("drug_catalogue").select("id", count="exact") \
        .eq("source_name", "TGA ARTG").execute()
    log.info(f"Existing TGA ARTG in drug_catalogue: {existing.count}")
    if existing.count and existing.count > 1000:
        log.info("Already imported. Exiting.")
        return

    # Fetch AU drug_products with sponsor join
    log.info("Fetching AU drug_products...")
    products = fetch_all(supabase, "drug_products",
                         "id, product_name, strength, dosage_form, registry_id, "
                         "registry_status, registration_date, country, source, "
                         "product_category, sponsors(name)",
                         country="AU")
    log.info(f"  {len(products)} AU products")

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

    # Build catalogue rows
    log.info("Building catalogue rows...")
    catalogue_rows = []
    stats = {"extracted": 0, "fallback": 0, "linked": 0}

    for p in products:
        product_name = p.get("product_name", "")
        reg_id = p.get("registry_id", "")

        # Extract ingredient from product name
        ingredient = extract_ingredient(product_name)
        if ingredient:
            generic_name = ingredient.title()
            stats["extracted"] += 1
        else:
            # Fallback: use full product name
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
                first = (stripped if 'stripped' in dir() else gn_lower).split()[0]
                if len(first) > 5:
                    drug_id = drug_index.get(first)
        if drug_id:
            stats["linked"] += 1

        row = {
            "generic_name": generic_name,
            "brand_name": product_name,
            "registration_number": reg_id,
            "source_country": "AU",
            "source_name": "TGA ARTG",
            "registration_status": (p.get("registry_status") or "active").lower(),
            "sponsor": sponsor_name,
            "dosage_form": p.get("dosage_form"),
            "strength": p.get("strength"),
            "drug_id": drug_id,
        }
        catalogue_rows.append(row)

    log.info(f"  {len(catalogue_rows)} rows built")
    log.info(f"  Ingredient extracted: {stats['extracted']} ({round(stats['extracted']/len(catalogue_rows)*100,1)}%)")
    log.info(f"  Fallback (full name): {stats['fallback']}")
    log.info(f"  Linked to drugs: {stats['linked']} ({round(stats['linked']/len(catalogue_rows)*100,1)}%)")

    # Show samples
    log.info("")
    log.info("Sample records:")
    shown = 0
    for r in catalogue_rows:
        if r["drug_id"] and shown < 3:
            log.info(f"  [LINKED]   generic={r['generic_name'][:35]:35s}  reg={r['registration_number']}  sponsor={str(r['sponsor'])[:25]}")
            shown += 1
    shown = 0
    for r in catalogue_rows:
        if not r["drug_id"] and r["generic_name"] != r["brand_name"] and shown < 2:
            log.info(f"  [UNLINKED] generic={r['generic_name'][:35]:35s}  reg={r['registration_number']}")
            shown += 1

    if DRY_RUN:
        log.info(f"\nDRY RUN — {len(catalogue_rows)} rows would be inserted.")
        return

    # Insert in batches
    log.info(f"\nInserting {len(catalogue_rows)} rows...")
    BATCH = 200
    inserted = 0
    for i in range(0, len(catalogue_rows), BATCH):
        chunk = catalogue_rows[i:i + BATCH]
        supabase.table("drug_catalogue").insert(chunk).execute()
        inserted += len(chunk)
        if (i // BATCH) % 20 == 0 or inserted == len(catalogue_rows):
            log.info(f"  {inserted}/{len(catalogue_rows)}")

    log.info(f"Complete. Inserted {len(catalogue_rows)} TGA ARTG records.")


if __name__ == "__main__":
    main()
