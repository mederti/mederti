-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 066 — Backfill 5 data_sources rows dropped by prod migration drift
--
-- Discovered 2026-07-02 while reconciling the homepage "countries" stat (35
-- live vs 38 expected). These 5 rows were part of migration 010's original
-- 12-row seed but never landed in prod. Confirmed via raw_scrapes: Argentina,
-- Hong Kong, Poland, and Turkey have ZERO scrape attempts ever recorded (the
-- FK on data_source_id has been silently blocking every cron run since these
-- scrapers were deployed). Israel's row was also missing (its scraper exists
-- and is registered in run_all_scrapers.py but isn't cron-scheduled yet).
--
-- Text is copied verbatim from 010_new_country_scrapers.sql — same UUIDs, same
-- notes — this is a re-application, not a new source definition.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight,
    is_active, notes
) VALUES
-- HK: Hong Kong Drug Office
(
    '10000000-0000-0000-0000-000000000045',
    'Hong Kong Department of Health — Drug Office',
    'HKDH',
    'Hong Kong', 'HK', 'Asia Pacific',
    'https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/home.html',
    NULL,
    24, 0.80,
    true,
    'HKDH Drug Office shortage circulars. HTML + PDF circulars. English language.'
),
-- IL: Israel MOH
(
    '10000000-0000-0000-0000-000000000046',
    'Israel Ministry of Health — Drug Registry',
    'IL MOH',
    'Israel', 'IL', 'Middle East',
    'https://israeldrugs.health.gov.il/',
    NULL,
    24, 0.82,
    true,
    'Israel MOH drug shortage registry. Hebrew + Latin INN. JS-rendered pages.'
),
-- PL: Poland MZ
(
    '10000000-0000-0000-0000-000000000049',
    'Ministry of Health Poland — Threatened Drug Availability List',
    'PL MZ',
    'Poland', 'PL', 'Europe',
    'https://www.gov.pl/web/zdrowie/lista-lekow-zagrozonych-brakiem-dostepnosci',
    NULL,
    24, 0.83,
    true,
    'Polish Ministry of Health drug shortage list. Polish language, INN in Latin.'
),
-- AR: Argentina ANMAT
(
    '10000000-0000-0000-0000-000000000051',
    'ANMAT — Alertas de Medicamentos',
    'ANMAT',
    'Argentina', 'AR', 'Latin America',
    'https://www.argentina.gob.ar/anmat/alertas',
    NULL,
    48, 0.72,
    true,
    'ANMAT Argentina drug alerts. Spanish language. Includes shortages, withdrawals, suspensions.'
),
-- TR: Turkey TITCK
(
    '10000000-0000-0000-0000-000000000054',
    'TITCK — Turkish Medicines and Medical Devices Agency',
    'TITCK',
    'Turkey', 'TR', 'Europe',
    'https://www.titck.gov.tr/',
    NULL,
    48, 0.76,
    true,
    'TITCK Turkey drug shortage notifications. Turkish language.'
)
ON CONFLICT (id) DO NOTHING;
