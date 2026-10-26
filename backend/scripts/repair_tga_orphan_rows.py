"""
Retire TGA shortage rows the live MSI feed no longer lists (one-off repair).
────────────────────────────────────────────────────────────────────────────
TGA's MSI feed has one record per ARTG product. When TGA re-dates a product
(anticipated onsets shift, current shortages get a new start), the new
shortage_start is a new shortage_id, so the old row was never written again.
The duplicate-payload path then kept re-verifying it, so mark_stale could
never retire it either. On 2026-10-26, 1,478 of 2,380 TGA rows matched no
live record. Those rows are also where the legacy status mappings survive,
because later mapping fixes only reach rows the feed still lists:

    raw A stored active    — initial map had no "A" → defaulted to active
    raw A stored resolved  — 2026-03-31..06-03 mapped A ("Archived") → resolved
    raw D stored resolved  — pre-2026-03-31 mapped D → resolved

BaseScraper now moves a re-dated product's open row forward and only
re-verifies rows of the payload, so this is the one-off cleanup of the
backlog. Run it AFTER rekey_tga_shortage_ids.py (PR #209) has executed.

For every TGA row whose (ARTG, start_date) is NOT in today's feed:

  raw status R (TGA said resolved)      → resolved (left alone if already)
  raw status C / D / A (open when TGA   → stale: the source stopped listing
    last listed it)                        it, which is exactly what stale
                                           means. end_date cleared when it
                                           was a legacy "resolved" (that date
                                           was invented by the old mapping).
  …except the product's latest open row → left open: the scraper's
    when the feed lists the ARTG under      carry-forward moves it onto the
    a start with no row yet                 feed's new start on its next run.

Rows the feed still lists are left to the scraper (its next full run writes
their status from the feed). Rows with no raw_data / ARTG (supabase/seed.sql
fixtures) are reported, never touched.

Every change gets an audit_logs row (as mark_stale_shortages() writes) and
every touched row is backed up to JSON first. No shortage_status_log entries
are written: those queue user alerts, and nothing changed at the source.

Usage:
    python3 -m backend.scripts.repair_tga_orphan_rows                      # dry run
    python3 -m backend.scripts.repair_tga_orphan_rows --limit 1 --execute  # verify one
    python3 -m backend.scripts.repair_tga_orphan_rows --execute            # all
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

from dotenv import load_dotenv
from supabase import create_client

from backend.scrapers.tga_scraper import TGAScraper

# A partial or broken fetch would make every row look orphaned.
MIN_FEED_RECORDS = 800

OPEN = ("active", "anticipated")


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_rows(db) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("shortage_events")
            .select("id, shortage_id, status, start_date, end_date, created_at, last_verified_at, "
                    "artg:raw_data->>artg_numb, raw_status:raw_data->>status, "
                    "trade:raw_data->>trade_names, raw_end:raw_data->>shortage_end")
            .eq("data_source_id", TGAScraper.SOURCE_ID)
            .order("id")
            .range(offset, offset + 999)
            .execute()
        )
        rows += resp.data or []
        if len(resp.data or []) < 1000:
            return rows
        offset += 1000


def feed_index() -> tuple[set[tuple[str, str]], dict[str, str], dict[str, str]]:
    """(artg, start) pairs in today's feed, plus artg → feed start / raw status."""
    s = TGAScraper(db_client=MagicMock())
    events = s.normalize(s.fetch())
    if len(events) < MIN_FEED_RECORDS:
        raise SystemExit(f"Feed returned only {len(events)} records — refusing to run.")
    pairs, start, raw = set(), {}, {}
    for e in events:
        artg = (e.get("product_key") or "").strip()
        if artg:
            pairs.add((artg, e["start_date"]))
            start[artg] = e["start_date"]
            raw[artg] = e["raw_record"]["status"]
    return pairs, start, raw


def plan(rows: list[dict], feed_pairs, feed_start) -> tuple[list[dict], Counter, list[dict]]:
    """Returns (changes, tally, carry_left_open). Pure — no I/O."""
    have = {((r.get("artg") or "").strip(), r["start_date"]) for r in rows}

    # The open row the scraper will carry forward, per re-dated ARTG.
    open_by_artg: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        artg = (r.get("artg") or "").strip()
        if r["status"] in OPEN and artg and (artg, r["start_date"]) not in feed_pairs:
            open_by_artg[artg].append(r)
    carry_ids = set()
    for artg, rs in open_by_artg.items():
        new_start = feed_start.get(artg)
        if new_start and (artg, new_start) not in have:
            carry_ids.add(max(rs, key=lambda r: (r["start_date"] or "", r["id"]))["id"])

    changes, carry, tally = [], [], Counter()
    for r in rows:
        artg = (r.get("artg") or "").strip()
        raw = (r.get("raw_status") or "").upper().strip()
        if not artg or not raw:
            tally["no raw_data/ARTG (seed fixtures) — left alone"] += 1
            continue
        if (artg, r["start_date"]) in feed_pairs:
            tally["in today's feed — scraper owns it"] += 1
            continue
        if r["id"] in carry_ids:
            tally["re-dated, scraper carries it forward — left open"] += 1
            carry.append(r)
            continue

        target = "resolved" if raw == "R" else "stale"
        where = "ARTG re-dated in feed" if artg in feed_start else "ARTG left feed"
        if r["status"] == target:
            tally[f"orphan, already {target} ({where})"] += 1
            continue
        patch: dict = {"status": target}
        if target == "stale" and r["status"] == "resolved":
            patch["end_date"] = None
        if target == "resolved" and not r.get("end_date"):
            end = TGAScraper._parse_date(r.get("raw_end"))
            if end:  # TGA's own end date; never invent one
                patch["end_date"] = end
        tally[f"raw {raw}, {r['status']} → {target} ({where})"] += 1
        changes.append({"row": r, "patch": patch, "where": where})
    return changes, tally, carry


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes (default: dry run)")
    ap.add_argument("--limit", type=int, default=None,
                    help="apply only the first N changes (verify one case first)")
    ap.add_argument("--report", type=str, default=None, help="also write the plan as JSON here")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    feed_pairs, feed_start, _ = feed_index()
    rows = fetch_rows(db)
    changes, tally, carry = plan(rows, feed_pairs, feed_start)

    print(f"Live feed: {len(feed_pairs):,} records   TGA rows: {len(rows):,}")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>5,}  {k}")
    print(f"\nRows to change: {len(changes):,}")
    shown = set()
    for c in changes:
        key = (c["row"]["raw_status"], c["row"]["status"], c["patch"]["status"])
        if key in shown:
            continue
        shown.add(key)
        r = c["row"]
        print(f"   e.g. {r['id']} ARTG {r['artg']} {r.get('trade') or ''!s:.30} "
              f"start {r['start_date']} raw {r['raw_status']}: {r['status']} → {c['patch']} "
              f"({c['where']}; feed start {feed_start.get(r['artg'], '—')})")

    if args.report:
        Path(args.report).write_text(json.dumps(
            {"tally": tally, "changes": changes, "carry_left_open": carry}, default=str, indent=1))
        print(f"\nPlan written to {args.report}")

    if args.limit is not None:
        changes = changes[:args.limit]
        print(f"\n--limit {args.limit}: {len(changes)} selected")
        for c in changes:
            print(f"   {c['row']['id']}: {c['row']['status']} → {c['patch']}")

    if not args.execute:
        print("\nDry run — nothing changed. Re-run with --execute to apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("logs") / f"repair_tga_orphan_rows_{stamp}.json"
    backup.parent.mkdir(exist_ok=True)
    full: list[dict] = []
    for ids in chunks([c["row"]["id"] for c in changes], 200):
        full += db.table("shortage_events").select("*").in_("id", ids).execute().data or []
    backup.write_text(json.dumps(full, default=str))
    print(f"\nBackup of every touched row ({len(full):,}): {backup}")

    done = 0
    for c in changes:
        r = c["row"]
        # Guard on the status we planned from, so a concurrent scrape wins.
        res = (db.table("shortage_events").update(c["patch"])
               .eq("id", r["id"]).eq("status", r["status"]).execute())
        if not res.data:
            print(f"   skipped {r['id']}: status changed since planning")
            continue
        db.table("audit_logs").insert({
            "table_name": "shortage_events",
            "record_id": r["id"],
            "action": "UPDATE",
            "old_data": {"status": r["status"], "end_date": r.get("end_date")},
            "new_data": {**c["patch"], "reason": "repair_tga_orphan_rows",
                         "detail": f"not in TGA MSI feed ({c['where']}); raw status {r['raw_status']}"},
            "changed_by_role": "system",
        }).execute()
        done += 1
        if done % 250 == 0:
            print(f"   {done}/{len(changes)} updated")
    print(f"updated {done} rows")


if __name__ == "__main__":
    main()
