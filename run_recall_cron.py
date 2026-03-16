#!/usr/bin/env python3
"""
Railway cron — runs all RECALL scrapers.
Schedule: every 6 hours (0 */6 * * *)

These scrapers check upstream regulatory sources for drug recall data
and upsert into the recalls table. After scraping, the recall linker
and recall alert dispatcher (called by main()) handle linking and
notifications.

Usage:
    python run_recall_cron.py                          # run all recall scrapers
    python run_recall_cron.py fda_recalls ema_recalls  # run specific recall scrapers
"""

from __future__ import annotations

import sys

from run_all_scrapers import SCRAPERS, main

# ─────────────────────────────────────────────────────────────────────────────
# Recall scrapers — inherit from BaseRecallScraper, write to the recalls table.
# NOTE: tga_recalls and fda_medwatch are shortage-type scrapers despite their
# names; they are NOT included here.
# ─────────────────────────────────────────────────────────────────────────────
RECALL_KEYS = sorted(k for k in SCRAPERS if k in {
    "fda_recalls", "health_canada_recalls", "ema_recalls", "mhra_recalls",
    "bfarm_recalls", "ansm_recalls", "aifa_recalls", "aemps_recalls",
    "medsafe_recalls", "hsa_recalls",
})


if __name__ == "__main__":
    # Allow overriding via CLI args: python run_recall_cron.py fda_recalls
    keys = sys.argv[1:] if len(sys.argv) > 1 else RECALL_KEYS
    print(f"[recall-cron] Running {len(keys)} recall scrapers: {', '.join(keys)}")
    sys.exit(main(keys))
