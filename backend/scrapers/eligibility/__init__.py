"""Eligibility scrapers — populate the regulatory_eligibility table (migration 040).

Each scraper hits the regulator's published eligibility listing (TGA Section 19A,
NHSBSA SSP, FDA Drug Shortage list, EU Article 5(2)) and upserts entries via the
Supabase REST API.

Scrapers in this module do NOT use BaseScraper from backend/scrapers/base_scraper.py
because that base is specialised for shortage_events. Eligibility entries have a
different lifecycle (per-application, longer-lived, regulator-specific reference
IDs) so they live in their own table with a lighter-weight base in base.py.

Run individually:
    python3 -m backend.scrapers.eligibility.tga_s19a
    python3 -m backend.scrapers.eligibility.mhra_ssp
    python3 -m backend.scrapers.eligibility.fda_shortage
    python3 -m backend.scrapers.eligibility.eu_art_5_2

Or via cron — add the corresponding lines to cron/crontab_fixed.txt once the
scrapers are validated against staging.
"""
