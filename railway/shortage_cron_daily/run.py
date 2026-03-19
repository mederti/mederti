#!/usr/bin/env python3
"""
Mederti — Daily Shortage Cron Service
Runs all non-frequent shortage scrapers via run_all_scrapers.py.
Scheduled daily at 02:00 UTC on Railway.

Excludes TGA/FDA/HC (handled by shortage_cron_frequent)
and all recall scrapers (handled by recall_cron).
"""
import subprocess
import sys

SHORTAGE_KEYS = [
    # Phase 1-7: Core markets
    "mhra",
    "ema",
    "bfarm",
    "ansm",
    "aifa",
    "aemps",
    "fda_enforcement",
    "hsa",
    "pharmac",
    # Phase 8: Additional EU/APAC
    "medsafe",
    "cbg_meb",
    "dkma",
    "fimea",
    "hpra",
    "lakemedelsverket",
    "sukl",
    "ogyei",
    "swissmedic",
    "noma",
    "ages",
    # Phase 9+: New countries
    "anvisa",
    "pmda",
    "mfds",
    "cofepris",
    "sahpra",
    "nafdac",
    "sfda",
]

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "run_all_scrapers.py"] + SHORTAGE_KEYS,
    )
    sys.exit(result.returncode)
