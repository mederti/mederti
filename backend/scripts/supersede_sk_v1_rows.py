"""
Close + annotate the Slovak rows written by the lost v1 ŠÚKL scraper.

v1 (never committed; ran from the live crontab until ~2026-05-26) read the
portal's English legend, which swaps R and O. So an O notification (supply
RESUMED) was published as an active shortage. The v2 scraper
(backend/scrapers/slovakia_sukl_scraper.py) rebuilds every product's episodes
from the official export; v1 rows it did not overwrite are the ones v2 never
touches (last_verified_at before 2026-11-01).

Nothing is deleted. Open v1 rows → resolved (status change logged); every v1
row gets a note saying why.

    python3 -m backend.scripts.supersede_sk_v1_rows            # dry run
    python3 -m backend.scripts.supersede_sk_v1_rows --execute
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

SOURCE_ID = "10000000-0000-0000-0000-000000000057"
CUTOFF = "2026-11-01"
NOTE = ("Superseded 2026-11-10: written by the v1 ŠÚKL scraper, which swapped notification codes "
        "(O = supply RESUMED, R = supply interrupted). Not a current shortage; see the v2 rows for this product.")


def main() -> int:
    load_dotenv()
    execute = "--execute" in sys.argv
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    rows = (db.table("shortage_events")
            .select("id, drug_id, status, severity, notes, start_date, raw_data")
            .eq("data_source_id", SOURCE_ID).lt("last_verified_at", CUTOFF).execute().data)
    to_close = [r for r in rows if r["status"] != "resolved"]
    for r in rows:
        print(f"{r['status']:9s} {r['start_date']} {(r['raw_data'] or {}).get('subject')} "
              f"{((r['raw_data'] or {}).get('drug') or '')[:60]}")
    print(f"\n{len(rows)} v1 rows; {len(to_close)} open → resolved. {'EXECUTING' if execute else 'dry run'}")
    if not execute:
        return 0
    logs = []
    for r in rows:
        if NOTE in (r["notes"] or ""):
            continue
        patch = {"notes": f"{r['notes']}\n{NOTE}" if r["notes"] else NOTE}
        if r["status"] != "resolved":
            patch["status"] = "resolved"
            logs.append({"shortage_event_id": r["id"], "drug_id": r["drug_id"],
                         "old_status": r["status"], "new_status": "resolved",
                         "old_severity": r["severity"], "new_severity": r["severity"]})
        db.table("shortage_events").update(patch).eq("id", r["id"]).execute()
    if logs:
        db.table("shortage_status_log").insert(logs).execute()
    print(f"done: annotated {len(rows)}, closed {len(logs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
