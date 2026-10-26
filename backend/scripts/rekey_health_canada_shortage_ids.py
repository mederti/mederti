"""
Re-key existing Health Canada shortage rows to one row per HC report (one-off).
────────────────────────────────────────────────────────────────────────────────
HC publishes one report per DIN per shortage, and its Report ID names that
event. shortage_id used to be md5(drug|source|country|start_date), which broke
identity two ways (measured 2026-10-26):

  collisions  strengths/brands of one molecule sharing a start date collapsed
              onto one row: 382 of the 1,996 reports in the 2026-09-13 feed
              (e.g. JAMP-IRBESARTAN 75 / 150 / 300 mg), last one in the feed
              winning status, severity and raw_data.
  splits      one report written under several rows: 849 extra rows across
              603 reports — re-minted when drug resolution re-mapped the
              ingredient (2026-05-26 / 06-03 backfills) or when the start date
              moved from anticipated to actual (leaving an 'anticipated' row
              that is never closed).

HealthCanadaScraper now sets product_key = Report ID and keys those events as
md5(source|country|report:<id>) — no drug_id, no start_date. Every existing HC
row must move to the new id BEFORE the first scraper run on the new code, or
that run inserts ~2,000 fresh rows beside the old ones. This script computes
each row's new id from its own raw_data.report_id, then:

  single row per report  → shortage_id updated in place (row id, status log,
                           recall links all kept)
  several rows per report → keeper = the row with the latest HC date_updated
                           (freshest copy of the report), ties → most recently
                           created (current drug resolution). Rows referencing
                           the others (status log, recall links, alerts,
                           articles) are repointed to it, then they are
                           deleted. The next scrape refreshes the keeper from
                           the feed if the report is still listed.
  no report_id in raw_data → left alone (reported)

A row that won a collision keeps the report that last won it (its raw_data
says which); the reports it hid are inserted as new rows by the next scrape.

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.rekey_health_canada_shortage_ids            # dry run
    python3 -m backend.scripts.rekey_health_canada_shortage_ids --limit 1 --execute
    python3 -m backend.scripts.rekey_health_canada_shortage_ids --execute  # apply
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

from backend.scrapers.health_canada_scraper import HealthCanadaScraper

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
                    "report_id:raw_data->>report_id, date_updated:raw_data->>date_updated")
            .eq("data_source_id", HealthCanadaScraper.SOURCE_ID)
            .order("id")
            .range(offset, offset + 999)
            .execute()
        )
        rows += resp.data or []
        if len(resp.data or []) < 1000:
            return rows
        offset += 1000


def repoint_recall_links(db, keep_id: str, drop_ids: list[str]) -> None:
    """recall_shortage_links is UNIQUE (recall_id, shortage_id) and cascades on
    delete. A bulk UPDATE fails outright if the keeper already has one of the
    recalls, and the delete that follows would then cascade away every link of
    the dropped rows. Move each link alone; only exact duplicates are left to
    the cascade."""
    have = {
        r["recall_id"] for r in
        db.table("recall_shortage_links").select("recall_id").eq("shortage_id", keep_id).execute().data or []
    }
    links = (
        db.table("recall_shortage_links").select("id, recall_id").in_("shortage_id", drop_ids).execute().data or []
    )
    for link in links:
        if link["recall_id"] in have:
            continue
        db.table("recall_shortage_links").update({"shortage_id": keep_id}).eq("id", link["id"]).execute()
        have.add(link["recall_id"])


def plan(rows: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (moves, merges, skipped)."""
    keyer = HealthCanadaScraper(db_client=MagicMock())
    groups: dict[str, list[dict]] = defaultdict(list)
    skipped = []
    for r in rows:
        rid = (r.get("report_id") or "").strip()
        if not rid:
            skipped.append(r)
            continue
        groups[keyer._shortage_id(r["drug_id"], r["start_date"], rid)].append(r)

    moves, merges = [], []
    for sid, rs in groups.items():
        # date_updated is YYYY-MM-DD (or missing → ""), so string order works.
        keeper = max(rs, key=lambda r: (r.get("date_updated") or "", r["created_at"], r["id"]))
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
    print(f"HC rows: {len(rows):,}")
    print(f"  re-key in place:           {len(moves):,}")
    print(f"  already on new id:         {already:,}")
    print(f"  merge groups:              {len(merges):,} ({n_drop:,} duplicate rows to delete)")
    print(f"  no report_id (left alone): {len(skipped):,}")
    for m in merges[:5]:
        k = m["keeper"]
        print(f"   e.g. report {k['report_id']}: keep {k['id']} ({k['status']}, start {k['start_date']}, "
              f"updated {k['date_updated']}), drop "
              + ", ".join(f"{d['id']} ({d['status']}, start {d['start_date']})" for d in m["drop"]))
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
    backup = Path("logs") / f"rekey_health_canada_shortage_ids_{stamp}.json"
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
        repoint_recall_links(db, keep_id, drop_ids)
        for table, col in REFS:
            if table == "recall_shortage_links":
                continue
            try:
                db.table(table).update({col: keep_id}).in_(col, drop_ids).execute()
            except Exception as exc:  # table absent
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
