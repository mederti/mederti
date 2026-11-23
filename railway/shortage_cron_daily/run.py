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
    # Phase 10: Newly fixed scrapers (Mar 2026)
    "greece_eof",           # 264 records — PDF from eof.gr
    "turkey_titck",         # ~15 records — supply dept announcements
    "belgium_famhp",        # 13,000+ records — PharmaStatus API
    "malaysia_npra",        # 168 records — safety alerts
    "portugal_infarmed",    # 30 records — shortage monitoring + Excel
    "uae_mohap",            # 11 records — EDE (ede.gov.ae)
    # Vaccines (2026-11-23): Germany's vaccine regulator; BfArM excludes vaccines
    "pei_vaccines",         # PEI human-vaccine shortages, current list + archive
]

if __name__ == "__main__":
    result = subprocess.run(
        [sys.executable, "run_all_scrapers.py"] + SHORTAGE_KEYS,
    )
    # Flag vaccine records (drugs.is_vaccine, migration 080) — including any
    # drug rows the scrapers just auto-created. Failure here must not mask
    # the scraper result.
    classify = subprocess.run(
        [sys.executable, "-m", "backend.scripts.classify_vaccines",
         "--execute", "--manifest-dir", "/tmp"],
    )
    if classify.returncode != 0:
        print(f"classify_vaccines exited {classify.returncode}", file=sys.stderr)
    sys.exit(result.returncode)
