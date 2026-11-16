"""
Re-key existing TGA shortage rows to the per-product shortage_id (one-off).
────────────────────────────────────────────────────────────────────────────
TGA's MSI feed has one record per ARTG product. shortage_id used to be
md5(drug|source|country|start_date), so products of one molecule sharing a
start date collapsed onto one row (65 groups, 175 records on 2026-10-26) and
the last record in the feed won status/severity/raw_data. TGAScraper now sets
product_key = ARTG number, and BaseScraper keys those events as
md5(source|country|product:<artg>|start_date).

Every existing TGA row must move to the new id BEFORE the first scraper run
on the new code, or that run inserts ~1,000 fresh rows beside the old ones.
This script computes each row's new id from its own raw_data.artg_numb and
start_date, then:

  single row per new id  → shortage_id updated in place (row id, status log,
                           recall links all kept)
  several rows per new id → the same ARTG + start written under different
                           drug_ids (drug resolution re-mapped the ingredient,
                           or a drug_id backfill moved rows without
                           recomputing shortage_id). keeper = the row with the
                           latest TGA last_updated (freshest copy of the
                           record), ties → earliest created. Rows referencing
                           the others (status log, recall links, alerts,
                           articles) are repointed to it, then they are
                           deleted. The next scrape refreshes the keeper from
                           the feed if the record is still listed.
  no artg in raw_data    → left alone (reported)

A collapsed row keeps whichever product last won the collision; the other
products of its group are inserted as new rows by the next scrape.

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.rekey_tga_shortage_ids            # dry run
    python3 -m backend.scripts.rekey_tga_shortage_ids --execute  # apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

from dotenv import load_dotenv
from supabase import create_client

from backend.scrapers.tga_scraper import TGAScraper

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


def fetch_rows(db) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("shortage_events")
            .select("id, shortage_id, drug_id, status, start_date, created_at, "
                    "artg:raw_data->>artg_numb, last_updated:raw_data->>last_updated")
            .eq("data_source_id", TGAScraper.SOURCE_ID)
            .order("id")
            .range(offset, offset + 999)
            .execute()
        )
        rows += resp.data or []
        if len(resp.data or []) < 1000:
            return rows
        offset += 1000


def _neg_date(raw: str | None) -> int:
    """Sort key: latest TGA last_updated first; unparseable/missing last."""
    iso = TGAScraper._parse_date(raw)
    return -int(iso.replace("-", "")) if iso else 0


def plan(rows: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (moves, merges, skipped)."""
    keyer = TGAScraper(db_client=MagicMock())
    groups: dict[str, list[dict]] = defaultdict(list)
    skipped = []
    for r in rows:
        artg = (r.get("artg") or "").strip()
        if not artg or not r.get("start_date"):
            skipped.append(r)
            continue
        groups[keyer._shortage_id(r["drug_id"], r["start_date"], artg)].append(r)

    moves, merges = [], []
    for sid, rs in groups.items():
        keeper = min(rs, key=lambda r: (_neg_date(r.get("last_updated")), r["created_at"], r["id"]))
        drop = [r for r in rs if r["id"] != keeper["id"]]
        if drop:
            merges.append({"shortage_id": sid, "keeper": keeper, "drop": drop})
        elif keeper["shortage_id"] != sid:
            moves.append({"shortage_id": sid, "keeper": keeper})
    return moves, merges, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes (default: dry run)")
    ap.add_argument("--limit", type=int, default=None,
                    help="apply only the first N moves/merges (verify one case first)")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = fetch_rows(db)
    moves, merges, skipped = plan(rows)
    n_drop = sum(len(m["drop"]) for m in merges)
    already = len(rows) - len(skipped) - len(moves) - sum(1 + len(m["drop"]) for m in merges)
    print(f"TGA rows: {len(rows):,}")
    print(f"  re-key in place:        {len(moves):,}")
    print(f"  already on new id:      {already:,}")
    print(f"  merge groups:           {len(merges):,} ({n_drop:,} duplicate rows to delete)")
    print(f"  no artg (left alone):   {len(skipped):,}")
    for m in merges[:5]:
        k = m["keeper"]
        print(f"   e.g. ARTG {k['artg']} start {k['start_date']}: keep {k['id']} ({k['status']}, "
              f"drug {k['drug_id']}), drop "
              + ", ".join(f"{d['id']} ({d['status']}, drug {d['drug_id']})" for d in m["drop"]))
    for r in skipped[:5]:
        print(f"   skipped: {r['id']} status={r['status']} start={r['start_date']}")

    drop_ids = [r["id"] for m in merges for r in m["drop"]]
    for table, col in REFS:
        n = 0
        try:
            for ids in chunks(drop_ids, 100):
                n += db.table(table).select(col, count="exact").in_(col, ids).limit(1).execute().count or 0
            print(f"  refs to repoint in {table}: {n:,}")
        except Exception as exc:
            print(f"  refs in {table}: n/a ({str(exc)[:80]})")

    if args.limit is not None:
        merges = merges[:args.limit]
        moves = moves[:max(0, args.limit - len(merges))]
        print(f"\n--limit {args.limit}: {len(merges)} merges + {len(moves)} moves selected")
        for m in [*merges, *moves]:
            print(f"   {m['keeper']['id']}: {m['keeper']['shortage_id']} → {m['shortage_id']}")

    if not args.execute:
        print("\nDry run — nothing changed. Re-run with --execute to apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("logs") / f"rekey_tga_shortage_ids_{stamp}.json"
    backup.parent.mkdir(exist_ok=True)
    touched = [m["keeper"]["id"] for m in moves] + [
        r["id"] for m in merges for r in [m["keeper"], *m["drop"]]
    ]
    full: list[dict] = []
    for ids in chunks(touched, 200):
        full += db.table("shortage_events").select("*").in_("id", ids).execute().data or []
    backup.write_text(json.dumps(full, default=str))
    print(f"\nBackup of every touched row ({len(full):,}): {backup}")

    for m in merges:
        keep_id = m["keeper"]["id"]
        drop_ids = [r["id"] for r in m["drop"]]
        for table, col in REFS:
            try:
                db.table(table).update({col: keep_id}).in_(col, drop_ids).execute()
            except Exception as exc:  # table absent, or a (recall, shortage) link already on the keeper
                print(f"   warn: repoint {table}.{col} for {drop_ids}: {exc}", file=sys.stderr)
        db.table("shortage_events").delete().in_("id", drop_ids).execute()
        db.table("shortage_events").update({"shortage_id": m["shortage_id"]}).eq("id", keep_id).execute()
    print(f"merged {len(merges)} groups")

    done = 0
    for m in moves:
        db.table("shortage_events").update({"shortage_id": m["shortage_id"]}).eq("id", m["keeper"]["id"]).execute()
        done += 1
        if done % 250 == 0:
            print(f"   {done}/{len(moves)} re-keyed")
    print(f"re-keyed {done} rows")


if __name__ == "__main__":
    main()
