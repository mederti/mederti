#!/usr/bin/env python3
"""
MHRA Drug Universe Importer (United Kingdom)

Uses the MHRA Category Lists published under the Windsor Framework:
  https://www.gov.uk/government/publications/category-lists-following-implementation-of-the-windsor-framework

The Excel file contains all currently authorised UK medicines with:
  - Authorisation Number (PL number)
  - Authorisation Holder Company Name
  - Licensed Product Name
  - Active Substance Name
  - Legal Status Type (POM/P/GSL)

Usage:
    python scripts/import_mhra.py                               # download from gov.uk
    python scripts/import_mhra.py --file /tmp/mhra_data/cat1.xlsx  # use local file
    python scripts/import_mhra.py --dry-run
"""
from __future__ import annotations

import os
import sys
import argparse
import logging
import requests
import pandas as pd
from io import BytesIO
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_utils import (
    clean, extract_strength, normalise_dosage_form,
    upsert_batches, load_sponsor_id_map, load_ingredient_id_map, load_product_id_map
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# MHRA Category 1 list (all UK-authorised medicines)
MHRA_XLSX_URL = "https://assets.publishing.service.gov.uk/media/69a591d5238e02a088ce17f9/All_PL_listing_Category_2_For_publication__220226.xlsx"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def load_data(file_path: str | None) -> pd.DataFrame:
    if file_path:
        log.info(f"Loading from {file_path}")
        if file_path.endswith(".csv"):
            df = pd.read_csv(file_path, dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
    else:
        log.info("Downloading MHRA Category list from GOV.UK...")
        r = requests.get(MHRA_XLSX_URL, timeout=120)
        r.raise_for_status()
        log.info(f"Downloaded {len(r.content)/1024:.0f} KB")
        df = pd.read_excel(BytesIO(r.content), dtype=str)

    df.columns = [c.strip() for c in df.columns]
    log.info(f"Loaded {len(df)} rows, columns: {list(df.columns)}")
    return df


def run(df: pd.DataFrame, supabase: Client, dry_run: bool):
    # Expected columns
    col_auth    = 'Authorisation Number'
    col_company = 'Authorisation Holder Company Name'
    col_product = 'Licensed Product Name'
    col_active  = 'Active Substance Name'
    col_status  = 'Legal Status Type'

    for c in [col_auth, col_company, col_product, col_active, col_status]:
        if c not in df.columns:
            log.error(f"Missing expected column: {c}")
            log.error(f"Available columns: {list(df.columns)}")
            return

    # ── 1. Sponsors (MAH companies) ─────────────────────────────────────────
    log.info("Processing sponsors...")
    companies = df[col_company].dropna().str.strip().unique()
    sponsor_rows = [{"name": n, "country": "GB"} for n in sorted(companies) if n]
    log.info(f"  {len(sponsor_rows)} unique sponsors")
    if not dry_run:
        upsert_batches(supabase, "sponsors", sponsor_rows, "name_normalised")

    # ── 2. Active ingredients ────────────────────────────────────────────────
    log.info("Processing active ingredients...")
    substances = df[col_active].dropna().str.strip().unique()
    ingredient_rows = [{"name": n} for n in sorted(substances) if n and len(n) > 1]
    log.info(f"  {len(ingredient_rows)} unique active substances")
    if not dry_run:
        upsert_batches(supabase, "active_ingredients", ingredient_rows, "name_normalised")

    # Load ID maps
    sponsor_id_map    = load_sponsor_id_map(supabase) if not dry_run else {}
    ingredient_id_map = load_ingredient_id_map(supabase) if not dry_run else {}

    # ── 3. Drug products ──────────────────────────────────────────────────────
    log.info("Processing drug products...")

    # Deduplicate: group by (PL number, product name) to get unique products
    # Multiple rows can exist for same PL number with different active substances
    product_groups = df.groupby([col_auth, col_product]).agg({
        col_company: 'first',
        col_active:  lambda x: '; '.join(sorted(set(x.dropna().str.strip()))),
        col_status:  'first',
    }).reset_index()

    product_rows = []
    for _, row in product_groups.iterrows():
        pl_number = clean(row[col_auth])
        prod_name = clean(row[col_product])
        if not prod_name or not pl_number:
            continue

        company = clean(row[col_company])
        schedule = clean(row[col_status])

        product_rows.append({
            "registry_id":       pl_number,
            "product_name":      prod_name,
            "strength":          extract_strength(prod_name),
            "dosage_form":       normalise_dosage_form(prod_name),
            "schedule":          schedule,
            "registry_status":   "Active",
            "sponsor_id":        sponsor_id_map.get(company.lower().strip()) if company else None,
            "country":           "GB",
            "source":            "MHRA",
        })

    log.info(f"  {len(product_rows)} drug products")
    if not dry_run:
        upsert_batches(supabase, "drug_products", product_rows, "source,registry_id")

    # ── 4. Product <-> ingredient junction ────────────────────────────────────
    if not dry_run:
        product_id_map = load_product_id_map(supabase, "GB")
        log.info("Building product<->ingredient links...")
        junction_rows = []
        seen = set()

        for _, row in df.iterrows():
            pl_number = clean(row[col_auth])
            substance = clean(row[col_active])
            if not pl_number or not substance:
                continue

            db_prod_id = product_id_map.get(pl_number)
            if not db_prod_id:
                continue

            ingr_name = substance.lower().strip()
            db_ingr_id = ingredient_id_map.get(ingr_name)
            if not db_ingr_id:
                continue

            key = (db_prod_id, db_ingr_id)
            if key in seen:
                continue
            seen.add(key)

            junction_rows.append({
                "product_id":    db_prod_id,
                "ingredient_id": db_ingr_id,
                "is_primary":    True,
            })

        log.info(f"  {len(junction_rows)} links")
        upsert_batches(supabase, "product_ingredients", junction_rows, "product_id,ingredient_id")

    log.info(f"GB import done — {len(product_rows)} products, {len(ingredient_rows)} ingredients")


def clean(val) -> str | None:
    """Local clean function for pandas values."""
    if pd.isna(val):
        return None
    s = str(val).strip()
    return None if s in ("", "nan", "NaN", "None", "-") else s


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    help="Local MHRA Excel/CSV file path")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    df = load_data(args.file)
    run(df, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
