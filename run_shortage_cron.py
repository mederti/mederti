#!/usr/bin/env python3
"""
Railway cron — runs all SHORTAGE scrapers.
Schedule: every 30 minutes (*/30 * * * *)

These scrapers check upstream regulatory sources for drug shortage data
and upsert into shortage_events. After scraping, dispatches alerts and
runs the recall linker.

Usage:
    python run_shortage_cron.py                # run all shortage scrapers
    python run_shortage_cron.py tga fda        # run specific shortage scrapers
"""

from __future__ import annotations

import sys

from run_all_scrapers import SCRAPERS, main

# ─────────────────────────────────────────────────────────────────────────────
# Recall scrapers (write to the recalls table, run on a separate 6-hour cron)
# ─────────────────────────────────────────────────────────────────────────────
RECALL_KEYS = {
    "fda_recalls", "health_canada_recalls", "ema_recalls", "mhra_recalls",
    "bfarm_recalls", "ansm_recalls", "aifa_recalls", "aemps_recalls",
    "medsafe_recalls", "hsa_recalls",
}

# Scrapers that require API keys not set on Railway
DISABLED_KEYS = {"ashp"}

# ─────────────────────────────────────────────────────────────────────────────
# Shortage scrapers = everything except recall scrapers and disabled scrapers
# ─────────────────────────────────────────────────────────────────────────────
SHORTAGE_KEYS = sorted(
    k for k in SCRAPERS
    if k not in RECALL_KEYS and k not in DISABLED_KEYS
)


if __name__ == "__main__":
    # Allow overriding via CLI args: python run_shortage_cron.py tga fda
    keys = sys.argv[1:] if len(sys.argv) > 1 else SHORTAGE_KEYS
    print(f"[shortage-cron] Running {len(keys)} shortage scrapers: {', '.join(keys)}")
    sys.exit(main(keys))
