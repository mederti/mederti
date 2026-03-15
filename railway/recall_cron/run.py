#!/usr/bin/env python3
"""
Mederti — Recall Cron Service
Runs all 10 recall scrapers via run_all_scrapers.py.
Scheduled every 6 hours on Railway.
"""
import subprocess
import sys

RECALL_KEYS = [
    "fda_recalls",
    "health_canada_recalls",
    "ema_recalls",
    "mhra_recalls",
    "bfarm_recalls",
    "ansm_recalls",
    "aifa_recalls",
    "aemps_recalls",
    "medsafe_recalls",
    "hsa_recalls",
]

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "run_all_scrapers.py"] + RECALL_KEYS,
    )
    sys.exit(result.returncode)
