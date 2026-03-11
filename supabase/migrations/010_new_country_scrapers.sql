-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 — New columns + 12 new data sources for expanded country coverage
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New columns on shortage_events ──────────────────────────────────────

ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS world_region VARCHAR(50);

ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS source_tier INTEGER
        CHECK (source_tier IS NULL OR source_tier IN (1, 2, 3));

ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS is_upstream_signal BOOLEAN DEFAULT FALSE;

-- Index for filtering upstream signals out of main UI
CREATE INDEX IF NOT EXISTS idx_shortage_events_upstream
    ON shortage_events (is_upstream_signal)
    WHERE is_upstream_signal = TRUE;

-- Index for world_region queries
CREATE INDEX IF NOT EXISTS idx_shortage_events_world_region
    ON shortage_events (world_region)
    WHERE world_region IS NOT NULL;

-- ── 2. New data_sources rows ──────────────────────────────────────────────

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
-- BE: Belgium FAMHP
(
    '10000000-0000-0000-0000-000000000047',
    'Federal Agency for Medicines and Health Products — Supply Problems',
    'FAMHP',
    'Belgium', 'BE', 'Europe',
    'https://www.famhp.be/en/human_use/medicines/medicines/supply_problems',
    NULL,
    12, 0.87,
    true,
    'FAMHP Belgium. Supply problem notifications. EN/FR/NL multilingual.'
),
-- PT: Portugal INFARMED
(
    '10000000-0000-0000-0000-000000000048',
    'INFARMED — Gestão de Descontinuações e Rupturas',
    'INFARMED',
    'Portugal', 'PT', 'Europe',
    'https://www.infarmed.pt/web/infarmed/entidades/medicamentos-de-uso-humano/monitorizacao-do-mercado/gestao-de-descontinuacoes-e-rupturas',
    NULL,
    12, 0.86,
    true,
    'INFARMED Portugal shortage and discontinuation management. Portuguese language.'
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
-- GR: Greece EOF
(
    '10000000-0000-0000-0000-000000000050',
    'National Organisation for Medicines — Drug Shortages',
    'EOF',
    'Greece', 'GR', 'Europe',
    'https://www.eof.gr/',
    NULL,
    24, 0.82,
    true,
    'EOF Greece shortage notifications. Greek language, INN in Latin script.'
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
-- IN: India CDSCO (upstream signal)
(
    '10000000-0000-0000-0000-000000000052',
    'CDSCO — Not of Standard Quality Drug Alerts',
    'CDSCO',
    'India', 'IN', 'Asia Pacific',
    'https://cdsco.gov.in/opencms/opencms/en/Notifications/nsq-drugs/',
    NULL,
    168, 0.75,
    true,
    'India CDSCO NSQ monthly alerts. UPSTREAM SIGNAL — feeds prediction engine, not shortage list. India produces ~20% of global generics.'
),
-- CN: China NMPA (upstream signal)
(
    '10000000-0000-0000-0000-000000000053',
    'NMPA — API Manufacturer Suspension Notices',
    'NMPA',
    'China', 'CN', 'Asia Pacific',
    'https://english.nmpa.gov.cn/',
    NULL,
    168, 0.65,
    true,
    'China NMPA API facility suspension signals. UPSTREAM SIGNAL — feeds prediction engine. China produces ~80% of global API supply.'
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
),
-- AE: UAE MOHAP
(
    '10000000-0000-0000-0000-000000000055',
    'Ministry of Health and Prevention UAE — Drug Shortage Notifications',
    'MOHAP',
    'United Arab Emirates', 'AE', 'Middle East',
    'https://www.mohap.gov.ae/',
    NULL,
    48, 0.73,
    true,
    'UAE MOHAP drug shortage notifications. English/Arabic bilingual.'
),
-- MY: Malaysia NPRA
(
    '10000000-0000-0000-0000-000000000056',
    'National Pharmaceutical Regulatory Agency — Product Availability',
    'NPRA',
    'Malaysia', 'MY', 'Asia Pacific',
    'https://www.npra.gov.my/',
    NULL,
    48, 0.76,
    true,
    'Malaysia NPRA drug availability notifications. Malay/English bilingual.'
)
ON CONFLICT (id) DO UPDATE SET
    name               = EXCLUDED.name,
    abbreviation       = EXCLUDED.abbreviation,
    country            = EXCLUDED.country,
    country_code       = EXCLUDED.country_code,
    region             = EXCLUDED.region,
    source_url         = EXCLUDED.source_url,
    api_endpoint       = EXCLUDED.api_endpoint,
    scrape_frequency_hours = EXCLUDED.scrape_frequency_hours,
    reliability_weight = EXCLUDED.reliability_weight,
    is_active          = EXCLUDED.is_active,
    notes              = EXCLUDED.notes;
