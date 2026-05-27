#!/usr/bin/env python3
"""
mark_stale_shortages cron runner — Railway-friendly.
Recommended schedule: daily at 07:00 UTC (after the scraper window).

Closes audit FINDING-D1-13. The Postgres function `mark_stale_shortages()`
landed in migration 001 and has been ready to use since day one. Its
docstring even says "Call on a cron schedule (e.g. daily). Marks any
shortage that has not been re-confirmed by a scraper in the last 7 days
as 'stale'." But no cron actually invokes it — `cron/crontab_fixed.txt`
doesn't include it; the duplicate-payload re-activation path in
base_scraper.py:553 means a stale row gets bounced back to 'active' if
it gets re-confirmed, but a shortage that has *truly* gone away (regulator
removed the entry) stays as 'active' forever.

What this script does:
  • Calls the SECURITY DEFINER `mark_stale_shortages()` Postgres function
    via Supabase RPC (auth via SUPABASE_SERVICE_ROLE_KEY).
  • The function:
      - Updates shortage_events.status='stale' for rows with status IN
        ('active','anticipated') and last_verified_at < NOW() - 7 days
      - Returns the count of rows updated
      - Writes an audit_logs row for the batch operation if count > 0
  • Logs the result via the structured JSON logger.
  • Returns exit 0 on success (any count), exit 1 on RPC failure.

Idempotent — running it twice the same day is harmless; the second run's
WHERE clause matches nothing because the first already flipped the rows.
"""
from __future__ import annotations

import os
import sys
import time

# Ensure repo root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run_all_scrapers import _setup_logging

# Sentry init — inert until SENTRY_DSN is set. See docs/sentry-setup.md.
try:
    from backend.utils.sentry import init_sentry
    init_sentry("mark-stale")
except Exception:
    pass  # never let observability scaffolding block a maintenance run

from backend.utils.db import get_supabase_client


log = _setup_logging()


def run() -> int:
    """Call mark_stale_shortages() via RPC. Returns the row count flipped to stale."""
    db = get_supabase_client()
    t0 = time.monotonic()
    try:
        resp = db.rpc("mark_stale_shortages")
    except Exception as exc:
        log.error(f"mark_stale_shortages RPC failed: {exc}")
        return -1
    elapsed = time.monotonic() - t0

    # PostgREST wraps a scalar SQL function return in a list — pull it out.
    raw = resp.data
    if isinstance(raw, list) and raw:
        count = raw[0] if isinstance(raw[0], int) else int(raw[0]) if str(raw[0]).isdigit() else 0
    elif isinstance(raw, int):
        count = raw
    else:
        count = 0

    log.info(
        f"mark_stale_shortages           rows_marked_stale={count:5d}  elapsed={elapsed:.2f}s"
    )
    return count


if __name__ == "__main__":
    log.info("=" * 60)
    log.info("MARK STALE SHORTAGES — Railway cron run")
    log.info("=" * 60)
    count = run()
    if count < 0:
        sys.exit(1)
    log.info(f"Done. Marked {count} row(s) stale.")
    sys.exit(0)
