"""
Imports intelligence_sources from CSV into Supabase.

Usage:
    python3 backend/importers/intelligence_sources_importer.py

Run from the repo root (/Users/finners/mederti).
Expects .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(".env")

# Add repo root to path so backend.utils.db resolves correctly
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.utils.db import get_supabase_client  # noqa: E402

CSV_PATH = Path("/Users/finners/Desktop/C_Personal/Mederti/datasourcesforscraping/medicine_availability_source_registry_extended_non_regulatory.csv")

BOOL_FIELDS = {"is_medicines_regulator", "is_government_or_igo"}


def parse_bool(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "yes")


def load_csv(path: Path) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            record: dict = {}
            for key, val in row.items():
                key = key.strip()
                val = val.strip() if val else None
                if key in BOOL_FIELDS:
                    record[key] = parse_bool(val or "false")
                else:
                    record[key] = val if val else None
            rows.append(record)
    return rows


def run():
    print(f"Reading CSV from: {CSV_PATH}")
    rows = load_csv(CSV_PATH)
    print(f"  Parsed {len(rows)} rows")

    db = get_supabase_client()

    # Upsert in batches of 50 (safe for Supabase row size)
    batch_size = 50
    upserted = 0
    errors = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            resp = (
                db.table("intelligence_sources")
                .upsert(batch, on_conflict="source_id")
                .execute()
            )
            upserted += len(batch)
            print(f"  Batch {i // batch_size + 1}: upserted {len(batch)} rows  (total so far: {upserted})")
        except Exception as exc:
            errors += len(batch)
            print(f"  ERROR in batch {i // batch_size + 1}: {exc}")

    print()
    print("─" * 50)
    print(f"  Total upserted : {upserted}")
    print(f"  Errors         : {errors}")

    # Verify final count
    count_resp = db.table("intelligence_sources").select("source_id", count="exact").execute()
    print(f"  DB row count   : {count_resp.count}")
    print("─" * 50)

    if count_resp.count == 124:
        print("  ✓ All 124 rows confirmed in DB")
    else:
        print(f"  ⚠ Expected 124 rows, found {count_resp.count}")


if __name__ == "__main__":
    run()
