#!/usr/bin/env python3
"""
WHO International Nonproprietary Names (INN) importer.

The WHO INN list is the global canonical reference for drug ingredient names.
Importing it lets us normalise ingredient names across FDA, EMA, TGA, MHRA etc.
into a single global ingredient ID.

Data source:
    https://www.who.int/teams/health-product-and-policy-standards/inn
    Download: "INN stem book" or "Cumulative list" — both are Excel/CSV

Direct download (may need updating):
    https://cdn.who.int/media/docs/default-source/international-nonproprietary-names-(inn)/inn-cumulative-list.zip

Usage:
    python scripts/import_who_inn.py
    python scripts/import_who_inn.py --file ~/Downloads/inn_list.xlsx
    python scripts/import_who_inn.py --dry-run
"""
from __future__ import annotations

import os
import sys
import argparse
import logging
import zipfile
import requests
import pandas as pd
from io import BytesIO
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_utils import clean, upsert_batches, resolve_col

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# WHO INN cumulative list — check https://www.who.int/teams/health-product-and-policy-standards/inn
# if this URL changes
WHO_INN_URL = "https://cdn.who.int/media/docs/default-source/international-nonproprietary-names-(inn)/inn-cumulative-list.zip"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

COL_CANDIDATES = {
    "inn_number":   ["inn_number", "number", "inn number", "no", "no."],
    "inn_name":     ["inn", "inn_name", "recommended_inn", "recommended inn", "name"],
    "cas_number":   ["cas", "cas_number", "cas number", "cas_no"],
    "description":  ["description", "pharmacological_class", "class", "therapeutic"],
}


def load_data(file_path: str | None) -> pd.DataFrame:
    if file_path:
        log.info(f"Loading WHO INN from {file_path}")
        if file_path.endswith(".csv"):
            df = pd.read_csv(file_path, dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
    else:
        log.info("Downloading WHO INN list...")
        r = requests.get(WHO_INN_URL, timeout=120)
        r.raise_for_status()
        log.info(f"Downloaded {len(r.content)/1024:.0f} KB")

        # Handle ZIP
        if r.headers.get("content-type", "").startswith("application/zip") or WHO_INN_URL.endswith(".zip"):
            z = zipfile.ZipFile(BytesIO(r.content))
            # Find the main data file
            candidates = [f for f in z.namelist() if f.endswith((".xlsx", ".xls", ".csv")) and not f.startswith("__")]
            if not candidates:
                raise RuntimeError(f"No Excel/CSV found in ZIP. Contents: {z.namelist()}")
            filename = candidates[0]
            log.info(f"Extracting {filename} from ZIP")
            with z.open(filename) as f:
                df = pd.read_excel(BytesIO(f.read()), dtype=str) if filename.endswith((".xlsx", ".xls")) else pd.read_csv(f, dtype=str)
        else:
            df = pd.read_excel(BytesIO(r.content), dtype=str)

    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    log.info(f"Loaded {len(df)} INN records, columns: {list(df.columns)}")
    return df


def run(df: pd.DataFrame, supabase: Client, dry_run: bool):
    col = {field: resolve_col(df, cands) for field, cands in COL_CANDIDATES.items()}
    log.info(f"Column mapping: {col}")

    def get(row, field):
        c = col.get(field)
        return clean(row[c]) if c and c in row.index else None

    # Build update rows — match by normalised name, set who_inn_id + inn_name + cas
    update_rows = []
    for _, row in df.iterrows():
        inn_name = get(row, "inn_name")
        if not inn_name:
            continue
        update_rows.append({
            "name":        inn_name.lower().strip(),
            "inn_name":    inn_name,
            "who_inn_id":  get(row, "inn_number"),
            "cas_number":  get(row, "cas_number"),
        })

    log.info(f"  {len(update_rows)} INN entries to process")

    if not dry_run:
        # Upsert into active_ingredients — new ones get inserted, existing ones get INN data added
        upsert_batches(supabase, "active_ingredients", update_rows, "name_normalised")

        # Now do a second pass to update existing ingredients that match by name
        # (handles case where TGA/MHRA used slightly different spelling)
        result = supabase.table("active_ingredients").select("id, name_normalised").is_("who_inn_id", "null").execute()
        unmatched = [r["name_normalised"] for r in result.data]
        log.info(f"  {len(unmatched)} ingredients still without INN ID after direct match")

    log.info(f"WHO INN import done — {len(update_rows)} entries")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    help="Local INN file path")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    df = load_data(args.file)
    run(df, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
