#!/usr/bin/env python3
"""
TGA ARTG Drug Universe Importer (Australia)

Uses the TGA COGNOS relational CSV exports from apps.tga.gov.au/downloads/.
These contain the full ARTG: licences, products, ingredients, sponsors, formulations.

Data model:
  Licence (ARTG entry, e.g. AUST R 9978) -> Product -> Component -> Formulation -> Ingredient

Usage:
    python scripts/import_artg.py                    # download CSVs from TGA
    python scripts/import_artg.py --dir /tmp/artg    # use pre-downloaded CSVs
    python scripts/import_artg.py --dry-run           # parse only, no DB writes
"""
from __future__ import annotations

import os
import sys
import csv
import argparse
import logging
import requests
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_utils import (
    clean, parse_date, extract_strength, normalise_dosage_form,
    upsert_batches, load_sponsor_id_map, load_ingredient_id_map, load_product_id_map
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TGA_BASE = "https://apps.tga.gov.au/downloads/"
CSV_FILES = {
    "licence":      "COGNOS_V_GEN_LICENCE.csv",
    "product":      "COGNOS_V_GEN_PRODUCT.csv",
    "ingredient":   "COGNOS_V_GEN_INGREDIENT.csv",
    "sponsor":      "COGNOS_V_GEN_SPONSOR_ADDR.csv",
    "component":    "COGNOS_V_GEN_COMPONENT.csv",
    "formulation":  "COGNOS_V_GEN_FORMULATION.csv",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def download_csvs(dest_dir: str):
    """Download all COGNOS CSV files from TGA."""
    os.makedirs(dest_dir, exist_ok=True)
    for key, filename in CSV_FILES.items():
        path = os.path.join(dest_dir, f"{key}.csv")
        if os.path.exists(path):
            log.info(f"  {key}: already exists, skipping")
            continue
        url = TGA_BASE + filename
        log.info(f"  Downloading {filename}...")
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        with open(path, 'wb') as f:
            f.write(r.content)
        log.info(f"  {key}: {len(r.content)/1024:.0f} KB")


def read_tilde_csv(path: str) -> list[dict]:
    """Read a TGA tilde-delimited CSV into list of dicts."""
    rows = []
    with open(path, encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f, delimiter='~')
        raw_headers = next(reader)
        headers = [h.strip('"').strip() for h in raw_headers]
        for row in reader:
            vals = [v.strip('"').strip() for v in row]
            if len(vals) == len(headers):
                rows.append(dict(zip(headers, vals)))
    return rows


def parse_tga_date(val: str) -> str | None:
    """Parse TGA date like '17-apr-1991 00:00:00' or '03-jul-2002 00:00:00'."""
    if not val or val.strip() == '':
        return None
    from datetime import datetime
    v = val.strip().split(' ')[0]  # Drop time part
    for fmt in ("%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


STATUS_MAP = {
    'A': 'Active',
    'C': 'Cancelled',
    'S': 'Suspended',
    'CU': 'Current',
    'IN': 'Inactive',
}


def run(data_dir: str, supabase: Client, dry_run: bool):
    # ── Load all CSVs ──────────────────────────────────────────────────────────
    log.info("Loading COGNOS CSV files...")
    licences     = read_tilde_csv(os.path.join(data_dir, "licence.csv"))
    products     = read_tilde_csv(os.path.join(data_dir, "product.csv"))
    ingredients  = read_tilde_csv(os.path.join(data_dir, "ingredient.csv"))
    sponsors     = read_tilde_csv(os.path.join(data_dir, "sponsor.csv"))
    components   = read_tilde_csv(os.path.join(data_dir, "component.csv"))
    formulations = read_tilde_csv(os.path.join(data_dir, "formulation.csv"))

    log.info(f"  Licences: {len(licences)}, Products: {len(products)}, "
             f"Ingredients: {len(ingredients)}, Sponsors: {len(sponsors)}, "
             f"Components: {len(components)}, Formulations: {len(formulations)}")

    # ── Build lookup maps ─────────────────────────────────────────────────────
    # Sponsor ID -> name
    sponsor_name_map = {s['SPONSOR_ID']: s['CLIENT_NAME'] for s in sponsors if s.get('CLIENT_NAME')}

    # Licence ID -> licence data
    licence_map = {lic['LICENCE_ID']: lic for lic in licences}

    # Product ID -> list of component IDs
    product_components = {}
    for comp in components:
        pid = comp.get('PRODUCT_ID', '')
        if pid:
            product_components.setdefault(pid, []).append(comp)

    # Component ID -> list of formulations (ingredient links)
    component_formulations = {}
    for form in formulations:
        cid = form.get('COMPONENT_ID', '')
        if cid:
            component_formulations.setdefault(cid, []).append(form)

    # Ingredient ID -> ingredient name
    ingredient_name_map = {ing['INGREDIENT_ID']: ing['INGREDIENT_NAME'] for ing in ingredients}

    # Licence ID -> list of products
    licence_products = {}
    for prod in products:
        lid = prod.get('LICENCE_ID', '')
        if lid:
            licence_products.setdefault(lid, []).append(prod)

    # ── 1. Upsert sponsors ─────────────────────────────────────────────────────
    log.info("Processing sponsors...")
    sponsor_rows = [{"name": s['CLIENT_NAME'], "country": "AU"}
                    for s in sponsors if s.get('CLIENT_NAME')]
    log.info(f"  {len(sponsor_rows)} sponsors")
    if not dry_run:
        upsert_batches(supabase, "sponsors", sponsor_rows, "name_normalised")

    # ── 2. Upsert active ingredients (only AI category, not excipients) ───────
    log.info("Processing active ingredients...")
    active_ingredients = [ing for ing in ingredients
                          if ing.get('INGREDIENT_CATEGORY_CODE') == 'AI']
    ingredient_rows = [{"name": ing['INGREDIENT_NAME']}
                       for ing in active_ingredients if ing.get('INGREDIENT_NAME')]
    # Also collect unique ingredient names from formulation active ingredients
    formulation_ai_names = set()
    for form in formulations:
        if form.get('FORMULATION_TYPE', '').upper() in ('AI', 'A', 'ACTIVE'):
            iid = form.get('INGREDIENT_ID', '')
            name = ingredient_name_map.get(iid, '')
            if name and len(name) > 2:
                formulation_ai_names.add(name)
    # Merge both sources
    all_ingredient_names = set(ing['INGREDIENT_NAME'] for ing in active_ingredients if ing.get('INGREDIENT_NAME'))
    all_ingredient_names.update(formulation_ai_names)
    ingredient_rows = [{"name": n} for n in sorted(all_ingredient_names) if len(n) > 2]
    log.info(f"  {len(ingredient_rows)} active ingredients")
    if not dry_run:
        upsert_batches(supabase, "active_ingredients", ingredient_rows, "name_normalised")

    # Load ID maps
    sponsor_id_map    = load_sponsor_id_map(supabase) if not dry_run else {}
    ingredient_id_map = load_ingredient_id_map(supabase) if not dry_run else {}

    # ── 3. Build drug products from licences ──────────────────────────────────
    log.info("Processing drug products (licences)...")
    product_rows = []

    for lic in licences:
        lic_id = lic.get('LICENCE_ID', '')
        lic_name = lic.get('LICENCE_NAME', '').strip()
        lic_ident = lic.get('LICENCE_IDENTIFIER', '').strip()  # e.g. "AUST R 9978"
        if not lic_name:
            continue

        # Registry ID = AUST R/L number
        registry_id = lic_ident or lic_id

        # Sponsor
        sponsor_tga_id = lic.get('SPONSOR_ID', '')
        sponsor_name = sponsor_name_map.get(sponsor_tga_id)

        # Status
        raw_status = lic.get('LICENCE_STATUS', '')
        status = STATUS_MAP.get(raw_status, raw_status or 'Active')

        # Category: RE=Registered, LI=Listed
        cat = lic.get('LICENCE_PRODUCT_CATEGORY', '')
        category = {'RE': 'Registered', 'LI': 'Listed'}.get(cat, cat)

        # Get dosage form from first component if available
        dosage_form = None
        # Find products for this licence, then their components
        lic_products = licence_products.get(lic_id, [])
        for prod in lic_products:
            comps = product_components.get(prod.get('PRODUCT_ID', ''), [])
            for comp in comps:
                df_raw = comp.get('DOSAGE_FORM_CODE', '')
                if df_raw:
                    dosage_form = normalise_dosage_form(df_raw)
                    break
            if dosage_form:
                break

        product_rows.append({
            "registry_id":       registry_id,
            "product_name":      lic_name,
            "strength":          extract_strength(lic_name),
            "dosage_form":       dosage_form,
            "product_category":  category,
            "registry_status":   status,
            "registration_date": parse_tga_date(lic.get('LICENCE_START_DATE', '')),
            "cancellation_date": parse_tga_date(lic.get('LICENCE_CANCELLED_DATE', '')),
            "sponsor_id":        sponsor_id_map.get(sponsor_name.lower().strip()) if sponsor_name else None,
            "country":           "AU",
            "source":            "TGA_ARTG",
        })

    log.info(f"  {len(product_rows)} drug products")
    if not dry_run:
        upsert_batches(supabase, "drug_products", product_rows, "source,registry_id")

    # ── 4. Product <-> ingredient junction ────────────────────────────────────
    if not dry_run:
        product_id_map = load_product_id_map(supabase, "AU")
        log.info("Building product<->ingredient links...")
        junction_rows = []
        seen = set()

        for lic in licences:
            lic_id = lic.get('LICENCE_ID', '')
            registry_id = lic.get('LICENCE_IDENTIFIER', '').strip() or lic_id
            db_prod_id = product_id_map.get(registry_id)
            if not db_prod_id:
                continue

            # Find ingredients via: licence -> products -> components -> formulations
            lic_products = licence_products.get(lic_id, [])
            ingredient_order = 0
            for prod in lic_products:
                comps = product_components.get(prod.get('PRODUCT_ID', ''), [])
                for comp in comps:
                    forms = component_formulations.get(comp.get('COMPONENT_ID', ''), [])
                    for form in forms:
                        # Only link active ingredients
                        if form.get('FORMULATION_TYPE', '').upper() not in ('AI', 'A', 'ACTIVE'):
                            continue
                        iid = form.get('INGREDIENT_ID', '')
                        iname = ingredient_name_map.get(iid, '').lower().strip()
                        if not iname:
                            continue
                        db_ingr_id = ingredient_id_map.get(iname)
                        if not db_ingr_id:
                            continue
                        key = (db_prod_id, db_ingr_id)
                        if key in seen:
                            continue
                        seen.add(key)
                        junction_rows.append({
                            "product_id":    db_prod_id,
                            "ingredient_id": db_ingr_id,
                            "is_primary":    ingredient_order == 0,
                        })
                        ingredient_order += 1

        log.info(f"  {len(junction_rows)} links")
        upsert_batches(supabase, "product_ingredients", junction_rows, "product_id,ingredient_id")

    log.info(f"AU import done — {len(product_rows)} products, {len(ingredient_rows)} ingredients")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="Directory with pre-downloaded COGNOS CSVs")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data_dir = args.dir or "/tmp/artg_data"

    if not args.dir:
        log.info("Downloading TGA COGNOS CSV files...")
        download_csvs(data_dir)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    run(data_dir, supabase, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
