"""
Re-apply the corrected Peru (DIGEMID) and Norway (NoMA) status mapping to stored rows.
──────────────────────────────────────────────────────────────────────────────
Peru: a "Temporal" discontinuation whose window (fecha_fin) ended more than
      PeruDIGEMIDScraper.WINDOW_GRACE_DAYS ago is over by DIGEMID's own record;
      it was stored as active (~1,000 rows, some ending in 2019).
Norway: "Kommende" (upcoming) notices with a future start were stored as
      active instead of anticipated.

Each stored row's status is recomputed from its own raw_data with the
scraper's mapping (no hand-typed rules), so the repair matches what the fixed
scraper writes. The scrapers skip unchanged payloads, so without this the
stored rows would keep the old status until the source changed.

Every row touched is written to a JSON backup first; each status change gets a
shortage_status_log entry, as the scrapers write.

Usage:
    python3 -m backend.scripts.repair_pe_no_status             # dry run
    python3 -m backend.scripts.repair_pe_no_status --execute   # apply
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

from dotenv import load_dotenv
from supabase import create_client

from backend.scrapers.peru_digemid_scraper import PeruDIGEMIDScraper

REAL = "synthetic.is.null,synthetic.eq.false"


def _all(db, country: str, statuses: list[str]) -> list[dict]:
    out, start = [], 0
    while True:
        page = (
            db.table("shortage_events")
            .select("id, drug_id, status, severity, start_date, end_date, estimated_resolution_date, "
                    "anticipated_start_date, raw_data")
            .eq("country_code", country).in_("status", statuses).or_(REAL)
            .order("id").range(start, start + 999).execute().data
        )
        out += page
        if len(page) < 1000:
            return out
        start += 1000


def peru_changes(db) -> list[tuple[dict, dict]]:
    pe = PeruDIGEMIDScraper(db_client=MagicMock())
    changes = []
    for row in _all(db, "PE", ["active", "anticipated"]):
        ev = pe._normalise_record(row["raw_data"] or {})
        if ev and ev["status"] == "resolved" and ev["end_date"]:
            changes.append((row, {"status": "resolved", "end_date": ev["end_date"],
                                  "estimated_resolution_date": None}))
    return changes


def norway_changes(db) -> list[tuple[dict, dict]]:
    today = date.today().isoformat()
    changes = []
    for row in _all(db, "NO", ["active"]):
        raw_status = str((row["raw_data"] or {}).get("status") or "").lower()
        if "kommende" in raw_status and row["start_date"] > today:
            changes.append((row, {"status": "anticipated",
                                  "anticipated_start_date": row["start_date"]}))
    return changes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()
    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    plan = {"PE": peru_changes(db), "NO": norway_changes(db)}
    for cc, changes in plan.items():
        print(f"{cc}: {len(changes)} rows to change "
              f"{dict(Counter((r['status'], p['status']) for r, p in changes))}")
        for r, p in changes[:3]:
            name = (r["raw_data"] or {}).get("nombre_producto") or (r["raw_data"] or {}).get("legemiddelnavn")
            print(f"   e.g. {name}: {r['status']} start {r['start_date']} → {p}")
    if cc_pe := plan["PE"]:
        ages = Counter()
        for _, p in cc_pe:
            d = (date.today() - date.fromisoformat(p["end_date"])).days
            ages["31-180d" if d <= 180 else "181-365d" if d <= 365 else ">1y"] += 1
        print(f"   PE window ended: {dict(ages)}")

    if not args.execute:
        print("\nDry run — nothing changed. Re-run with --execute to apply.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("logs") / f"repair_pe_no_status_{stamp}.json"
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps({cc: [r for r, _ in ch] for cc, ch in plan.items()}, default=str))
    print(f"Backup of {sum(len(c) for c in plan.values())} rows: {backup}")

    done = 0
    for cc, changes in plan.items():
        for r, patch in changes:
            db.table("shortage_events").update(patch).eq("id", r["id"]).eq("status", r["status"]).execute()
            db.table("shortage_status_log").insert({
                "shortage_event_id": r["id"], "drug_id": r["drug_id"],
                "old_status": r["status"], "new_status": patch["status"],
                "old_severity": r["severity"], "new_severity": r["severity"],
            }).execute()
            done += 1
    print(f"Updated {done} rows.")


if __name__ == "__main__":
    main()
