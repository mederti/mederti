#!/usr/bin/env python3
"""
Mederti — Stale Shortage Cleanup
─────────────────────────────────
1. Mark active shortages as 'stale' if last_verified_at > 7 days ago
2. Clear past-due estimated_resolution_date on active shortages
3. Print summary of changes

Usage:
    cd /path/to/mederti
    python3 -m backend.cleanup_stale          # live run
    MEDERTI_DRY_RUN=1 python3 -m backend.cleanup_stale   # dry run
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv()

from backend.utils.db import get_supabase_client

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"


def main() -> None:
    db = get_supabase_client()
    today = datetime.now(timezone.utc).date().isoformat()
    stale_threshold = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Mederti Stale Shortage Cleanup")
    print(f"  Today:            {today}")
    print(f"  Stale threshold:  {stale_threshold[:19]}")
    print()

    # ── 1. Mark stale shortages ──────────────────────────────────────────────
    # Find active/anticipated shortages not verified in 7+ days
    stale_query = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .lt("last_verified_at", stale_threshold)
    )
    stale_resp = stale_query.execute()
    stale_count = stale_resp.count or 0
    print(f"  Stale shortages (active, unverified >7d): {stale_count}")

    if stale_count > 0 and not DRY_RUN:
        result = (
            db.table("shortage_events")
            .update({"status": "stale"})
            .in_("status", ["active", "anticipated"])
            .lt("last_verified_at", stale_threshold)
            .execute()
        )
        updated = len(result.data) if result.data else 0
        print(f"  ✓ Marked {updated} shortages as 'stale'")
    elif DRY_RUN:
        print(f"  [DRY RUN] Would mark {stale_count} as 'stale'")

    # ── 2. Clear past-due ETAs ───────────────────────────────────────────────
    # Active shortages with estimated_resolution_date in the past
    past_eta_query = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .lt("estimated_resolution_date", today)
        .not_.is_("estimated_resolution_date", "null")
    )
    past_eta_resp = past_eta_query.execute()
    past_eta_count = past_eta_resp.count or 0
    print(f"\n  Past-due ETAs (active, ETA < today): {past_eta_count}")

    if past_eta_count > 0 and not DRY_RUN:
        result = (
            db.table("shortage_events")
            .update({"estimated_resolution_date": None})
            .in_("status", ["active", "anticipated"])
            .lt("estimated_resolution_date", today)
            .not_.is_("estimated_resolution_date", "null")
            .execute()
        )
        updated = len(result.data) if result.data else 0
        print(f"  ✓ Cleared {updated} past-due estimated_resolution_dates")
    elif DRY_RUN:
        print(f"  [DRY RUN] Would clear {past_eta_count} past-due ETAs")

    # ── 3. Summary ───────────────────────────────────────────────────────────
    # Recheck active count
    active_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .eq("status", "active")
        .execute()
    )
    stale_total = (
        db.table("shortage_events")
        .select("id", count="exact")
        .eq("status", "stale")
        .execute()
    )
    print(f"\n  ── Post-cleanup totals ──")
    print(f"  Active:  {active_resp.count or 0}")
    print(f"  Stale:   {stale_total.count or 0}")
    print(f"\n  Done.")


if __name__ == "__main__":
    main()
