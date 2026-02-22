#!/usr/bin/env python3
"""
Mederti — Master Scraper Runner
────────────────────────────────
Runs all scrapers sequentially, logging output to logs/scraper_YYYY-MM-DD.log.

Usage:
    python3 run_all_scrapers.py              # run all scrapers
    python3 run_all_scrapers.py tga fda      # run specific scrapers by key
    MEDERTI_DRY_RUN=1 python3 run_all_scrapers.py   # dry run (no DB writes)

Cron schedule (UTC, staggered 30 min from 19:00 UTC = 06:00 AEST/UTC+11):
    TGA          0 19 * * *
    FDA         30 19 * * *
    HealthCan    0 20 * * *
    MHRA        30 20 * * *
    EMA          0 21 * * *
    BfArM       30 21 * * *
    ANSM         0 22 * * *
    AIFA        30 22 * * *
    AEMPS        0 23 * * *
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Scraper registry  (key → module path, class name)
# ─────────────────────────────────────────────────────────────────────────────

SCRAPERS: dict[str, tuple[str, str]] = {
    "tga":            ("backend.scrapers.tga_scraper",           "TGAScraper"),
    "fda":            ("backend.scrapers.fda_scraper",           "FDAScraper"),
    "health_canada":  ("backend.scrapers.health_canada_scraper", "HealthCanadaScraper"),
    "mhra":           ("backend.scrapers.mhra_scraper",          "MHRAScraper"),
    "ema":            ("backend.scrapers.ema_scraper",           "EMAScraper"),
    "bfarm":          ("backend.scrapers.bfarm_scraper",         "BfArMScraper"),
    "ansm":           ("backend.scrapers.ansm_scraper",          "ANSMScraper"),
    "aifa":           ("backend.scrapers.aifa_scraper",          "AIFAScraper"),
    "aemps":          ("backend.scrapers.aemps_scraper",         "AEMPSScraper"),
}

# ─────────────────────────────────────────────────────────────────────────────
# Logging setup
# ─────────────────────────────────────────────────────────────────────────────

def _setup_logging() -> logging.Logger:
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_file = log_dir / f"scraper_{date_str}.log"

    fmt = "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s"
    datefmt = "%Y-%m-%dT%H:%M:%SZ"

    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        datefmt=datefmt,
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger("mederti.run_all")


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

def run_scraper(key: str, module_path: str, class_name: str,
                dry_run: bool, log: logging.Logger) -> dict:
    """Import and run a single scraper.  Returns a result summary dict."""
    log.info("=" * 60)
    log.info(f"START  {key.upper()}")
    log.info("=" * 60)
    t0 = time.monotonic()

    try:
        module = importlib.import_module(module_path)
        cls = getattr(module, class_name)

        if dry_run:
            from unittest.mock import MagicMock
            scraper = cls(db_client=MagicMock())
            raw = scraper.fetch()
            events = scraper.normalize(raw)
            elapsed = time.monotonic() - t0
            result = {
                "scraper":   key,
                "status":    "dry_run",
                "records":   len(events),
                "skipped":   len(raw) - len(events),
                "duration_s": round(elapsed, 1),
                "error":     None,
            }
            log.info(f"DRY RUN  {key}: {len(events)} normalised from {len(raw)} raw  ({elapsed:.1f}s)")
        else:
            scraper = cls()
            summary = scraper.run()
            elapsed = time.monotonic() - t0
            result = {
                "scraper":    key,
                "status":     summary.get("status"),
                "records":    summary.get("records_processed"),
                "skipped":    summary.get("skipped"),
                "duration_s": round(elapsed, 1),
                "error":      summary.get("error"),
            }
            log.info(
                f"DONE  {key}: status={result['status']}  "
                f"records={result['records']}  skipped={result['skipped']}  "
                f"({elapsed:.1f}s)"
            )

    except Exception as exc:
        elapsed = time.monotonic() - t0
        result = {
            "scraper":    key,
            "status":     "error",
            "records":    None,
            "skipped":    None,
            "duration_s": round(elapsed, 1),
            "error":      str(exc),
        }
        log.exception(f"ERROR  {key}: {exc}")

    return result


def main(keys: list[str] | None = None) -> int:
    from dotenv import load_dotenv
    load_dotenv()

    log       = _setup_logging()
    dry_run   = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    run_start = datetime.now(timezone.utc)

    log.info("=" * 60)
    log.info(f"Mederti scraper run  started={run_start.isoformat()}  dry_run={dry_run}")
    log.info("=" * 60)

    # Determine which scrapers to run
    if keys:
        unknown = [k for k in keys if k not in SCRAPERS]
        if unknown:
            log.error(f"Unknown scrapers: {unknown}  Valid: {list(SCRAPERS)}")
            return 1
        targets = [(k, *SCRAPERS[k]) for k in keys]
    else:
        targets = [(k, m, c) for k, (m, c) in SCRAPERS.items()]

    results: list[dict] = []
    for key, module_path, class_name in targets:
        result = run_scraper(key, module_path, class_name, dry_run, log)
        results.append(result)

    # ── Summary table ─────────────────────────────────────────────────────────
    run_end     = datetime.now(timezone.utc)
    total_s     = (run_end - run_start).total_seconds()
    errors      = [r for r in results if r["status"] == "error"]
    successes   = [r for r in results if r["status"] not in ("error",)]

    log.info("")
    log.info("=" * 60)
    log.info(f"RUN COMPLETE  {run_end.isoformat()}  total={total_s:.0f}s")
    log.info("=" * 60)
    log.info(f"{'SCRAPER':<20} {'STATUS':<12} {'RECORDS':>8} {'SKIPPED':>8} {'DURATION':>10}")
    log.info("-" * 62)
    for r in results:
        log.info(
            f"{r['scraper']:<20} {str(r['status']):<12} "
            f"{str(r['records'] or ''):>8} {str(r['skipped'] or ''):>8} "
            f"{r['duration_s']:>9.1f}s"
        )
    log.info("-" * 62)
    log.info(f"Succeeded: {len(successes)}   Errors: {len(errors)}")
    if errors:
        for r in errors:
            log.error(f"  {r['scraper']}: {r['error']}")

    return 1 if errors else 0


if __name__ == "__main__":
    keys = sys.argv[1:] or None
    sys.exit(main(keys))
