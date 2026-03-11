-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 — SFDA/ASHP data sources + new shortage_events columns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New columns on shortage_events ──────────────────────────────────────

-- JSONB array of ISO country codes affected (primarily for EMA multi-country)
ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS affected_countries JSONB;

-- JSONB array of alternative drug info (primarily for ASHP supplement data)
-- Schema: [{"generic_name": "...", "ndc": "...", "notes": "..."}]
ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS available_alternatives JSONB;

-- Confidence score 0-100 for data quality of this specific event
-- NULL means "use default from data_source reliability_weight"
ALTER TABLE shortage_events
    ADD COLUMN IF NOT EXISTS source_confidence_score INTEGER
        CHECK (source_confidence_score IS NULL
               OR (source_confidence_score >= 0 AND source_confidence_score <= 100));

-- GIN index on affected_countries for containment queries
-- e.g. WHERE affected_countries @> '["DE"]'
CREATE INDEX IF NOT EXISTS idx_shortage_events_affected_countries
    ON shortage_events USING GIN (affected_countries)
    WHERE affected_countries IS NOT NULL;

-- ── 2. New data_sources rows ──────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight,
    is_active, notes
) VALUES
(
    '10000000-0000-0000-0000-000000000043',
    'Saudi Food and Drug Authority — Drug Shortage List',
    'SFDA',
    'Saudi Arabia', 'SA', 'Middle East',
    'https://www.sfda.gov.sa/en/currentlyInShortageList',
    NULL,
    24, 0.75,
    true,
    'SFDA Saudi Arabia. Self-reported shortage data from pharmaceutical agents. English-language source.'
),
(
    '10000000-0000-0000-0000-000000000044',
    'ASHP Drug Shortages Database (US Supplement)',
    'ASHP',
    'United States', 'US', 'Americas',
    'https://www.ashp.org/drug-shortages/current-shortages/drug-shortages-list',
    NULL,
    12, 0.95,
    false,
    'ASHP / University of Utah Drug Shortages Database. Licensed API — requires ASHP_API_KEY. Supplements FDA data with alternatives and clinical context. Copyright: University of Utah Drug Information Service.'
)
ON CONFLICT (id) DO UPDATE SET
    name               = EXCLUDED.name,
    abbreviation       = EXCLUDED.abbreviation,
    source_url         = EXCLUDED.source_url,
    api_endpoint       = EXCLUDED.api_endpoint,
    scrape_frequency_hours = EXCLUDED.scrape_frequency_hours,
    reliability_weight = EXCLUDED.reliability_weight,
    is_active          = EXCLUDED.is_active,
    notes              = EXCLUDED.notes;
