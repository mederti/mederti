"""
Repair two sources of inflated "active shortage" counts (one-off).
──────────────────────────────────────────────────────────────────────────────
Step 1 — future-dated active rows → anticipated.
TGA publishes discontinuations ahead of time (status D, shortage_start in
2027/2028) and the scraper mapped D → active, so ~650 rows across sources sat
in live "active" totals with a start_date that hasn't happened yet — and the
country pages listed them under "Since". BaseScraper.upsert now demotes these
on write; this script repairs the rows already stored.

For every row with status='active' and start_date > today:
  status                 → 'anticipated'
  anticipated_start_date → start_date (only where currently NULL)

Rows flip back to active on their own: once the onset date passes, the next
scrape re-emits them as active and the upsert no longer demotes them.

Step 2 — FDA MedWatch rows → synthetic=true.
The MedWatch scraper writes openFDA enforcement RECALLS into shortage_events.
They were never flagged synthetic (migration 046), so 2,570 of 3,601 US
"active shortages" were recalls going back to 2012. The scraper now sets the
flag; this marks the rows already stored. Nothing is deleted.

Every row touched is written to a JSON backup before any mutation.

Usage:
    python3 -m backend.scripts.repair_inflated_active_counts            # dry run
    python3 -m backend.scripts.repair_inflated_active_counts --execute  # apply
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

MEDWATCH_SOURCE_ID = "10000000-0000-0000-0000-000000000028"


def chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="apply changes")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    today = date.today().isoformat()

    rows: list[dict] = []
    last_id = ""
    while True:
        q = (
            db.table("shortage_events")
            .select("id, country_code, start_date, anticipated_start_date")
            .eq("status", "active")
            .gt("start_date", today)
            .order("id")
            .limit(1000)
        )
        if last_id:
            q = q.gt("id", last_id)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        last_id = batch[-1]["id"]

    by_country = Counter(r["country_code"] for r in rows)
    print(f"Future-dated active rows: {len(rows)}")
    for cc, n in by_country.most_common():
        print(f"  {cc}: {n}")
    if rows:
        print("Example:", rows[0])

    medwatch: list[str] = []
    last_id = ""
    while True:
        q = (
            db.table("shortage_events")
            .select("id")
            .eq("data_source_id", MEDWATCH_SOURCE_ID)
            .or_("synthetic.is.null,synthetic.eq.false")
            .order("id")
            .limit(1000)
        )
        if last_id:
            q = q.gt("id", last_id)
        batch = q.execute().data or []
        medwatch.extend(r["id"] for r in batch)
        if len(batch) < 1000:
            break
        last_id = batch[-1]["id"]
    print(f"\nUnflagged FDA MedWatch (recall) rows: {len(medwatch)}")

    if not args.execute:
        print("\nDry run — pass --execute to apply.")
        return

    backup = Path("logs") / f"repair_inflated_active_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps({"future_active": rows, "medwatch_ids": medwatch}, indent=1))
    print(f"Backup → {backup}")

    # Two passes so an existing anticipated_start_date is never overwritten.
    no_onset = [r["id"] for r in rows if not r["anticipated_start_date"]]
    has_onset = [r["id"] for r in rows if r["anticipated_start_date"]]
    updated = 0
    for ids in chunks(has_onset, 200):
        db.table("shortage_events").update({"status": "anticipated"}).in_("id", ids).execute()
        updated += len(ids)
    by_id = {r["id"]: r for r in rows}
    for r_id in no_onset:
        db.table("shortage_events").update({
            "status": "anticipated",
            "anticipated_start_date": by_id[r_id]["start_date"],
        }).eq("id", r_id).execute()
        updated += 1
    print(f"Step 1: relabelled {updated} future-dated rows as anticipated.")

    flagged = 0
    for ids in chunks(medwatch, 200):
        db.table("shortage_events").update({"synthetic": True}).in_("id", ids).execute()
        flagged += len(ids)
    print(f"Step 2: flagged {flagged} MedWatch rows synthetic.")


if __name__ == "__main__":
    main()
