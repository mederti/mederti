#!/usr/bin/env python3
"""
Recall scrapers — Railway cron service.
Schedule: every 6 hours (0 */6 * * *)

Runs all recall database scrapers sequentially.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run_all_scrapers import SCRAPERS, _setup_logging

RECALL_SCRAPERS = [
    # Verified working in production / daily cron
    "tga_recalls", "fda_recalls", "fda_medwatch",
    "health_canada_recalls", "ema_recalls", "mhra_recalls",
    # Verified working 2026-05-26 (dry-run dormant test)
    "ansm_recalls",       # FR — recent recall e.g. 2026-05-22
    "aifa_recalls",       # IT — recent recall e.g. 2026-01-13
    "medsafe_recalls",    # NZ — slow (per-recall detail fetch, ~2s each); completes in Railway
    # Quarantined 2026-05-26 — see notes; re-enable once fixed
    # "aemps_recalls",    # ES — 403 Forbidden (anti-bot)
    # "bfarm_recalls",    # DE — 404 on pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html
    # "hsa_recalls",      # SG — 404 on hsa.gov.sg/announcements/safety-alerts-and-product-recalls
]

log = _setup_logging()


def run_scraper(name: str) -> bool:
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
    log.info("RECALL SCRAPERS — Railway cron run")
    log.info("=" * 60)

    succeeded = 0
    failed = 0
    for name in RECALL_SCRAPERS:
        if run_scraper(name):
            succeeded += 1
        else:
            failed += 1

    log.info(f"Done. Succeeded: {succeeded}  Failed: {failed}")
    sys.exit(0 if failed == 0 else 1)
