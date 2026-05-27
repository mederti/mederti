#!/usr/bin/env python3
"""
Eligibility scrapers — Railway cron service.
Recommended schedule: daily (e.g. 0 8 * * *) — these listings change at
most weekly, daily is fine and gives the freshness dashboard a heartbeat.

Closes audit FINDING-D2-06: the 4 eligibility scrapers landed real parsers
in commit fa89dc0 (Sprint 3 PR 1) but were never scheduled — they only ran
from each file's `if __name__ == "__main__":` manual entry point. The
regulatory_eligibility table (migration 040) goes stale immediately after
the manual seed.

Scrapers run sequentially. Each has its own try/except so one broken
source doesn't poison the rest. Each writes (or refreshes) rows in
regulatory_eligibility; the base class handles upsert + lapsed-marking.

Runtime: ~30-60s total (each scraper is a single HTTP fetch + parse).
"""
from __future__ import annotations

import os
import sys
import time

# Ensure repo root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run_all_scrapers import _setup_logging

# Sentry init — inert until SENTRY_DSN is set. See docs/sentry-setup.md.
try:
    from backend.utils.sentry import init_sentry
    init_sentry("eligibility-scrapers")
except Exception:
    pass  # never let observability scaffolding block a scraper run

from backend.scrapers.eligibility.fda_shortage import FdaShortageList
from backend.scrapers.eligibility.mhra_ssp import NhsbsaSsp
from backend.scrapers.eligibility.tga_s19a import TgaSection19A
from backend.scrapers.eligibility.eu_art_5_2 import EuArticle5_2


ELIGIBILITY_SCRAPERS = [
    ("fda_shortage_list", FdaShortageList),
    ("nhsbsa_ssp",        NhsbsaSsp),
    ("tga_section_19a",   TgaSection19A),
    ("eu_article_5_2",    EuArticle5_2),
]

log = _setup_logging()


def run_one(name: str, cls) -> bool:
    """Run a single eligibility scraper. Returns True on success."""
    try:
        scraper = cls()
        t0 = time.monotonic()
        summary = scraper.run()
        elapsed = time.monotonic() - t0
        fetched  = summary.get("fetched",  0)
        upserted = summary.get("upserted", 0)
        lapsed   = summary.get("lapsed",   0)
        errors   = summary.get("errors",   0)
        log.info(
            f"{name:22s}  fetched={fetched:4d}  upserted={upserted:4d}  "
            f"lapsed={lapsed:3d}  errors={errors:2d}  {elapsed:.1f}s"
        )
        return errors == 0
    except Exception as exc:
        log.error(f"{name} failed: {exc}")
        return False


if __name__ == "__main__":
    log.info("=" * 60)
    log.info("ELIGIBILITY SCRAPERS — Railway cron run")
    log.info("=" * 60)

    succeeded = 0
    failed = 0
    for name, cls in ELIGIBILITY_SCRAPERS:
        if run_one(name, cls):
            succeeded += 1
        else:
            failed += 1

    log.info(f"Done. Succeeded: {succeeded}  Failed: {failed}")
    sys.exit(0 if failed == 0 else 1)
