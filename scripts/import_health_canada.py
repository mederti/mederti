#!/usr/bin/env python3
"""
Health Canada Drug Product Database (DPD) Importer

The DPD ZIP contains multiple related CSV files (no headers, fixed column positions):
  - drug.txt          — master product table (DRUG_CODE is primary key)
  - ingred.txt        — active ingredients per product
  - comp.txt          — companies (sponsors)
  - form.txt          — dosage forms
  - route.txt         — routes of administration
  - status.txt        — current market status
  - schedule.txt      — drug schedules

Column definitions: https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-product-database/read-file-drug-product-databases-data-extract.html

Usage:
    python scripts/import_health_canada.py
    python scripts/import_health_canada.py --file ~/Downloads/allfiles.zip
    python scripts/import_health_canada.py --dry-run
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
    upsert_batches,
    load_sponsor_id_map, load_ingredient_id_map, load_product_id_map
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HC_DPD_BASE  = "https://www.canada.ca/content/dam/hc-sc/documents/services/drug-product-database/"
HC_DPD_ZIPS  = {
    "marketed":  "allfiles.zip",
    "approved":  "allfiles_ap.zip",
    "cancelled": "allfiles_ia.zip",
    "dormant":   "allfiles_dr.zip",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Health Canada DPD column definitions (positional, no headers in files)
DPD_DRUG_COLS   = ["DRUG_CODE","PRODUCT_CATEGORIZATION","CLASS","DRUG_IDENTIFICATION_NUMBER",
                    "BRAND_NAME","DESCRIPTOR","PEDIATRIC_FLAG","ACCESSION_NUMBER",
                    "NUMBER_OF_AIS","LAST_UPDATE_DATE","AI_GROUP_NO","CLASS_F",
                    "BRAND_NAME_F","DESCRIPTOR_F"]
DPD_INGRED_COLS = ["DRUG_CODE","ACTIVE_INGREDIENT_CODE","INGREDIENT","INGREDIENT_SUPPLIED_IND",
                    "STRENGTH","STRENGTH_UNIT","STRENGTH_TYPE","DOSAGE_VALUE",
                    "BASE","DOSAGE_UNIT","NOTES","INGREDIENT_F",
                    "STRENGTH_UNIT_F","COL13","COL14"]
DPD_COMP_COLS   = ["DRUG_CODE","MFR_CODE","COMPANY_CODE","COMPANY_NAME","COMPANY_TYPE",
                    "ADDRESS_MAILING_FLAG","ADDRESS_BILLING_FLAG","ADDRESS_NOTIFICATION_FLAG",
                    "ADDRESS_OTHER","SUITE_NUMBER","STREET_NAME","CITY_NAME","PROVINCE",
                    "COUNTRY","POSTAL_CODE","POST_OFFICE_BOX","PROVINCE_F","COUNTRY_F"]
DPD_FORM_COLS   = ["DRUG_CODE","PHARM_FORM_CODE","PHARMACEUTICAL_FORM","PHARMACEUTICAL_FORM_F"]
DPD_ROUTE_COLS  = ["DRUG_CODE","ROUTE_OF_ADMINISTRATION_CODE","ROUTE_OF_ADMINISTRATION",
                    "ROUTE_OF_ADMINISTRATION_F"]
DPD_STATUS_COLS = ["DRUG_CODE","CURRENT_STATUS_FLAG","STATUS","HISTORY_DATE",
                    "STATUS_F","LOT_NUMBER","EXPIRATION_DATE"]
DPD_SCHED_COLS  = ["DRUG_CODE","SCHEDULE","SCHEDULE_F"]


def read_dpd_file(z: zipfile.ZipFile, filename: str, columns: list) -> pd.DataFrame:
    """Read a DPD CSV file from ZIP — these have no headers.
    Matches both exact names (drug.txt) and suffixed names (drug_ap.txt, drug_ia.txt)."""
    base = filename.rsplit('.', 1)[0].lower()  # e.g. 'drug', 'schedule'
    candidates = [f for f in z.namelist()
                  if f.lower() == filename.lower()                       # exact: drug.txt
                  or f.lower().startswith(base + '_')                     # suffixed: drug_ap.txt
                  or f.lower().startswith(base.replace('schedule', 'sched') + '_')]  # sched variant
    if not candidates:
        log.warning(f"File {filename} not found in ZIP. Available: {z.namelist()}")
        return pd.DataFrame(columns=columns)
    with z.open(candidates[0]) as f:
        content = f.read().decode("utf-8", errors="replace")
    df = pd.read_csv(
        StringIO(content),
        names=columns,
        dtype=str,
        low_memory=False,
        on_bad_lines="skip"
    )
    return df


def load_data(file_path: str | None) -> dict[str, pd.DataFrame]:
    zips = []
    if file_path:
        log.info(f"Loading Health Canada DPD from {file_path}")
        zips.append(("local", zipfile.ZipFile(file_path)))
    else:
        for label, filename in HC_DPD_ZIPS.items():
            url = HC_DPD_BASE + filename
            log.info(f"Downloading {label} ({filename})...")
            r = requests.get(url, timeout=180)
            r.raise_for_status()
            log.info(f"  {len(r.content)/1024/1024:.1f} MB")
            zips.append((label, zipfile.ZipFile(BytesIO(r.content))))

    # Merge all ZIPs — concat each file type across all ZIPs
    file_specs = {
        "drug":   ("drug.txt",     DPD_DRUG_COLS),
        "ingred": ("ingred.txt",   DPD_INGRED_COLS),
        "comp":   ("comp.txt",     DPD_COMP_COLS),
        "form":   ("form.txt",     DPD_FORM_COLS),
        "route":  ("route.txt",    DPD_ROUTE_COLS),
        "status": ("status.txt",   DPD_STATUS_COLS),
        "sched":  ("schedule.txt", DPD_SCHED_COLS),
    }
    merged = {}
    for key, (fname, cols) in file_specs.items():
        frames = []
        for label, z in zips:
            df = read_dpd_file(z, fname, cols)
            if not df.empty:
                frames.append(df)
                log.info(f"  {key} from {label}: {len(df)} rows")
        merged[key] = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=cols)
        log.info(f"  {key} total: {len(merged[key])} rows")
    return merged


def build_master(tables: dict) -> pd.DataFrame:
    """Join all DPD tables into a single flat DataFrame keyed by DRUG_CODE."""
    drug   = tables["drug"]
    form   = tables["form"].groupby("DRUG_CODE")["PHARMACEUTICAL_FORM"].first().reset_index()
    route  = tables["route"].groupby("DRUG_CODE")["ROUTE_OF_ADMINISTRATION"].first().reset_index()
    comp   = tables["comp"].groupby("DRUG_CODE")["COMPANY_NAME"].first().reset_index()
    status = tables["status"].sort_values("HISTORY_DATE", ascending=False)
    status = status.groupby("DRUG_CODE")["STATUS"].first().reset_index()
    sched  = tables["sched"].groupby("DRUG_CODE")["SCHEDULE"].first().reset_index()

    merged = drug.merge(form,   on="DRUG_CODE", how="left")
    merged = merged.merge(route,  on="DRUG_CODE", how="left")
    merged = merged.merge(comp,   on="DRUG_CODE", how="left")
    merged = merged.merge(status, on="DRUG_CODE", how="left")
    merged = merged.merge(sched,  on="DRUG_CODE", how="left")

    log.info(f"Master table: {len(merged)} products after joins")
    return merged


def run(tables: dict, supabase: Client, dry_run: bool):
    df = build_master(tables)
    ingred_df = tables["ingred"]

    # Build drug_code -> DIN map for junction later
    drug_code_to_din = {}
    for _, row in df.iterrows():
        dc = clean(row.get("DRUG_CODE"))
        din = clean(row.get("DRUG_IDENTIFICATION_NUMBER"))
        if dc and din:
            drug_code_to_din[dc] = din

    # ── Sponsors ────────────────────────────────────────────────────────────────
    log.info("Processing sponsors...")
    sponsor_names = {clean(v) for v in df["COMPANY_NAME"].dropna()}
    sponsor_rows  = [{"name": n, "country": "CA"} for n in sorted(sponsor_names) if n]
    log.info(f"  {len(sponsor_rows)} sponsors")
    if not dry_run:
        upsert_batches(supabase, "sponsors", sponsor_rows, "name_normalised")

    # ── Active ingredients from ingred.txt ───────────────────────────────────────
    log.info("Processing active ingredients...")
    ingredient_names = set()
    for _, row in ingred_df.iterrows():
        name = clean(row.get("INGREDIENT"))
        if name and len(name) > 2:
            ingredient_names.add(name.lower())
    ingredient_rows = [{"name": n} for n in sorted(ingredient_names)]
    log.info(f"  {len(ingredient_rows)} ingredients")
    if not dry_run:
        upsert_batches(supabase, "active_ingredients", ingredient_rows, "name_normalised")

    sponsor_id_map    = load_sponsor_id_map(supabase) if not dry_run else {}
    ingredient_id_map = load_ingredient_id_map(supabase) if not dry_run else {}

    # ── Drug products ────────────────────────────────────────────────────────────
    log.info("Processing drug products...")
    product_rows = []
    seen = set()

    for _, row in df.iterrows():
        drug_code = clean(row.get("DRUG_CODE"))
        prod_name = clean(row.get("BRAND_NAME"))
        if not prod_name or not drug_code:
            continue
        if drug_code in seen:
            continue
        seen.add(drug_code)

        sponsor_name = clean(row.get("COMPANY_NAME"))
        raw_status   = clean(row.get("STATUS")) or "MARKETED"

        # HC status vocabulary
        status_map = {
            "MARKETED":    "Active",
            "APPROVED":    "Active",
            "DORMANT":     "Dormant",
            "CANCELLED POST MARKET":   "Cancelled",
            "CANCELLED PRE MARKET":    "Cancelled",
            "CANCELLED (VOLUNTARY)":   "Cancelled",
            "DORMANT - MARKETED ELSEWHERE": "Dormant",
        }
        status = status_map.get(raw_status.upper(), raw_status) if raw_status else "Active"

        product_rows.append({
            "registry_id":       clean(row.get("DRUG_IDENTIFICATION_NUMBER")) or drug_code,
            "product_name":      prod_name,
            "trade_name":        prod_name,
            "strength":          extract_strength(prod_name),
            "dosage_form":       normalise_dosage_form(clean(row.get("PHARMACEUTICAL_FORM"))),
            "route":             clean(row.get("ROUTE_OF_ADMINISTRATION")),
            "product_category":  clean(row.get("CLASS")),
            "schedule":          clean(row.get("SCHEDULE")),
            "registry_status":   status,
            "sponsor_id":        sponsor_id_map.get(sponsor_name.lower().strip()) if sponsor_name else None,
            "country":           "CA",
            "source":            "HC_DPD",
        })

    log.info(f"  {len(product_rows)} products")
    if not dry_run:
        upsert_batches(supabase, "drug_products", product_rows, "source,registry_id")

    # ── Product <-> ingredient junction ──────────────────────────────────────────
    if not dry_run:
        product_id_map = load_product_id_map(supabase, "CA")

        log.info("Building product<->ingredient links...")
        junction_rows = []
        seen_junc = set()
        for _, row in ingred_df.iterrows():
            drug_code = clean(row.get("DRUG_CODE"))
            # Look up DIN for this drug_code
            din = drug_code_to_din.get(drug_code)
            prod_id = product_id_map.get(din or drug_code)
            if not prod_id:
                continue
            name = clean(row.get("INGREDIENT"))
            if not name:
                continue
            ingr_id = ingredient_id_map.get(name.lower())
            if ingr_id:
                key = (prod_id, ingr_id)
                if key in seen_junc:
                    continue
                seen_junc.add(key)
                junction_rows.append({
                    "product_id":    prod_id,
                    "ingredient_id": ingr_id,
                    "is_primary":    True,
                })
        log.info(f"  {len(junction_rows)} links")
        upsert_batches(supabase, "product_ingredients", junction_rows, "product_id,ingredient_id")

    log.info(f"CA Health Canada import done — {len(product_rows)} products")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    help="Local HC DPD ZIP path")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    tables = load_data(args.file)
    run(tables, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
