-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 055 — Pricing ingestion: extend drug_pricing_history + seed sources
--
-- Turns drug_pricing_history (024) into the landing table for official
-- medicine-price connectors (NHS Drug Tariff, CMS NADAC, …). Adds product
-- identifiers so prices can be joined to external registries (NDC, VMPP
-- SNOMED, DIN, CIP-13), widens the price_type vocabulary to cover the
-- standard official price points, and adds a deterministic dedup hash so
-- connector re-runs are idempotent (same pattern as shortage_events MD5).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New columns ──────────────────────────────────────────────────────────

ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS identifier_type TEXT;     -- 'NDC' | 'VMPP_SNOMED' | 'DIN' | 'CIP13' | …
ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS identifier_value TEXT;
ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS inn TEXT;                 -- resolved INN / molecule name
ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS strength TEXT;
ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS dosage_form TEXT;
ALTER TABLE drug_pricing_history
    ADD COLUMN IF NOT EXISTS dedup_hash TEXT;          -- md5(country|source|price_type|product|pack|date|price)

COMMENT ON COLUMN drug_pricing_history.identifier_type  IS 'Type of the national product identifier (NDC, VMPP_SNOMED, DIN, CIP13, ...).';
COMMENT ON COLUMN drug_pricing_history.dedup_hash       IS 'Deterministic md5 over (country|source|price_type|identifier-or-product|pack|effective_date|price). Unique → connector re-runs are idempotent.';

-- ── 2. Widen price_type vocabulary ──────────────────────────────────────────
-- Original CHECK (024): tariff, concession, list, wac, amp, reimbursement,
-- tender, other. Add the official price-point taxonomy used by the pricing
-- connectors (ex-factory, wholesale, pharmacy purchase, public retail,
-- drug tariff, reference price, unknown-official).

ALTER TABLE drug_pricing_history
    DROP CONSTRAINT IF EXISTS drug_pricing_history_price_type_check;
ALTER TABLE drug_pricing_history
    ADD CONSTRAINT drug_pricing_history_price_type_check CHECK (price_type IN (
        'tariff', 'concession', 'list', 'wac', 'amp', 'reimbursement', 'tender', 'other',
        'ex_factory', 'wholesale', 'pharmacy_purchase', 'retail_public',
        'drug_tariff', 'reference_price', 'unknown_official'
    ));

-- ── 3. Indexes ──────────────────────────────────────────────────────────────
-- NOTE: full (not partial) unique index — PostgREST upsert on_conflict cannot
-- target a partial unique index (42P10, see eligibility scraper post-mortem).
-- NULL dedup_hash rows (pre-055 data) are unaffected: NULLs never conflict.

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_dedup_hash
    ON drug_pricing_history (dedup_hash);

CREATE INDEX IF NOT EXISTS idx_pricing_identifier
    ON drug_pricing_history (identifier_type, identifier_value)
    WHERE identifier_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_inn
    ON drug_pricing_history (inn)
    WHERE inn IS NOT NULL;

-- ── 4. Seed data_sources rows for the first two pricing connectors ──────────
-- 090 was referenced by the (never-wired) NHS tariff scraper but never seeded.

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, is_active, notes
) VALUES
(
    '10000000-0000-0000-0000-000000000090',
    'NHS Drug Tariff + Price Concessions',
    'NHS-DT',
    'United Kingdom', 'GB', 'Europe',
    'https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/drug-tariff',
    NULL,
    168,  -- weekly: monthly tariff + mid-month concession announcements
    0.95,
    TRUE,
    'Official GB reimbursement prices (Part VIIIA / Category M) + price concessions. Concessions are a leading indicator of GB shortages.'
),
(
    '10000000-0000-0000-0000-000000000100',  -- pricing sources: 100+ block
    'CMS NADAC (National Average Drug Acquisition Cost)',
    'NADAC',
    'United States', 'US', 'Americas',
    'https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704',
    'https://data.medicaid.gov/api/1/datastore/query/',
    168,  -- CMS refreshes NADAC weekly (Wednesdays)
    0.95,
    TRUE,
    'US pharmacy invoice-based acquisition cost per NDC, published weekly by CMS. price_type=pharmacy_purchase.'
)
ON CONFLICT (id) DO NOTHING;
