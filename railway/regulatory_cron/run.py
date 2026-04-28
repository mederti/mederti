#!/usr/bin/env python3
"""
Mederti — Regulatory & Pipeline Cron Service
Runs FDA AdComm + EMA CHMP + ClinicalTrials.gov scrapers.

Scheduled weekly (Mondays at 04:00 UTC).
"""
import subprocess
import sys

REGULATORY_KEYS = [
    "fda_adcomm",          # FDA Advisory Committee notices via Federal Register
    "ema_chmp",            # EMA CHMP meeting highlights
    "clinicaltrials",      # ClinicalTrials.gov Phase III/IV trials
]

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "run_all_scrapers.py"] + REGULATORY_KEYS,
    )
    sys.exit(result.returncode)
