"""
Close the open Taiwan rows written by the v1 TFDA scraper (narrative press
bulletins, 2023-24) using TFDA's own open-data feeds.

Why: v2 (backend/scrapers/taiwan_tfda_scraper.py) reads the platform's full
per-product feeds and never touches v1 rows (they're excluded from its
carry-forward), so v1's 2023 "active"/"anticipated" rows would otherwise stay
open forever.

Per open v1 row (raw_data has article_id, no raw_data.feed):
  * TFDA feed 106 lists the drug as restored on a date >= the row's start →
    status resolved, end_date = that restored date (TFDA's own date).
  * The drug is in NO feed (TFDA's complete current list doesn't include it,
    and 106 has no restored date for it) → status resolved, end_date NULL
    (resolution date not published), with a note saying exactly that.
  * The drug is in an ACTIVE feed (104/105) and 106 has no later restoration
    → left untouched and listed: v2 writes the current shortage as its own
    row, and whether the 2023 bulletin described the same episode is unknown.

The v1 name → ingredient mapping is explicit and hand-checked (v1 stored a
Latin INN form and Chinese-only names), not matched fuzzily.

Dry-run by default; --apply writes. Run AFTER the v2 scraper's first live run.

Usage:
    python3 scripts/close_tfda_v1_bulletin_rows.py
    python3 scripts/close_tfda_v1_bulletin_rows.py --apply
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.scrapers import tfda_opendata as tfda  # noqa: E402
from backend.utils.db import get_supabase_client  # noqa: E402

SOURCE_ID = "10000000-0000-0000-0000-000000000116"

# v1 generic_name_normalised → register ingredient (strip_salts form).
V1_NAMES = {
    "entrectinibum": "entrectinib",
    "adenosine": "adenosine",
    "basiliximab": "basiliximab",
    "etomidate": "etomidate",
    "氧化鎂": "magnesium oxide",       # magnesium oxide
    "莫鼻卡": None,                     # brand-level term from a press statement; no ingredient stated
    "人工淚液": None,                   # "artificial tears" — a product class, not one ingredient
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    import httpx
    feeds = {}
    with httpx.Client(timeout=120) as client:
        for n in tfda.FEEDS:
            resp = client.get(tfda.FEED_URL.format(n=n))
            resp.raise_for_status()
            feeds[n] = tfda.parse_feed(resp.json())
    register = tfda.load_register()

    in_active: set[str] = set()
    restored: dict[str, str] = {}
    for n, rows in feeds.items():
        for r in rows:
            entry = register.get(tfda.canonical_licence(r["許可證字號"]))
            if not entry:
                continue
            for ing in tfda.split_ingredients(entry["ingredients"]):
                key = tfda.strip_salts(ing)
                if n in tfda.ACTIVE_FEEDS:
                    in_active.add(key)
                else:
                    d, _ = tfda.restored_date(r["供應狀態"])
                    if d and d > restored.get(key, ""):
                        restored[key] = d

    sb = get_supabase_client()
    rows = (
        sb.table("shortage_events")
        .select("id, drug_id, status, severity, start_date, end_date, notes, raw_data, drugs(generic_name_normalised)")
        .eq("data_source_id", SOURCE_ID)
        .in_("status", ["active", "anticipated", "stale"])
        .execute()
    ).data or []
    v1 = [r for r in rows if not (r.get("raw_data") or {}).get("feed")]

    today = date.today().isoformat()
    plan: list[tuple[dict, dict]] = []
    print(f"{'APPLY' if args.apply else 'DRY RUN'} — open v1 TFDA rows: {len(v1)}")
    for r in v1:
        name = (r.get("drugs") or {}).get("generic_name_normalised") or ""
        key = V1_NAMES.get(name)
        art = (r.get("raw_data") or {}).get("article_id")
        label = f"{r['status']:11s} start {r['start_date']}  {name} ({art})"
        if name not in V1_NAMES:
            print(f"  LEAVE  {label}: name not in the reviewed mapping")
            continue
        rest = restored.get(key) if key else None
        if rest and rest >= r["start_date"]:
            patch = {"status": "resolved", "end_date": rest,
                     "notes": (r.get("notes") or "") + f" | Closed {today}: TFDA's Drug Supply Information "
                              f"Platform (open-data feed 106) lists this drug as restored on {rest}."}
        elif key and key in in_active:
            print(f"  LEAVE  {label}: currently in TFDA's active list; v2 writes it as its own row")
            continue
        else:
            patch = {"status": "resolved", "end_date": None,
                     "notes": (r.get("notes") or "") + f" | Closed {today}: not on TFDA's Drug Supply Information "
                              "Platform shortage list (open-data feeds 104/105/106); TFDA does not publish "
                              "when it resolved, so no end date is given."}
        print(f"  CLOSE  {label} → end_date {patch['end_date']}")
        plan.append((r, patch))

    if not args.apply:
        print("Dry run — nothing written. Re-run with --apply.")
        return 0
    for r, patch in plan:
        sb.table("shortage_events").update(patch).eq("id", r["id"]).execute()
        sb.table("shortage_status_log").insert({
            "shortage_event_id": r["id"], "drug_id": r["drug_id"], "old_status": r["status"],
            "new_status": "resolved", "old_severity": r["severity"], "new_severity": r["severity"],
        }).execute()
    print(f"Closed {len(plan)} rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
