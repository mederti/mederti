#!/usr/bin/env python3
"""
EMA European Medicines Register Importer (EU — 27 countries)

The EMA publishes a downloadable Excel of all centrally authorised medicines.
Note: This covers centrally authorised products only.

Data source:
    https://www.ema.europa.eu/en/medicines/download-medicine-data
    File: Medicines_output_european_public_assessment_reports.xlsx

Usage:
    python scripts/import_ema.py
    python scripts/import_ema.py --file ~/Downloads/ema_medicines.xlsx
    python scripts/import_ema.py --dry-run
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
    clean, parse_date, extract_strength, normalise_dosage_form,
    extract_ingredient_names, upsert_batches, resolve_col,
    load_sponsor_id_map, load_ingredient_id_map, load_product_id_map
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
EMA_URL      = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

COL_CANDIDATES = {
    "registry_id":       ["ema_product_number", "product_number"],
    "product_name":      ["name_of_medicine", "medicine_name"],
    "trade_name":        ["name_of_medicine", "medicine_name"],
    "sponsor":           ["marketing_authorisation_developer_/_applicant_/_holder",
                          "marketing_authorisation_holder", "mah"],
    "dosage_form":       ["pharmaceutical_form"],
    "route":             ["route_of_administration"],
    "ingredients":       ["active_substance", "international_non-proprietary_name_(inn)_/_common_name"],
    "status":            ["medicine_status"],
    "category":          ["category"],
    "registration_date": ["marketing_authorisation_date", "european_commission_decision_date"],
    "revision_date":     ["last_updated_date"],
    "atc_code":          ["atc_code_(human)"],
    "orphan":            ["orphan_medicine"],
    "exceptional":       ["exceptional_circumstances"],
}


def load_data(file_path: str | None) -> pd.DataFrame:
    if file_path:
        log.info(f"Loading EMA data from {file_path}")
        df = pd.read_excel(file_path, dtype=str, header=None)
    else:
        log.info(f"Downloading EMA medicines register...")
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; research bot)",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
        r = requests.get(EMA_URL, timeout=120, headers=headers)
        r.raise_for_status()
        log.info(f"Downloaded {len(r.content)/1024/1024:.1f} MB")
        df = pd.read_excel(BytesIO(r.content), dtype=str, header=None)

    # Find the real header row (EMA puts metadata rows at the top)
    header_idx = 0
    for i in range(min(20, len(df))):
        row_vals = [str(v) for v in df.iloc[i].tolist() if str(v) != 'nan']
        if any('name of medicine' in v.lower() or 'medicine_name' in v.lower() or 'category' == v.lower() for v in row_vals):
            header_idx = i
            break
    if header_idx > 0:
        df.columns = [str(c).strip() for c in df.iloc[header_idx].tolist()]
        df = df.iloc[header_idx + 1:].reset_index(drop=True)
        log.info(f"Found header at row {header_idx}")

    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    log.info(f"Loaded {len(df)} EMA products, columns: {list(df.columns[:10])}")
    return df


def run(df: pd.DataFrame, supabase: Client, dry_run: bool):
    col = {field: resolve_col(df, cands) for field, cands in COL_CANDIDATES.items()}
    missing = [f for f, c in col.items() if c is None]
    if missing:
        log.warning(f"Could not find columns for: {missing}")
        log.warning(f"Available: {list(df.columns)}")

    def get(row, field):
        c = col.get(field)
        return clean(row[c]) if c and c in row.index else None

    # ── Sponsors ────────────────────────────────────────────────────────────────
    log.info("Processing sponsors...")
    sponsor_names = set()
    for _, row in df.iterrows():
        n = get(row, "sponsor")
        if n:
            sponsor_names.add(n)
    sponsor_rows  = [{"name": n, "country": "EU"} for n in sorted(sponsor_names)]
    log.info(f"  {len(sponsor_rows)} sponsors")
    if not dry_run:
        upsert_batches(supabase, "sponsors", sponsor_rows, "name_normalised")

    # ── Active ingredients ───────────────────────────────────────────────────────
    log.info("Processing active ingredients...")
    ingredient_names = set()
    atc_map = {}  # ingredient name -> ATC code (bonus data from EMA)
    for _, row in df.iterrows():
        raw = get(row, "ingredients")
        if raw:
            names = extract_ingredient_names(raw)
            ingredient_names.update(names)
            # Map first ingredient to ATC code if available
            atc = get(row, "atc_code")
            if atc and names:
                atc_map[names[0]] = atc

    ingredient_rows = []
    for n in sorted(ingredient_names):
        row_data = {"name": n}
        if n in atc_map:
            row_data["atc_code"] = atc_map[n]
        ingredient_rows.append(row_data)

    log.info(f"  {len(ingredient_rows)} ingredients ({len(atc_map)} with ATC codes)")
    if not dry_run:
        upsert_batches(supabase, "active_ingredients", ingredient_rows, "name_normalised")

    sponsor_id_map    = load_sponsor_id_map(supabase) if not dry_run else {}
    ingredient_id_map = load_ingredient_id_map(supabase) if not dry_run else {}

    # ── Drug products ────────────────────────────────────────────────────────────
    log.info("Processing EMA products...")
    product_rows = []
    seen = set()

    for _, row in df.iterrows():
        prod_name   = get(row, "product_name")
        registry_id = get(row, "registry_id") or (f"EMA_{prod_name[:40]}" if prod_name else None)
        if not prod_name or not registry_id:
            continue
        if registry_id in seen:
            continue
        seen.add(registry_id)

        sponsor_name = get(row, "sponsor")
        raw_status   = get(row, "status") or "Authorised"

        # Map EMA status vocabulary
        status_map = {
            "authorised":    "Active",
            "withdrawn":     "Withdrawn",
            "refused":       "Refused",
            "suspended":     "Suspended",
            "not renewed":   "Cancelled",
        }
        status = status_map.get(raw_status.lower(), raw_status) if raw_status else "Active"

        product_rows.append({
            "registry_id":       registry_id,
            "product_name":      prod_name,
            "trade_name":        get(row, "trade_name"),
            "strength":          extract_strength(prod_name),
            "dosage_form":       normalise_dosage_form(get(row, "dosage_form")),
            "route":             get(row, "route"),
            "product_category":  get(row, "category"),
            "registry_status":   status,
            "registration_date": parse_date(get(row, "registration_date")),
            "sponsor_id":        sponsor_id_map.get(sponsor_name.lower().strip()) if sponsor_name else None,
            "country":           "EU",
            "region":            "EU",
            "source":            "EMA",
        })

    log.info(f"  {len(product_rows)} EMA products")
    if not dry_run:
        upsert_batches(supabase, "drug_products", product_rows, "source,registry_id")

    # ── Junction ─────────────────────────────────────────────────────────────────
    if not dry_run:
        product_id_map = load_product_id_map(supabase, "EU")
        log.info("Building product<->ingredient links...")
        junction_rows = []
        seen_junc = set()
        for _, row in df.iterrows():
            prod_name = get(row, "product_name")
            reg_id  = get(row, "registry_id") or (f"EMA_{prod_name[:40]}" if prod_name else None)
            prod_id = product_id_map.get(reg_id)
            if not prod_id:
                continue
            for i, name in enumerate(extract_ingredient_names(get(row, "ingredients"))):
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

    log.info(f"EU EMA import done — {len(product_rows)} products")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    help="Local EMA Excel path")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    df = load_data(args.file)
    run(df, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
