"""
Collapse duplicate shortage rows for the same regulator notice (one-off repair).
──────────────────────────────────────────────────────────────────────────────
A TGA or Health Canada notice is identified by its registration number
(raw_data.artg_numb / raw_data.din) and start date. shortage_id is
md5(drug|source|country|start_date), so when a notice's drug link changes
(salt-form re-resolution, the Nov 2026 catalogue relink) the next scrape writes
a NEW row under the new drugs row. The old row stays behind, stops being
verified, and is later closed as "no longer listed". The same notice then
exists twice: open under one drugs row and resolved under another (Amoxil
250mg, AUST R 273935: active under Amoxicillin-Trihydrate, "resolved" twice
under Amoxicillin).

Per (country, registration number, start_date) group of real (non-synthetic)
rows with more than one member:
  keeper = an open row over a closed one, then the most recently verified,
           then the most recently updated: the row the scraper still maintains
  others = recall links and alerts that reference them are
           repointed to the keeper, then they are deleted. Their status-log
           entries go with them (see REFS)

Scopes:
  conflicts (default)  only groups where the copies DISAGREE: one open, one
                       closed. These make pages and the chat contradict the
                       regulator.
  all                  every duplicate group, including copies that agree.

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.dedupe_registration_notices                 # dry run
    python3 -m backend.scripts.dedupe_registration_notices --scope all     # dry run, wider
    python3 -m backend.scripts.dedupe_registration_notices --execute       # apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

MARKETS = {"AU": "artg_numb", "CA": "din"}
OPEN = {"active", "anticipated"}
# (table, column) pairs that reference shortage_events.id
# shortage_status_log is deliberately NOT repointed: a stale copy's history is
# the artefact itself ("active → resolved" on the day it was closed as no
# longer listed). Moving it would write a false resolution into the keeper's
# history. Those entries are backed up and removed with the copy (FK cascade).
REFS = [
    ("recall_shortage_links", "shortage_id"),
    ("alert_notifications", "shortage_event_id"),
]


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch(db, cc: str, field: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("shortage_events")
            .select(f"id, drug_id, status, start_date, last_verified_at, updated_at, synthetic, reg:raw_data->>{field}, product:raw_data->>trade_names")
            .eq("country_code", cc)
            .not_.is_(f"raw_data->>{field}", "null")
            .order("id")
            .range(offset, offset + 999)
            .execute()
        )
        rows += resp.data or []
        if len(resp.data or []) < 1000:
            return rows
        offset += 1000


def plan(rows: list[dict], scope: str) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("synthetic") is True or not r.get("reg") or not r.get("start_date"):
            continue
        groups[(str(r["reg"]).lstrip("0"), r["start_date"])].append(r)
    out = []
    for (reg, start), rs in groups.items():
        if len(rs) < 2:
            continue
        has_open = any(r["status"] in OPEN for r in rs)
        has_closed = any(r["status"] not in OPEN for r in rs)
        conflict = has_open and has_closed
        if scope == "conflicts" and not conflict:
            continue
        keeper = max(rs, key=lambda r: (r["status"] in OPEN, r.get("last_verified_at") or "", r.get("updated_at") or "", r["id"]))
        out.append({
            "reg": reg, "start_date": start, "conflict": conflict, "keeper": keeper,
            "drop": [r for r in rs if r["id"] != keeper["id"]],
            "cross_drug": len({r["drug_id"] for r in rs}) > 1,
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes (default: dry run)")
    ap.add_argument("--scope", choices=["conflicts", "all"], default="conflicts")
    ap.add_argument("--reg", help="limit to one registration number (verify a single case first)")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    plans: list[dict] = []
    for cc, field in MARKETS.items():
        rows = fetch(db, cc, field)
        p = plan(rows, args.scope)
        if args.reg:
            p = [x for x in p if x["reg"] == args.reg.lstrip("0")]
        n_drop = sum(len(x["drop"]) for x in p)
        drugs = {r["drug_id"] for x in p for r in x["drop"]}
        print(f"{cc}: {len(rows):,} rows with a registration number; {len(p):,} duplicate groups in scope "
              f"'{args.scope}' ({sum(x['conflict'] for x in p):,} open-vs-closed, {sum(x['cross_drug'] for x in p):,} across drug records); "
              f"{n_drop:,} rows to delete from {len(drugs):,} drug records")
        for x in p[:3]:
            k = x["keeper"]
            print(f"   e.g. reg {x['reg']} from {x['start_date']} ({(k.get('product') or '')[:50]}): keep {k['status']} "
                  f"verified {(k.get('last_verified_at') or '')[:10]} on drug {k['drug_id'][:8]}; delete "
                  + ", ".join(f"{r['status']} verified {(r.get('last_verified_at') or '')[:10]} on {r['drug_id'][:8]}" for r in x["drop"]))
        plans += p

    if not args.execute:
        print("\nDry run — nothing changed. Re-run with --execute to apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("logs") / f"dedupe_registration_notices_{stamp}.json"
    backup.parent.mkdir(exist_ok=True)
    touched = [r["id"] for x in plans for r in [x["keeper"], *x["drop"]]]
    full: list[dict] = []
    for ids in chunks(touched, 200):
        full += db.table("shortage_events").select("*").in_("id", ids).execute().data or []
    drop_all = [r["id"] for x in plans for r in x["drop"]]
    logs: list[dict] = []
    for ids in chunks(drop_all, 200):
        logs += db.table("shortage_status_log").select("*").in_("shortage_event_id", ids).execute().data or []
    backup.write_text(json.dumps({"shortage_events": full, "shortage_status_log_of_deleted": logs}, default=str))
    print(f"\nBackup of every touched row ({len(full):,}) and the deleted copies' status log ({len(logs):,}): {backup}")

    deleted = 0
    for x in plans:
        keep_id = x["keeper"]["id"]
        drop_ids = [r["id"] for r in x["drop"]]
        for table, col in REFS:
            try:
                db.table(table).update({col: keep_id}).in_(col, drop_ids).execute()
            except Exception as exc:  # unique clash with a link the keeper already has, table absent, etc.
                print(f"   warn: repoint {table}.{col} for reg {x['reg']}: {exc}", file=sys.stderr)
        db.table("shortage_events").delete().in_("id", drop_ids).execute()
        deleted += len(drop_ids)
    print(f"Deleted {deleted:,} duplicate rows across {len(plans):,} notices.")


if __name__ == "__main__":
    main()
