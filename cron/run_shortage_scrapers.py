#!/usr/bin/env python3
"""
Core shortage scrapers — Railway cron service.
Schedule: every 6 hours (0 */6 * * *)

Runs the 12 core shortage scrapers sequentially.
Each scraper has a 5-minute timeout.
"""
from __future__ import annotations

import os
import sys
import time

# Ensure repo root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run_all_scrapers import SCRAPERS, _setup_logging

CORE_SHORTAGE_SCRAPERS = [
    "tga", "fda", "health_canada", "mhra", "ema", "bfarm",
    "ansm", "aifa", "aemps", "fda_enforcement", "hsa", "pharmac",
    # Phase 8
    "medsafe", "cbg_meb", "dkma", "fimea", "hpra", "lakemedelsverket",
    "sukl", "ogyei", "swissmedic", "noma", "ages",
    # Phase 9+
    "anvisa", "pmda", "mfds", "cofepris", "sahpra", "nafdac", "sfda",
]

log = _setup_logging()


def run_scraper(name: str) -> bool:
    """Run a single scraper by name. Returns True on success."""
    if name not in SCRAPERS:
        log.warning(f"Unknown scraper: {name}")
        return False

    module_path, class_name = SCRAPERS[name]
    try:
        import importlib
        mod = importlib.import_module(module_path)
        cls = getattr(mod, class_name)
        scraper = cls()
        t0 = time.monotonic()
        summary = scraper.run()
        elapsed = time.monotonic() - t0
        status = summary.get("status", "unknown")
        records = summary.get("records_upserted", 0)
        log.info(f"{name:25s}  {status:12s}  {records:5d} records  {elapsed:.1f}s")
        return status in ("success", "duplicate")
    except Exception as exc:
        log.error(f"{name} failed: {exc}")
        return False


if __name__ == "__main__":
    log.info("=" * 60)
    log.info("SHORTAGE SCRAPERS — Railway cron run")
    log.info("=" * 60)

    succeeded = 0
    failed = 0

    for name in CORE_SHORTAGE_SCRAPERS:
        if run_scraper(name):
            succeeded += 1
        else:
            failed += 1

    log.info(f"Done. Succeeded: {succeeded}  Failed: {failed}")
    sys.exit(0 if failed == 0 else 1)
