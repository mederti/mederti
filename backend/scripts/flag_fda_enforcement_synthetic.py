"""
Flag FDA Drug Enforcement recall rows in shortage_events as synthetic (one-off).
──────────────────────────────────────────────────────────────────────────────
The fda_enforcement scraper (data source "FDA Drug Enforcement — Foreign
Manufacturer Recalls") writes ongoing openFDA enforcement RECALLS into
shortage_events, tagged "[SUPPLY-SIDE SIGNAL]" in notes. They were never
flagged synthetic (migration 046), so they counted as US active shortages —
found by docs/research/shortage-signal-backtest.md (228 rows, 2026-10-26).
The scraper now sets the flag; this marks the rows already stored. Nothing
is deleted, and only rows from that one data source are touched.

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.flag_fda_enforcement_synthetic            # dry run
    python3 -m backend.scripts.flag_fda_enforcement_synthetic --execute  # apply
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ENFORCEMENT_SOURCE_ID = "10000000-0000-0000-0000-000000000024"


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def unflagged(db) -> list[dict]:
    rows: list[dict] = []
    last_id = ""
    while True:
        q = (
            db.table("shortage_events")
            .select("id,country_code,status,start_date,notes,source_url")
            .eq("data_source_id", ENFORCEMENT_SOURCE_ID)
            .or_("synthetic.is.null,synthetic.eq.false")
            .order("id")
            .limit(1000)
        )
        if last_id:
            q = q.gt("id", last_id)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        last_id = batch[-1]["id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = unflagged(db)
    print(f"Unflagged FDA enforcement (recall) rows: {len(rows)}")
    print("  by country/status:", dict(Counter((r["country_code"], r["status"]) for r in rows)))
    not_recall = [r for r in rows if not (r.get("notes") or "").startswith("[SUPPLY-SIDE SIGNAL]")]
    print(f"  rows whose notes lack the [SUPPLY-SIDE SIGNAL] recall tag: {len(not_recall)}")
    if rows:
        print("Example:", rows[0])

    if not args.execute:
        print("\nDry run — pass --execute to apply.")
        return
    if not_recall:
        raise SystemExit("Refusing to execute: some rows don't look like recalls; inspect them first.")

    backup = Path("logs") / f"flag_fda_enforcement_synthetic_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps(rows, indent=1))
    print(f"Backup → {backup}")

    flagged = 0
    for ids in chunks([r["id"] for r in rows], 200):
        db.table("shortage_events").update({"synthetic": True}).in_("id", ids).execute()
        flagged += len(ids)
    print(f"Flagged {flagged} FDA enforcement rows synthetic.")
    print(f"Still unflagged after update: {len(unflagged(db))}")


if __name__ == "__main__":
    main()
