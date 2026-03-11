#!/usr/bin/env python3
"""
FDA National Drug Code (NDC) Directory Importer (USA)

The NDC ZIP contains several pipe-delimited text files:
  - product.txt     — one row per drug product (this is the main one)
  - package.txt     — packaging variants (we skip this for now)
  - ndctext.pdf     — documentation (ignore)

Usage:
    python scripts/import_fda_ndc.py
    python scripts/import_fda_ndc.py --file ~/Downloads/ndctext.zip
    python scripts/import_fda_ndc.py --dry-run
    python scripts/import_fda_ndc.py --limit 10000   # for testing

Data docs: https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory
"""
from __future__ import annotations

import os
import sys
import argparse
import logging
import zipfile
import requests
import pandas as pd
from io import BytesIO, StringIO
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_utils import (
    clean, parse_date, extract_strength, normalise_dosage_form,
    extract_ingredient_names, upsert_batches,
    load_sponsor_id_map, load_ingredient_id_map, load_product_id_map
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
FDA_NDC_URL  = "https://www.accessdata.fda.gov/cder/ndctext.zip"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def load_data(file_path: str | None, limit: int | None) -> pd.DataFrame:
    if file_path:
        log.info(f"Loading FDA NDC from {file_path}")
        z = zipfile.ZipFile(file_path)
    else:
        log.info(f"Downloading FDA NDC from {FDA_NDC_URL}...")
        r = requests.get(FDA_NDC_URL, timeout=180)
        r.raise_for_status()
        log.info(f"Downloaded {len(r.content)/1024/1024:.1f} MB")
        z = zipfile.ZipFile(BytesIO(r.content))

    # Find product.txt (case-insensitive)
    product_file = next((f for f in z.namelist() if "product" in f.lower() and f.endswith(".txt")), None)
    if not product_file:
        raise RuntimeError(f"product.txt not found in ZIP. Contents: {z.namelist()}")

    log.info(f"Reading {product_file}...")
    with z.open(product_file) as f:
        content = f.read().decode("utf-8", errors="replace")

    df = pd.read_csv(
        StringIO(content),
        sep="\t",
        dtype=str,
        low_memory=False,
        on_bad_lines="skip"
    )
    df.columns = [c.strip() for c in df.columns]
    log.info(f"Loaded {len(df)} NDC product rows, columns: {list(df.columns[:10])}...")

    # Filter out excluded products
    if "NDCEXCLUDEFLAG" in df.columns:
        before = len(df)
        df = df[df["NDCEXCLUDEFLAG"].isna() | (df["NDCEXCLUDEFLAG"].str.strip() != "Y")]
        log.info(f"  Excluded {before - len(df)} flagged products")

    if limit:
        df = df.head(limit)
        log.info(f"  Limited to {limit} rows for testing")

    return df


def get_col(row: pd.Series, col_name: str) -> str | None:
    val = row.get(col_name)
    return clean(val)


def run(df: pd.DataFrame, supabase: Client, dry_run: bool):

    # ── Sponsors ────────────────────────────────────────────────────────────────
    log.info("Processing sponsors...")
    sponsor_names = set()
    for _, row in df.iterrows():
        n = get_col(row, "LABELERNAME")
        if n:
            sponsor_names.add(n)
    sponsor_rows  = [{"name": n, "country": "US"} for n in sorted(sponsor_names)]
    log.info(f"  {len(sponsor_rows)} unique sponsors")
    if not dry_run:
        upsert_batches(supabase, "sponsors", sponsor_rows, "name_normalised")

    # ── Active ingredients ───────────────────────────────────────────────────────
    log.info("Processing active ingredients...")
    ingredient_names = set()
    for _, row in df.iterrows():
        # FDA uses SUBSTANCENAME for clean ingredient names
        substance = get_col(row, "SUBSTANCENAME")
        if substance:
            for part in substance.replace(";", ",").split(","):
                name = part.strip().lower()
                if name and len(name) > 2:
                    ingredient_names.add(name)
        # Also parse from NONPROPRIETARYNAME as fallback
        nonprop = get_col(row, "NONPROPRIETARYNAME")
        if nonprop:
            ingredient_names.update(extract_ingredient_names(nonprop))

    ingredient_rows = [{"name": n} for n in sorted(ingredient_names)]
    log.info(f"  {len(ingredient_rows)} unique ingredients")
    if not dry_run:
        upsert_batches(supabase, "active_ingredients", ingredient_rows, "name_normalised")

    sponsor_id_map    = load_sponsor_id_map(supabase) if not dry_run else {}
    ingredient_id_map = load_ingredient_id_map(supabase) if not dry_run else {}

    # ── Drug products ────────────────────────────────────────────────────────────
    log.info("Processing drug products...")
    product_rows = []
    seen = set()

    for _, row in df.iterrows():
        registry_id = get_col(row, "PRODUCTNDC")
        prod_name   = get_col(row, "PROPRIETARYNAME") or get_col(row, "NONPROPRIETARYNAME")
        if not prod_name or not registry_id:
            continue
        if registry_id in seen:
            continue
        seen.add(registry_id)

        sponsor_name = get_col(row, "LABELERNAME")
        strength_val = get_col(row, "ACTIVE_NUMERATOR_STRENGTH")
        strength_unit = get_col(row, "ACTIVE_INGRED_UNIT")
        strength = f"{strength_val}{strength_unit}" if strength_val and strength_unit else extract_strength(prod_name)

        market_end = get_col(row, "ENDMARKETINGDATE")
        status = "Discontinued" if market_end else "Active"

        product_rows.append({
            "registry_id":       registry_id,
            "product_name":      prod_name,
            "trade_name":        get_col(row, "PROPRIETARYNAME"),
            "strength":          strength,
            "dosage_form":       normalise_dosage_form(get_col(row, "DOSAGEFORMNAME")),
            "route":             get_col(row, "ROUTENAME"),
            "product_category":  get_col(row, "PRODUCTTYPENAME"),
            "schedule":          get_col(row, "DEASCHEDULE"),
            "registry_status":   status,
            "registration_date": parse_date(get_col(row, "STARTMARKETINGDATE")),
            "cancellation_date": parse_date(market_end),
            "sponsor_id":        sponsor_id_map.get(sponsor_name.lower().strip()) if sponsor_name else None,
            "country":           "US",
            "source":            "FDA_NDC",
        })

    log.info(f"  {len(product_rows)} products")
    if not dry_run:
        upsert_batches(supabase, "drug_products", product_rows, "source,registry_id")

    # ── Product <-> ingredient junction ──────────────────────────────────────────
    if not dry_run:
        product_id_map = load_product_id_map(supabase, "US")
        log.info("Building product<->ingredient links...")
        junction_rows = []
        seen_junc = set()
        for _, row in df.iterrows():
            reg_id  = get_col(row, "PRODUCTNDC")
            prod_id = product_id_map.get(reg_id)
            if not prod_id:
                continue
            # FDA SUBSTANCENAME is the cleanest source
            substance = get_col(row, "SUBSTANCENAME") or get_col(row, "NONPROPRIETARYNAME")
            names = []
            if substance:
                for part in substance.replace(";", ",").split(","):
                    n = part.strip().lower()
                    if n and len(n) > 2:
                        names.append(n)
            for i, name in enumerate(names):
                ingr_id = ingredient_id_map.get(name)
                if ingr_id:
                    key = (prod_id, ingr_id)
                    if key in seen_junc:
                        continue
                    seen_junc.add(key)
                    junction_rows.append({
                        "product_id":    prod_id,
                        "ingredient_id": ingr_id,
                        "is_primary":    i == 0,
                    })
        log.info(f"  {len(junction_rows)} links")
        upsert_batches(supabase, "product_ingredients", junction_rows, "product_id,ingredient_id")

    log.info(f"US FDA NDC import done — {len(product_rows)} products")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    help="Local NDC ZIP path")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit",   type=int, help="Limit rows for testing")
    args = parser.parse_args()
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    df = load_data(args.file, args.limit)
    run(df, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
