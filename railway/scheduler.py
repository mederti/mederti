#!/usr/bin/env python3
"""
Mederti Scraper Scheduler
Runs all shortage/recall scrapers on a daily schedule.

Railway will run this via the Procfile.
Set the Railway cron schedule to: 0 2 * * *  (2am UTC daily)
"""
from __future__ import annotations

import sys
import logging
import os

# Add scrapers directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scrapers"))

from tga_shortage   import TGAShortageScraper
from mhra_shortage  import MHRARecallScraper
from fda_shortage   import FDAShortageScraper, FDARecallScraper

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("scheduler")

# All scrapers to run, in order
SCRAPERS = [
    TGAShortageScraper,
    MHRARecallScraper,
    FDAShortageScraper,
    FDARecallScraper,
]


def run_all():
    log.info(f"=== Mederti scraper run starting — {len(SCRAPERS)} scrapers ===")
    results = {}

    for ScraperClass in SCRAPERS:
        name = ScraperClass.scraper_name
        log.info(f"\n--- Running {name} ---")
        try:
            scraper = ScraperClass()
            scraper.execute()
            results[name] = "success"
        except Exception as e:
            log.error(f"{name} crashed outside execute(): {e}")
            results[name] = f"crashed: {e}"

    log.info(f"\n=== Run complete ===")
    for name, result in results.items():
        log.info(f"  {name}: {result}")

    # After all scrapers complete, take daily snapshot
    log.info("Taking daily status snapshot...")
    try:
        from supabase import create_client
        sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        sb.rpc("take_daily_snapshot").execute()
        log.info("Daily snapshot saved.")
    except Exception as e:
        log.error(f"Snapshot failed: {e}")

    # Exit with error code if any scraper crashed
    if any("crashed" in str(v) for v in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    run_all()
