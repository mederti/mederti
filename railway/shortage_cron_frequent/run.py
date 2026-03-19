#!/usr/bin/env python3
"""
Mederti — Frequent Shortage Cron Service
Runs AU/US/CA shortage scrapers via run_all_scrapers.py.
Scheduled every 4 hours on Railway.
"""
import subprocess
import sys

SHORTAGE_KEYS = [
    "tga",
    "fda",
    "health_canada",
]

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "run_all_scrapers.py"] + SHORTAGE_KEYS,
    )
    sys.exit(result.returncode)
