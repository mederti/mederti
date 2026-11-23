"""
Read-only extract for the signal backtests in docs/research/shortage-signal-backtest.md.

Pulls `shortage_events` (synthetic rows excluded), `drugs` and `drug_synonyms`
from Supabase into a local JSON snapshot so the backtests are reproducible
offline and never touch prod tables. Writes nothing to the database.

Usage:
    python3 -m backend.analysis.research.extract_shortage_history OUT_DIR
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from backend.analysis.risk_score import fetch_all   # noqa: E402
from backend.utils.db import get_supabase_client    # noqa: E402


def main(out_dir: str) -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(ROOT, ".env"))
    except ImportError:
        pass
    db = get_supabase_client()
    os.makedirs(out_dir, exist_ok=True)
    pulls = {
        "shortage_events": ("id,drug_id,country_code,status,start_date,end_date,created_at,data_source_id,synthetic",
                            lambda q: q.or_("synthetic.is.null,synthetic.eq.false")),
        "drugs": ("id,generic_name,generic_name_normalised,resolved_inn,atc_code,entity_type", None),
        "drug_synonyms": ("id,drug_id,synonym,synonym_normalised,source", None),
    }
    for table, (sel, flt) in pulls.items():
        rows = fetch_all(db, table, sel, flt)
        with open(os.path.join(out_dir, f"{table}.json"), "w") as f:
            json.dump(rows, f)
        print(f"{table}: {len(rows):,} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "data/research"))
