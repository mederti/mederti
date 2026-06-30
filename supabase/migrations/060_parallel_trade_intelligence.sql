-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 060 — Parallel Trade Intelligence
--
-- Stores parallel-import licences (national) and parallel-distribution notices
-- (EMA, centrally-authorised) and matches them to canonical Mederti drugs with
-- a confidence score.
--
-- DESIGN NOTE — deliberately only TWO new tables, not the five in the original
-- brief. The brief's parallel_trade_sources / parallel_trade_ingestion_runs /
-- parallel_trade_source_documents duplicate infrastructure we already have:
--   • source registry      → data_sources (one freshness dashboard, not two)
--   • ingestion run log     → raw_scrapes  (BaseScraper writes these already)
--   • raw source documents  → raw_scrapes.raw_data (+ per-row raw_data below)
-- Reusing them keeps a single audit trail and avoids schema drift.
--
-- The connectors (backend/scrapers/parallel_trade/*) extend ParallelTradeScraper
-- which extends BaseScraper, so raw_scrapes logging, content-hash dedup and the
-- data_sources.last_scraped_at heartbeat all come for free.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. parallel_trade_licences ──────────────────────────────────────────────
-- One row per licence / notice. licence_type separates the two regimes the
-- brief is careful to distinguish:
--   EMA_PARALLEL_DISTRIBUTION — centrally-authorised product, reshipped between
--                               EU/EEA member states (EMA notice).
--   NATIONAL_PARALLEL_IMPORT  — nationally-authorised product imported under a
--                               national authority's parallel-import licence.

CREATE TABLE IF NOT EXISTS parallel_trade_licences (
    id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_source_id                  UUID REFERENCES data_sources(id),

    licence_type                    TEXT NOT NULL CHECK (licence_type IN (
                                        'EMA_PARALLEL_DISTRIBUTION',
                                        'NATIONAL_PARALLEL_IMPORT'
                                    )),
    licence_number                  TEXT,            -- licence_number / notice_number
    status                          TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN (
                                        'active', 'dormant', 'cancelled',
                                        'withdrawn', 'expired', 'unknown'
                                    )),

    -- Product identity (as published by the source)
    product_name                    TEXT NOT NULL,
    brand_name                      TEXT,
    active_substance                TEXT,            -- active_substance / INN
    strength                        TEXT,
    dosage_form                     TEXT,
    route                           TEXT,
    pack_size                       TEXT,

    -- Parties
    licence_holder                  TEXT,            -- licence_holder / parallel_distributor
    marketing_authorisation_holder  TEXT,

    -- Trade route
    source_country                  CHAR(2),         -- export / origin member state
    destination_country             CHAR(2),         -- import / destination market

    -- Reference (the product the parallel item is based on in the destination)
    reference_product_name          TEXT,
    reference_ma_number             TEXT,

    -- Provenance
    source_authority                TEXT,            -- e.g. 'EMA', 'MHRA', 'BfArM', 'FAMHP'
    source_url                      TEXT,
    granted_date                    DATE,
    expiry_date                     DATE,
    last_checked                    TIMESTAMPTZ DEFAULT NOW(),

    raw_data                        JSONB,
    -- Deterministic md5 over (source|licence_type|licence_number|product|pack|
    -- source_country|destination_country) → connector re-runs are idempotent.
    dedup_hash                      TEXT,

    created_at                      TIMESTAMPTZ DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE parallel_trade_licences IS
    'Parallel-import licences (national) and EMA parallel-distribution notices, '
    'classified by licence_type. Populated by backend/scrapers/parallel_trade/*.';
COMMENT ON COLUMN parallel_trade_licences.dedup_hash IS
    'md5(source|licence_type|licence_number|product|pack|src_country|dest_country). Unique → idempotent re-runs.';
COMMENT ON COLUMN parallel_trade_licences.source_country IS
    'Member state the product is sourced/exported FROM (ISO 3166-1 alpha-2).';
COMMENT ON COLUMN parallel_trade_licences.destination_country IS
    'Market the product is imported/distributed INTO (ISO 3166-1 alpha-2).';

-- Full (not partial) unique index — PostgREST upsert on_conflict cannot target a
-- partial unique index (42P10, per the eligibility-scraper post-mortem). NULL
-- dedup_hash rows never conflict, so legacy/manual rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptl_dedup_hash
    ON parallel_trade_licences (dedup_hash);

CREATE INDEX IF NOT EXISTS idx_ptl_active_substance
    ON parallel_trade_licences (active_substance)
    WHERE active_substance IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ptl_licence_type      ON parallel_trade_licences (licence_type);
CREATE INDEX IF NOT EXISTS idx_ptl_destination       ON parallel_trade_licences (destination_country);
CREATE INDEX IF NOT EXISTS idx_ptl_source_country    ON parallel_trade_licences (source_country);
CREATE INDEX IF NOT EXISTS idx_ptl_data_source       ON parallel_trade_licences (data_source_id);


-- ── 2. product_parallel_trade_matches ────────────────────────────────────────
-- Join between canonical drugs and licences, with the confidence score. A
-- licence can match more than one drug only in pathological cases; a drug
-- routinely matches many licences. confidence < 0.65 ⇒ needs_review (the panel
-- demotes / warns on these rather than presenting them as fact).

CREATE TABLE IF NOT EXISTS product_parallel_trade_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_id         UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    licence_id      UUID NOT NULL REFERENCES parallel_trade_licences(id) ON DELETE CASCADE,

    confidence      NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    -- Which fields drove the score, e.g. ["inn","strength","dosage_form","pack_size"].
    match_basis     JSONB DEFAULT '[]'::jsonb,
    needs_review    BOOLEAN GENERATED ALWAYS AS (confidence < 0.65) STORED,
    review_state    TEXT NOT NULL DEFAULT 'auto' CHECK (review_state IN (
                        'auto', 'confirmed', 'rejected'
                    )),

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (drug_id, licence_id)
);

COMMENT ON TABLE product_parallel_trade_matches IS
    'drug ⇄ parallel-trade-licence matches with confidence (1.00 brand+INN+strength+form+pack+MA '
    '… 0.50 INN-only). needs_review is derived: confidence < 0.65. review_state lets a curator '
    'confirm/reject a low-confidence match without changing the computed score.';

CREATE INDEX IF NOT EXISTS idx_pptm_drug         ON product_parallel_trade_matches (drug_id);
CREATE INDEX IF NOT EXISTS idx_pptm_licence      ON product_parallel_trade_matches (licence_id);
CREATE INDEX IF NOT EXISTS idx_pptm_needs_review ON product_parallel_trade_matches (needs_review) WHERE needs_review;


-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- Consistent with migration 047 (anon PostgREST access revoked): no anon/auth
-- policies. Reads are served by Next.js route handlers using the service-role
-- key, which bypasses RLS. Connectors also use the service-role key. Enabling
-- RLS with no permissive policy = deny-by-default for anon/authenticated.

ALTER TABLE parallel_trade_licences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_parallel_trade_matches   ENABLE ROW LEVEL SECURITY;


-- ── 4. updated_at triggers ───────────────────────────────────────────────────
-- Reuse the existing set_updated_at() trigger function (defined in 001).

DROP TRIGGER IF EXISTS trg_ptl_updated_at ON parallel_trade_licences;
CREATE TRIGGER trg_ptl_updated_at
    BEFORE UPDATE ON parallel_trade_licences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pptm_updated_at ON product_parallel_trade_matches;
CREATE TRIGGER trg_pptm_updated_at
    BEFORE UPDATE ON product_parallel_trade_matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 5. Seed data_sources for the parallel-trade connectors ───────────────────
-- Parallel-trade source UUID block: 200+.
-- legality status is recorded in notes so the connector author and any future
-- agent can see at a glance which sources are cleared to ingest.
--   GREEN  = open reuse confirmed, build now
--   AMBER  = reuse OK but tech-hard (headless/token replay)
--   RED    = reuse NOT cleared — connector blocked pending legal sign-off

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, is_active, notes
) VALUES
(
    '10000000-0000-0000-0000-000000000200',
    'EMA Register of Parallel Distribution Notices',
    'EMA-PD',
    'European Union', 'EU', 'Europe',
    'https://iris.ema.europa.eu/registerpd/',
    NULL,
    168,  -- weekly; EMA issues ~2,500 notices/yr
    0.95,
    FALSE,  -- AMBER: legal-clear (EMA Legal Notice permits commercial reuse w/ attribution)
            -- but tech-hard: Dynamics-365 grid behind WAF, needs headless + token replay.
            -- Activate when ema_parallel_distribution connector is built & tested.
    'licence_type=EMA_PARALLEL_DISTRIBUTION. LEGAL: GREEN — EMA Legal Notice allows commercial reuse with attribution. '
    'TECH: AMBER — JS Dynamics 365 grid (iris.ema.europa.eu/registerpd), WAF, headless browser + anti-forgery token replay required. '
    'Fields: notice no. (EMEA/H/A/PDN/…), product, MAH, parallel distributor, repackager, origin+destination MS, status, date.'
),
(
    '10000000-0000-0000-0000-000000000201',
    'UK MHRA Parallel Import Licences (PLPI)',
    'MHRA-PLPI',
    'United Kingdom', 'GB', 'Europe',
    'https://www.gov.uk/government/collections/parallel-import-licences-lists-of-approved-products',
    NULL,
    336,  -- fortnightly grants lists
    0.90,
    FALSE,  -- RED: reuse NOT cleared. MHRA asserts Crown copyright + database right and charges
            -- commercial reuse fees (min £500 / 10% royalty). Do NOT ingest until legal sign-off.
    'licence_type=NATIONAL_PARALLEL_IMPORT. LEGAL: RED — Crown copyright + DB right; commercial reuse fees apply '
    '(copyright@mhra.gov.uk). BLOCKED pending legal sign-off. TECH: grants-only fortnightly PDFs on gov.uk (2014→), '
    'PDF table parsing; no consolidated live register, no source country / pack size in the lists.'
),
(
    '10000000-0000-0000-0000-000000000202',
    'Germany BfArM Parallelimport (AMIce / PharmNet.Bund)',
    'BfArM-PI',
    'Germany', 'DE', 'Europe',
    'https://portal.bfarm.de/amguifree/am/search.xhtml',
    NULL,
    168,
    0.92,
    FALSE,  -- RED: AMIce Nutzungsbedingungen forbid copying/distribution/resale ("max 25 copies,
            -- own use only"). "kostenfrei" ≠ open licence. BLOCKED pending written reuse clearance.
    'licence_type=NATIONAL_PARALLEL_IMPORT. LEGAL: RED — AMIce terms prohibit redistribution/resale. BLOCKED pending '
    'written clearance from BfArM. TECH: AMBER — JSF app, headless + CSV-of-results export. RICHEST data: per import '
    'records source country + foreign brand + foreign authorisation number linked to the German Zulassungsnummer.'
),
(
    '10000000-0000-0000-0000-000000000203',
    'Belgium FAMHP Parallel Import (SAM export)',
    'FAMHP-PI',
    'Belgium', 'BE', 'Europe',
    'https://www.vas.ehealth.fgov.be/websamcivics/samcivics/',
    'https://www.vas.ehealth.fgov.be/websamcivics/samcivics/',
    168,  -- SAM Full export refreshes multiple times daily; weekly pull is ample
    0.95,
    TRUE,   -- GREEN: open reuse (Belgian Royal Decree 2 Jun 2019 open-data default; SAM "open source").
            -- Clean structured XML, no auth. First connector to build & activate.
    'licence_type=NATIONAL_PARALLEL_IMPORT (Parallel Circuit=1) + EMA_PARALLEL_DISTRIBUTION (Parallel Circuit=2). '
    'LEGAL: GREEN — Belgian open-data default (Royal Decree 2019). TECH: GREEN — daily SAM v2 XML bulk export (XSD-validated), '
    'no auth. AMPP.ParallelCircuit flags import(1)/distribution(2); Parallel Distributor name on distribution packs.'
)
ON CONFLICT (id) DO UPDATE SET
    notes      = EXCLUDED.notes,
    is_active  = EXCLUDED.is_active,
    source_url = EXCLUDED.source_url;
