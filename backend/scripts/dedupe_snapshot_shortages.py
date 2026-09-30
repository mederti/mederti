"""
Collapse daily-duplicate shortage rows from snapshot sources (one-off repair).
──────────────────────────────────────────────────────────────────────────────
Until Sep 2026 the MHLW Japan and Swissmedic scrapers stamped every record
with start_date = today. shortage_id is md5(drug|source|country|start_date),
so every daily run minted a NEW "active" row per drug: ~37.8k JP rows for
~650 real shortages and ~21.2k CH rows for ~165. The scrapers now carry the
open row's identity forward (BaseScraper.SNAPSHOT_IDENTITY); this script
repairs the history already written.

Per (source, drug_id) group of open rows with more than one member:
  keeper      = the most recently created row (freshest status/notes/raw_data)
  start_date  = earliest evidence: min of the group's start_dates and, for
                Japan, any real ⑬更新日 found in the rows' raw_data
  shortage_id = recomputed for the new start_date (matches the scraper)
  others      = rows referencing them (status log, recall links, alerts,
                articles) are repointed to the keeper, then they are deleted

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.dedupe_snapshot_shortages            # dry run
    python3 -m backend.scripts.dedupe_snapshot_shortages --execute  # apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from backend.scrapers.pmda_scraper import PmdaScraper

SOURCES = {
    "10000000-0000-0000-0000-000000000037": "JP",  # MHLW Japan
    "10000000-0000-0000-0000-000000000018": "CH",  # Swissmedic
}
OPEN = ["active", "anticipated", "stale"]
# (table, column) pairs that reference shortage_events.id
REFS = [
    ("shortage_status_log", "shortage_event_id"),
    ("recall_shortage_links", "shortage_id"),
    ("alert_notifications", "shortage_event_id"),
    ("intelligence_articles", "shortage_event_id"),
]


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_open(db, source_id: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("shortage_events")
            .select("id, drug_id, status, start_date, created_at, update_date:raw_data->>update_date")
            .eq("data_source_id", source_id)
            .in_("status", OPEN)
            .order("id")
            .range(offset, offset + 999)
            .execute()
        )
        rows += resp.data or []
        if len(resp.data or []) < 1000:
            return rows
        offset += 1000


def plan(rows: list[dict], source_id: str, cc: str) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("drug_id"):
            groups[r["drug_id"]].append(r)
    out = []
    for drug_id, rs in groups.items():
        if len(rs) < 2:
            continue
        keeper = max(rs, key=lambda r: (r["created_at"], r["id"]))
        dates = [r["start_date"] for r in rs if r.get("start_date")]
        if cc == "JP":
            for r in rs:
                d = PmdaScraper._parse_update_date(r.get("update_date"))
                if d:
                    dates.append(d)
        start = min(dates)
        sid = hashlib.md5(f"{drug_id}|{source_id}|{cc}|{start}".encode()).hexdigest()
        out.append({
            "drug_id": drug_id,
            "keeper": keeper,
            "start_date": start,
            "shortage_id": sid,
            "drop": [r for r in rs if r["id"] != keeper["id"]],
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes (default: dry run)")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    all_plans: list[tuple[str, str, list[dict]]] = []
    for source_id, cc in SOURCES.items():
        rows = fetch_open(db, source_id)
        p = plan(rows, source_id, cc)
        n_drop = sum(len(x["drop"]) for x in p)
        print(f"{cc}: {len(rows):,} open rows → {len(rows) - n_drop:,} after collapse "
              f"({len(p):,} drugs with duplicates, {n_drop:,} rows to delete)")
        if p:
            ex = max(p, key=lambda x: len(x["drop"]))
            print(f"   e.g. drug {ex['drug_id']}: {len(ex['drop']) + 1} rows → 1, "
                  f"start {ex['keeper']['start_date']} → {ex['start_date']}")
        all_plans.append((source_id, cc, p))

    if not args.execute:
        print("\nDry run — nothing changed. Re-run with --execute to apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("logs") / f"dedupe_snapshot_shortages_{stamp}.json"
    backup.parent.mkdir(exist_ok=True)
    # Full rows (not the slim planning columns) so anything can be restored.
    touched = [r["id"] for _, _, p in all_plans for x in p for r in [x["keeper"], *x["drop"]]]
    full: list[dict] = []
    for ids in chunks(touched, 200):
        full += db.table("shortage_events").select("*").in_("id", ids).execute().data or []
    backup.write_text(json.dumps(full, default=str))
    print(f"\nBackup of every touched row ({len(full):,}): {backup}")

    for _, cc, p in all_plans:
        done = 0
        for x in p:
            keep_id = x["keeper"]["id"]
            drop_ids = [r["id"] for r in x["drop"]]
            for ids in chunks(drop_ids, 100):
                for table, col in REFS:
                    try:
                        db.table(table).update({col: keep_id}).in_(col, ids).execute()
                    except Exception as exc:  # table absent in this env, etc.
                        print(f"   warn: repoint {table}.{col}: {exc}", file=sys.stderr)
                db.table("shortage_events").delete().in_("id", ids).execute()
            db.table("shortage_events").update({
                "start_date": x["start_date"],
                "shortage_id": x["shortage_id"],
            }).eq("id", keep_id).execute()
            done += 1
            if done % 100 == 0:
                print(f"   {cc}: {done}/{len(p)} drugs collapsed")
        print(f"{cc}: collapsed {done} drugs")


if __name__ == "__main__":
    main()
