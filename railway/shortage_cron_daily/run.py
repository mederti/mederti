#!/usr/bin/env python3
"""
Mederti — Daily Shortage Cron Service (Railway, 02:00 UTC)

1. Runs every daily national shortage scraper that is not on the 4-hourly
   service (TGA/FDA/HC live in shortage_cron_frequent; recalls in recall_cron).
2. Runs the weekly / monthly pricing + supply-chain jobs on their own UTC day.
3. Runs the FULL daily data-quality check (backend.health.daily_check
   --with-scenarios --persist): every health detector plus the live-site
   scenario suite, with the result saved to data_health_runs so
   /admin/freshness shows it whether or not the ops email is delivered.

2026-11-22: the "Mac-only" scrapers below were moved here because the Mac
cron only fired ~10 of ~90 jobs/day while the laptop slept, leaving 12
sources stale on /admin/freshness. They are idempotent (MD5 shortage_id
dedup), so a run that overlaps a leftover Mac cron entry is harmless.

Step 3 always runs, even if a scraper failed: a failing scraper is exactly
what the quality check exists to report.
"""
import datetime as dt
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
    "greece_eof",
    "turkey_titck",
    "belgium_famhp",
    "malaysia_npra",
    "portugal_infarmed",
    "uae_mohap",
    # Moved from the Mac cron 2026-11-22 (were stale while the laptop slept)
    "argentina_anmat",
    "hk_drugoffice",
    "poland_mz",
    "slovakia_sukl",
    "india_cdsco",
    "china_nmpa",
    # Country-coverage expansion batch (2026-07-02), moved from Mac 2026-11-22.
    # lithuania_vvkt deliberately NOT moved: Cloudflare blocks every request.
    "slovenia_jazmp",
    "iceland_lyfjastofnun",
    "bosnia_almbih",
    "thailand_fda",
    "colombia_invima",
    "croatia_halmed",
    "latvia_zva",
    "romania_anmdmr",
    "estonia_ravimiamet",
    "peru_digemid",
    "senegal_arp",
    "taiwan_tfda",
    "srilanka_nmra",
    # Daily pricing feeds, moved from Mac 2026-11-22
    "nadac",
    "nhs_drug_tariff",
    # Vaccines (2026-11-23): Germany's vaccine regulator; BfArM excludes vaccines
    "pei_vaccines",
]

# Weekly jobs keyed by UTC weekday (Mon=0). Same days the Mac ran them
# (its early-morning AEDT slots = the previous UTC day).
WEEKLY_KEYS = {
    0: ["france_bdpm"],                 # ANSM BDPM refreshes ~weekly
    1: ["aifa_pricing", "mhra_gmdp"],   # AIFA transparency lists; MHRA GMP register
    2: ["spain_nomenclator"],           # Nomenclátor — Mac cron line was broken since Jun
}

# Quarterly API supply-chain jobs, 1st of Jan/Apr/Jul/Oct (UTC). Order
# matters: fda_decrs enriches the rows fda_dmf writes, and edqm_cep (monthly,
# below) resolves against substances these already matched.
QUARTERLY_KEYS = ["fda_dmf", "fda_decrs", "who_pq", "fda_inspections"]

# Monthly jobs, run on the 1st (UTC), after the quarterly ones.
MONTHLY_KEYS = ["edqm_cep"]


def keys_for(today: dt.date) -> list[str]:
    keys = list(SHORTAGE_KEYS)
    keys += WEEKLY_KEYS.get(today.weekday(), [])
    if today.day == 1:
        if today.month in (1, 4, 7, 10):
            keys += QUARTERLY_KEYS
        keys += MONTHLY_KEYS
    return keys


if __name__ == "__main__":
    today = dt.datetime.now(dt.timezone.utc).date()

    scrape = subprocess.run([sys.executable, "run_all_scrapers.py"] + keys_for(today))

    # Flag vaccine records (drugs.is_vaccine, migration 080) — including any
    # drug rows the scrapers just auto-created. Failure here must not mask
    # the scraper result.
    classify = subprocess.run(
        [sys.executable, "-m", "backend.scripts.classify_vaccines",
         "--execute", "--manifest-dir", "/tmp"],
    )
    if classify.returncode != 0:
        print(f"classify_vaccines exited {classify.returncode}", file=sys.stderr)

    quality = subprocess.run([
        sys.executable, "-m", "backend.health.daily_check",
        "--with-scenarios", "--persist", "--runner", "railway:shortage-cron-daily",
    ])

    # daily_check exits 1 on warnings; only scraper failures or quality
    # *errors* (exit 2) should mark the Railway run as failed.
    failed = scrape.returncode != 0 or quality.returncode >= 2
    sys.exit(1 if failed else 0)
