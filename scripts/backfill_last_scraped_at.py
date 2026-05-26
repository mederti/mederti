"""
Backfill data_sources.last_scraped_at from event timestamps.

The base scraper classes now write last_scraped_at on every successful run
(see backend/scrapers/base_scraper.py and base_recall_scraper.py), but
historical rows that pre-date that change have last_scraped_at = NULL.
That looks identical to "scraper is broken" in the chat's source-trail UI
even when the scraper has been running fine and just never wrote the field.

This script picks the freshest credible timestamp per data_source:
  - shortage_events: MAX(scraped_at) → fallback MAX(start_date)
  - recalls:         MAX(announced_date)
…and writes it to data_sources.last_scraped_at IF the current value is NULL
or older than the candidate. Never overwrites a value newer than what we
found in events (the heartbeat from the next real scraper run should win).

Dry-run by default. Re-run with --apply once the dry-run output looks right.

Usage:
    python3 scripts/backfill_last_scraped_at.py            # dry run
    python3 scripts/backfill_last_scraped_at.py --apply    # write
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (source .env)")
    sys.exit(1)

H = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def get_rows(table: str, **params: Any) -> list[dict[str, Any]]:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=H, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def patch_row(table: str, row_id: str, patch: dict[str, Any]) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": f"eq.{row_id}"},
        json=patch,
        timeout=30,
    )
    r.raise_for_status()


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    # Normalise everything to UTC-aware so naive `start_date` ("2026-05-26")
    # and aware `last_verified_at` ("...+00:00") can be compared safely.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def best_candidate(source_id: str) -> tuple[datetime, str] | None:
    """Return (timestamp, reason) for the most recent credible signal of activity."""
    candidates: list[tuple[datetime, str]] = []

    # Shortage events for this source — last_verified_at is closest to a
    # scrape signal; start_date / updated_at are credible fallbacks.
    ev = get_rows(
        "shortage_events",
        select="last_verified_at,start_date,updated_at",
        data_source_id=f"eq.{source_id}",
        order="last_verified_at.desc.nullslast",
        limit="1",
    )
    if ev:
        for col in ("last_verified_at", "updated_at", "start_date"):
            ts = parse_ts(ev[0].get(col))
            if ts:
                candidates.append((ts, f"shortage_events.{col}"))
                break

    # Recalls for this source — announced_date / updated_at. Recalls table
    # uses `source_id` (not `data_source_id`).
    rc = get_rows(
        "recalls",
        select="announced_date,updated_at",
        source_id=f"eq.{source_id}",
        order="updated_at.desc.nullslast",
        limit="1",
    )
    if rc:
        for col in ("updated_at", "announced_date"):
            ts = parse_ts(rc[0].get(col))
            if ts:
                candidates.append((ts, f"recalls.{col}"))
                break

    if not candidates:
        return None
    return max(candidates, key=lambda t: t[0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write the updates")
    args = ap.parse_args()

    sources = get_rows(
        "data_sources",
        select="id,abbreviation,country_code,name,last_scraped_at,is_active",
        is_active="eq.true",
        limit="500",
    )
    print(f"Loaded {len(sources)} active data_sources")

    updates = 0
    skipped_fresh = 0
    no_signal = 0
    for s in sources:
        existing = parse_ts(s.get("last_scraped_at"))
        cand = best_candidate(s["id"])
        if not cand:
            no_signal += 1
            print(f"  {s['abbreviation'] or '?':18s} {s['country_code'] or '?':3s}  no event signal — keeping {s.get('last_scraped_at')}")
            continue
        new_ts, reason = cand
        if existing and existing >= new_ts:
            skipped_fresh += 1
            continue

        delta = "" if not existing else f" (was {existing.isoformat()})"
        print(f"  {s['abbreviation'] or '?':18s} {s['country_code'] or '?':3s}  → {new_ts.isoformat()} [{reason}]{delta}")
        if args.apply:
            try:
                patch_row("data_sources", s["id"], {"last_scraped_at": new_ts.isoformat()})
                updates += 1
            except Exception as exc:
                print(f"    FAIL: {exc}", file=sys.stderr)

    print()
    print(f"{'APPLIED' if args.apply else 'DRY RUN'} — updated={updates} skipped_fresh={skipped_fresh} no_signal={no_signal}")
    if not args.apply:
        print("(re-run with --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
