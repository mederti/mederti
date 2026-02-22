-- =============================================================================
-- Mederti — Global Pharmaceutical Shortage Intelligence Platform
-- Migration: 001_initial_schema.sql
-- =============================================================================

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- =============================================================================
-- UTILITY: updated_at trigger function
-- Applied to: drugs, shortage_events, manufacturers
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- =============================================================================
-- TABLE 1: drugs
-- Core drug registry with full-text search and trigram fuzzy matching.
-- =============================================================================

CREATE TABLE drugs (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    generic_name            TEXT NOT NULL,
    -- Normalised lowercase slug for exact lookups (e.g. "amoxicillin")
    -- Maintained by trg_drugs_search_vector (GENERATED ALWAYS AS is not supported
    -- on Supabase hosted PostgreSQL because lower/array_to_string are STABLE, not IMMUTABLE)
    generic_name_normalised TEXT,
    brand_names             TEXT[]  NOT NULL DEFAULT '{}',
    -- Flattened brand names for trigram indexing — also maintained by trigger
    brand_names_text        TEXT,
    atc_code                TEXT,                -- WHO ATC code, e.g. J01CA04
    atc_description         TEXT,
    drug_class              TEXT,
    dosage_forms            TEXT[]  NOT NULL DEFAULT '{}',   -- tablet, capsule, injection…
    strengths               TEXT[]  NOT NULL DEFAULT '{}',   -- ['500mg', '875/125mg']
    routes_of_administration TEXT[] NOT NULL DEFAULT '{}',  -- oral, IV, inhaled…
    therapeutic_category    TEXT,
    is_controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
    controlled_substance_schedule TEXT,          -- Schedule II, Class A, S8, etc.
    -- Full-text search vector (A=generic, B=brand, C=ATC+category)
    search_vector           TSVECTOR,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  drugs IS 'Master drug registry. One row per unique generic compound.';
COMMENT ON COLUMN drugs.atc_code IS 'WHO Anatomical Therapeutic Chemical classification code.';
COMMENT ON COLUMN drugs.search_vector IS 'Weighted tsvector: A=generic_name, B=brand_names, C=atc/category.';

-- Trigram indexes for fuzzy name matching (pharmacist typo tolerance)
CREATE INDEX idx_drugs_generic_trgm
    ON drugs USING GIN (generic_name_normalised gin_trgm_ops);

CREATE INDEX idx_drugs_brand_trgm
    ON drugs USING GIN (brand_names_text gin_trgm_ops);

-- GIN index for full-text search
CREATE INDEX idx_drugs_search_vector
    ON drugs USING GIN (search_vector);

-- Array containment index for brand_names exact lookups
CREATE INDEX idx_drugs_brand_names_arr
    ON drugs USING GIN (brand_names);

-- Standard B-tree
CREATE INDEX idx_drugs_atc_code
    ON drugs (atc_code) WHERE atc_code IS NOT NULL;

CREATE INDEX idx_drugs_therapeutic_category
    ON drugs (therapeutic_category) WHERE therapeutic_category IS NOT NULL;


-- Trigger: maintain search_vector + the two normalised lookup columns.
-- Runs BEFORE INSERT OR UPDATE so the values are always consistent.
CREATE OR REPLACE FUNCTION update_drug_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Computed lookup columns (replaces GENERATED ALWAYS AS which requires IMMUTABLE)
    NEW.generic_name_normalised := lower(trim(NEW.generic_name));
    NEW.brand_names_text        := array_to_string(NEW.brand_names, ' ');

    -- Weighted full-text search vector
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.generic_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.brand_names, ' '), '')), 'B') ||
        setweight(to_tsvector('english',
            COALESCE(NEW.atc_code, '') || ' ' ||
            COALESCE(NEW.atc_description, '') || ' ' ||
            COALESCE(NEW.therapeutic_category, '')
        ), 'C');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_drugs_search_vector
    BEFORE INSERT OR UPDATE ON drugs
    FOR EACH ROW EXECUTE FUNCTION update_drug_search_vector();

CREATE TRIGGER trg_drugs_updated_at
    BEFORE UPDATE ON drugs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- TABLE 2: manufacturers
-- Pharmaceutical manufacturers and marketing authorisation holders.
-- =============================================================================

CREATE TABLE manufacturers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT    NOT NULL,
    country         TEXT    NOT NULL,
    country_code    CHAR(2) NOT NULL,
    website         TEXT,
    contact_email   TEXT,
    regulatory_id   TEXT,   -- e.g. FDA establishment registration number
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE manufacturers IS 'Pharmaceutical manufacturers and MAHs (Marketing Authorisation Holders).';

CREATE INDEX idx_manufacturers_country_code ON manufacturers (country_code);
CREATE INDEX idx_manufacturers_name_trgm ON manufacturers USING GIN (name gin_trgm_ops);

CREATE TRIGGER trg_manufacturers_updated_at
    BEFORE UPDATE ON manufacturers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- TABLE 3: data_sources
-- Regulatory bodies and official shortage registries.
-- Pre-seeded at the bottom of this file with 20 sources.
-- =============================================================================

CREATE TABLE data_sources (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    TEXT    NOT NULL UNIQUE,
    abbreviation            TEXT    NOT NULL,
    country                 TEXT    NOT NULL,
    country_code            CHAR(2) NOT NULL,
    region                  TEXT,               -- 'EU', 'Americas', 'Asia-Pacific', 'Global'
    source_url              TEXT    NOT NULL,
    api_endpoint            TEXT,               -- machine-readable endpoint if available
    scrape_frequency_hours  INTEGER NOT NULL DEFAULT 24,
    -- 0.0–1.0: higher = more authoritative / reliable
    reliability_weight      NUMERIC(3,2) NOT NULL DEFAULT 0.80
        CHECK (reliability_weight BETWEEN 0 AND 1),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    last_scraped_at         TIMESTAMPTZ,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  data_sources IS 'Official regulatory bodies whose shortage feeds are scraped.';
COMMENT ON COLUMN data_sources.reliability_weight IS '0.0–1.0 weight used when reconciling conflicting shortage signals.';

CREATE INDEX idx_data_sources_country_code ON data_sources (country_code);
CREATE INDEX idx_data_sources_region ON data_sources (region);


-- =============================================================================
-- TABLE 4: shortage_events
-- One row per confirmed shortage signal, deduplicated by shortage_id.
-- shortage_id is a deterministic MD5 hash of (drug_id, data_source_id,
-- country_code/country, start_date) to prevent duplicate inserts from
-- repeated scrapes.
-- =============================================================================

CREATE TABLE shortage_events (
    id                       UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Deterministic deduplication key — set by trigger below
    shortage_id              TEXT    NOT NULL UNIQUE,
    drug_id                  UUID    NOT NULL REFERENCES drugs(id)        ON DELETE RESTRICT,
    manufacturer_id          UUID             REFERENCES manufacturers(id) ON DELETE SET NULL,
    data_source_id           UUID    NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
    country                  TEXT    NOT NULL,
    country_code             CHAR(2),
    status                   TEXT    NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'resolved', 'anticipated', 'stale')),
    severity                 TEXT
        CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    -- Human-readable reason and categorised reason for analytics
    reason                   TEXT,
    reason_category          TEXT
        CHECK (reason_category IN (
            'manufacturing_issue', 'supply_chain', 'demand_surge',
            'regulatory_action', 'discontinuation', 'raw_material',
            'distribution', 'other', 'unknown'
        )),
    start_date               DATE    NOT NULL,
    end_date                 DATE,
    estimated_resolution_date DATE,
    last_verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_url               TEXT,
    raw_data                 JSONB,
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE  shortage_events IS 'Deduplicated shortage signals aggregated from all data_sources.';
COMMENT ON COLUMN shortage_events.shortage_id IS 'MD5(drug_id|data_source_id|country|start_date) — set by trigger.';
COMMENT ON COLUMN shortage_events.last_verified_at IS 'Timestamp of the most recent scrape that confirmed this shortage. Used by mark_stale_shortages().';

CREATE INDEX idx_shortage_events_drug_id       ON shortage_events (drug_id);
CREATE INDEX idx_shortage_events_manufacturer   ON shortage_events (manufacturer_id) WHERE manufacturer_id IS NOT NULL;
CREATE INDEX idx_shortage_events_data_source    ON shortage_events (data_source_id);
CREATE INDEX idx_shortage_events_country_code   ON shortage_events (country_code);
CREATE INDEX idx_shortage_events_status         ON shortage_events (status);
CREATE INDEX idx_shortage_events_severity       ON shortage_events (severity) WHERE severity IS NOT NULL;
CREATE INDEX idx_shortage_events_start_date     ON shortage_events (start_date DESC);
CREATE INDEX idx_shortage_events_last_verified  ON shortage_events (last_verified_at);
-- Composite: active shortages by drug — the hottest query path
CREATE INDEX idx_shortage_events_drug_active
    ON shortage_events (drug_id, status)
    WHERE status IN ('active', 'anticipated');


-- Deterministic shortage_id generator
CREATE OR REPLACE FUNCTION set_shortage_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only compute if not already supplied (allows manual override in tests)
    IF NEW.shortage_id IS NULL OR NEW.shortage_id = '' THEN
        NEW.shortage_id := md5(
            COALESCE(NEW.drug_id::TEXT,        '') || '|' ||
            COALESCE(NEW.data_source_id::TEXT,  '') || '|' ||
            COALESCE(NEW.country_code, NEW.country, '') || '|' ||
            COALESCE(NEW.start_date::TEXT,      '')
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shortage_events_id
    BEFORE INSERT ON shortage_events
    FOR EACH ROW EXECUTE FUNCTION set_shortage_id();

CREATE TRIGGER trg_shortage_events_updated_at
    BEFORE UPDATE ON shortage_events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- TABLE 5: drug_alternatives
-- Therapeutic and pharmacological alternatives for a drug in shortage.
-- =============================================================================

CREATE TABLE drug_alternatives (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_id                 UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    alternative_drug_id     UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    relationship_type       TEXT NOT NULL
        CHECK (relationship_type IN (
            'therapeutic_equivalent', 'pharmacological_alternative',
            'biosimilar', 'generic', 'therapeutic_class_alternative'
        )),
    -- Free-text dosing guidance when conversion is not 1:1
    dose_conversion_notes   TEXT,
    -- Evidence grading: A=RCT/meta-analysis, B=observational, C=case series,
    --                   D=expert opinion/guideline, E=theoretical
    clinical_evidence_level TEXT
        CHECK (clinical_evidence_level IN ('A', 'B', 'C', 'D', 'E')),
    requires_monitoring     BOOLEAN NOT NULL DEFAULT FALSE,
    monitoring_notes        TEXT,
    -- Supabase Auth user who created / verified this mapping
    created_by              UUID,
    verified_by             TEXT,           -- pharmacist name or credential
    is_approved             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_no_self_alternative CHECK (drug_id <> alternative_drug_id),
    CONSTRAINT uq_drug_alternative UNIQUE (drug_id, alternative_drug_id)
);

COMMENT ON TABLE  drug_alternatives IS 'Clinical alternative mappings between drugs, with evidence grading.';
COMMENT ON COLUMN drug_alternatives.clinical_evidence_level IS 'A=RCT, B=Observational, C=Case series, D=Expert opinion, E=Theoretical.';

CREATE INDEX idx_drug_alternatives_drug_id ON drug_alternatives (drug_id);
CREATE INDEX idx_drug_alternatives_alt_id  ON drug_alternatives (alternative_drug_id);


-- =============================================================================
-- TABLE 6: drug_pricing
-- Historical and current pricing by country.
-- =============================================================================

CREATE TABLE drug_pricing (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_id         UUID    NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    country         TEXT    NOT NULL,
    country_code    CHAR(2) NOT NULL,
    price_amount    NUMERIC(14,4),
    currency        CHAR(3),                -- ISO 4217, e.g. USD, EUR, AUD
    price_per       TEXT    NOT NULL DEFAULT 'unit'
        CHECK (price_per IN ('unit', 'pack', 'vial', 'course', 'gram', 'ml')),
    pack_size       TEXT,                   -- e.g. '30 tablets', '10 x 1ml vials'
    price_date      DATE    NOT NULL,
    source          TEXT,
    -- Direction of price movement vs previous observation
    trend_indicator TEXT
        CHECK (trend_indicator IN ('rising', 'stable', 'falling', 'volatile', 'unavailable')),
    -- Percentage change vs prior price_amount for this drug/country
    trend_percentage NUMERIC(8,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  drug_pricing IS 'Point-in-time pricing snapshots per drug per country.';
COMMENT ON COLUMN drug_pricing.trend_indicator IS 'Direction of price movement vs previous observation for this drug/country.';

CREATE INDEX idx_drug_pricing_drug_id     ON drug_pricing (drug_id);
CREATE INDEX idx_drug_pricing_country     ON drug_pricing (country_code);
CREATE INDEX idx_drug_pricing_date        ON drug_pricing (price_date DESC);
CREATE INDEX idx_drug_pricing_drug_country ON drug_pricing (drug_id, country_code, price_date DESC);


-- =============================================================================
-- TABLE 7: user_watchlists
-- Per-user drug watches with per-channel notification preferences.
-- =============================================================================

CREATE TABLE user_watchlists (
    id                   UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- References Supabase Auth users
    user_id              UUID    NOT NULL,
    drug_id              UUID    NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    -- Empty array = watch all countries
    countries            TEXT[]  NOT NULL DEFAULT '{}',
    -- Schema: { "email": bool, "sms": bool, "webhook": "https://..." | null }
    notification_channels JSONB  NOT NULL DEFAULT '{"email": true, "sms": false, "webhook": null}',
    alert_threshold      TEXT    NOT NULL DEFAULT 'any'
        CHECK (alert_threshold IN ('any', 'active_only', 'critical_only')),
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_watchlist UNIQUE (user_id, drug_id)
);

COMMENT ON TABLE  user_watchlists IS 'User drug-watch subscriptions with per-channel notification config.';
COMMENT ON COLUMN user_watchlists.notification_channels IS 'JSONB: {email: bool, sms: bool, webhook: url|null}.';

CREATE INDEX idx_user_watchlists_user_id  ON user_watchlists (user_id);
CREATE INDEX idx_user_watchlists_drug_id  ON user_watchlists (drug_id);
CREATE INDEX idx_user_watchlists_active   ON user_watchlists (user_id) WHERE is_active = TRUE;


-- =============================================================================
-- TABLE 8: audit_logs
-- Immutable append-only log of data mutations.
-- =============================================================================

CREATE TABLE audit_logs (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name      TEXT    NOT NULL,
    record_id       UUID    NOT NULL,
    action          TEXT    NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data        JSONB,
    new_data        JSONB,
    changed_by      UUID,                   -- auth.uid()
    changed_by_role TEXT,                   -- 'user', 'admin', 'system', 'scraper'
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all data mutations. Never UPDATE or DELETE rows here.';

CREATE INDEX idx_audit_logs_table_record  ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_created_at    ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_changed_by    ON audit_logs (changed_by) WHERE changed_by IS NOT NULL;


-- =============================================================================
-- TABLE 9: raw_scrapes
-- Raw scraper output stored before normalisation pipeline runs.
-- =============================================================================

CREATE TABLE raw_scrapes (
    id                      UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_source_id          UUID    NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
    scraped_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One of: raw HTML, JSON body, CSV text
    raw_content             TEXT,
    raw_data                JSONB,
    -- MD5 of raw_content/raw_data to detect unchanged pages
    content_hash            TEXT,
    status                  TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'duplicate')),
    error_message           TEXT,
    records_found           INTEGER,
    records_processed       INTEGER,
    processing_started_at   TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    scraper_version         TEXT    -- semver of the scraper that produced this row
);

COMMENT ON TABLE  raw_scrapes IS 'Raw scraper output. Processed rows create/update shortage_events.';
COMMENT ON COLUMN raw_scrapes.content_hash IS 'MD5 of the raw payload; duplicate hash means no change since last scrape.';

CREATE INDEX idx_raw_scrapes_data_source  ON raw_scrapes (data_source_id);
CREATE INDEX idx_raw_scrapes_status       ON raw_scrapes (status) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_raw_scrapes_scraped_at   ON raw_scrapes (scraped_at DESC);
CREATE INDEX idx_raw_scrapes_content_hash ON raw_scrapes (content_hash) WHERE content_hash IS NOT NULL;


-- =============================================================================
-- TABLE 10: alert_notifications
-- Tracks every email/SMS/webhook dispatch attempt.
-- =============================================================================

CREATE TABLE alert_notifications (
    id                  UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    watchlist_id        UUID    NOT NULL REFERENCES user_watchlists(id)  ON DELETE CASCADE,
    shortage_event_id   UUID    NOT NULL REFERENCES shortage_events(id)  ON DELETE CASCADE,
    channel             TEXT    NOT NULL CHECK (channel IN ('email', 'sms', 'webhook')),
    -- email address, phone number, or webhook URL
    recipient           TEXT    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
    sent_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    error_message       TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    -- Full payload sent to the channel provider (for debugging)
    payload             JSONB,
    -- External message ID from provider (SendGrid, Twilio, etc.)
    provider_message_id TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE alert_notifications IS 'Dispatch ledger for every alert attempt across all channels.';

CREATE INDEX idx_alert_notifications_watchlist  ON alert_notifications (watchlist_id);
CREATE INDEX idx_alert_notifications_shortage   ON alert_notifications (shortage_event_id);
CREATE INDEX idx_alert_notifications_status     ON alert_notifications (status) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_alert_notifications_created_at ON alert_notifications (created_at DESC);


-- =============================================================================
-- UTILITY FUNCTION: mark_stale_shortages()
-- Call on a cron schedule (e.g. daily). Marks any shortage that has not been
-- re-confirmed by a scraper in the last 7 days as 'stale'.
-- Returns the number of rows updated.
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_stale_shortages()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE shortage_events
    SET
        status     = 'stale',
        updated_at = NOW()
    WHERE
        status          IN ('active', 'anticipated')
        AND last_verified_at < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Write an audit entry for the batch operation
    IF v_count > 0 THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_data, changed_by_role)
        SELECT
            'shortage_events',
            id,
            'UPDATE',
            jsonb_build_object(
                'status',          'stale',
                'reason',          'auto_staleness_check',
                'last_verified_at', last_verified_at
            ),
            'system'
        FROM shortage_events
        WHERE status = 'stale'
          AND updated_at >= NOW() - INTERVAL '5 seconds';
    END IF;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION mark_stale_shortages() IS
    'Marks active/anticipated shortage_events as stale if last_verified_at > 7 days ago. Returns row count. Run daily via pg_cron or Supabase Edge Function scheduler.';


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE drugs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shortage_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_alternatives    ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_pricing         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_scrapes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_notifications  ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- drugs — public read; only service_role may mutate
-- ---------------------------------------------------------------------------
CREATE POLICY "drugs: public read"
    ON drugs FOR SELECT
    USING (true);

CREATE POLICY "drugs: service_role full access"
    ON drugs FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- manufacturers — public read; only service_role may mutate
-- ---------------------------------------------------------------------------
CREATE POLICY "manufacturers: public read"
    ON manufacturers FOR SELECT
    USING (true);

CREATE POLICY "manufacturers: service_role full access"
    ON manufacturers FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- data_sources — public read; only service_role may mutate
-- ---------------------------------------------------------------------------
CREATE POLICY "data_sources: public read"
    ON data_sources FOR SELECT
    USING (true);

CREATE POLICY "data_sources: service_role full access"
    ON data_sources FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- shortage_events — public read; only service_role may mutate
-- ---------------------------------------------------------------------------
CREATE POLICY "shortage_events: public read"
    ON shortage_events FOR SELECT
    USING (true);

CREATE POLICY "shortage_events: service_role full access"
    ON shortage_events FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- drug_alternatives — public read; authenticated users may suggest; service_role approves
-- ---------------------------------------------------------------------------
CREATE POLICY "drug_alternatives: public read"
    ON drug_alternatives FOR SELECT
    USING (is_approved = true OR auth.role() = 'service_role');

CREATE POLICY "drug_alternatives: authenticated users can suggest"
    ON drug_alternatives FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "drug_alternatives: service_role full access"
    ON drug_alternatives FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- drug_pricing — public read; only service_role may mutate
-- ---------------------------------------------------------------------------
CREATE POLICY "drug_pricing: public read"
    ON drug_pricing FOR SELECT
    USING (true);

CREATE POLICY "drug_pricing: service_role full access"
    ON drug_pricing FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- user_watchlists — users own their own rows; service_role sees all
-- ---------------------------------------------------------------------------
CREATE POLICY "user_watchlists: users manage own rows"
    ON user_watchlists FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_watchlists: service_role full access"
    ON user_watchlists FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- audit_logs — no direct user access; service_role only
-- ---------------------------------------------------------------------------
CREATE POLICY "audit_logs: service_role only"
    ON audit_logs FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- raw_scrapes — no direct user access; service_role only
-- ---------------------------------------------------------------------------
CREATE POLICY "raw_scrapes: service_role only"
    ON raw_scrapes FOR ALL
    USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- alert_notifications — users see notifications for their watchlists
-- ---------------------------------------------------------------------------
CREATE POLICY "alert_notifications: users see own"
    ON alert_notifications FOR SELECT
    USING (
        watchlist_id IN (
            SELECT id FROM user_watchlists WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "alert_notifications: service_role full access"
    ON alert_notifications FOR ALL
    USING (auth.role() = 'service_role');


-- =============================================================================
-- SEED: data_sources — 20 global regulatory bodies
-- UUIDs prefixed 10000000-0000-0000-0000-0000000000XX for readability.
-- =============================================================================

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, notes
) VALUES

-- ── Americas ────────────────────────────────────────────────────────────────
(
    '10000000-0000-0000-0000-000000000001',
    'U.S. Food and Drug Administration — Drug Shortages',
    'FDA',
    'United States', 'US', 'Americas',
    'https://www.accessdata.fda.gov/scripts/drugshortages/',
    'https://api.fda.gov/drug/shortages.json',
    6, 0.98,
    'Primary US source. Machine-readable API available via openFDA.'
),
(
    '10000000-0000-0000-0000-000000000002',
    'Health Canada — Drug Shortages Database',
    'HC',
    'Canada', 'CA', 'Americas',
    'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-shortages.html',
    'https://health-products.canada.ca/api/drug-shortages/',
    12, 0.95,
    'Mandatory reporting since 2017. Covers human prescription drugs.'
),

-- ── Oceania ─────────────────────────────────────────────────────────────────
(
    '10000000-0000-0000-0000-000000000003',
    'Therapeutic Goods Administration — Medicine Shortages',
    'TGA',
    'Australia', 'AU', 'Asia-Pacific',
    'https://www.tga.gov.au/resources/resource/shortages-and-discontinuations',
    NULL,
    12, 0.95,
    'Mandatory reporting since 2019. Covers prescription and OTC medicines.'
),
(
    '10000000-0000-0000-0000-000000000004',
    'Medsafe — New Zealand Medicine Shortages',
    'Medsafe',
    'New Zealand', 'NZ', 'Asia-Pacific',
    'https://www.medsafe.govt.nz/medicines/Shortages/medshortageslist.asp',
    NULL,
    24, 0.88,
    'Voluntary reporting scheme administered by the NZ Ministry of Health.'
),

-- ── Europe — Supranational ───────────────────────────────────────────────────
(
    '10000000-0000-0000-0000-000000000005',
    'European Medicines Agency — Medicines Shortages',
    'EMA',
    'European Union', 'EU', 'EU',
    'https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/availability-medicines/shortages-medicines',
    NULL,
    24, 0.96,
    'EU-wide coordination, especially for critical medicines shortages.'
),

-- ── Europe — UK ──────────────────────────────────────────────────────────────
(
    '10000000-0000-0000-0000-000000000006',
    'Medicines and Healthcare products Regulatory Agency — Drug Alerts',
    'MHRA',
    'United Kingdom', 'GB', 'Europe',
    'https://www.gov.uk/drug-device-alerts?issued_date%5Bfrom%5D=&issued_date%5Bto%5D=&search_type=drug-shortage',
    NULL,
    12, 0.95,
    'Post-Brexit independent UK authority. Covers Great Britain and Northern Ireland.'
),

-- ── Europe — National Authorities ────────────────────────────────────────────
(
    '10000000-0000-0000-0000-000000000007',
    'Agence nationale de sécurité du médicament — Disponibilité',
    'ANSM',
    'France', 'FR', 'EU',
    'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments',
    NULL,
    24, 0.92,
    'French national medicines agency. Publishes ruptures de stock reports.'
),
(
    '10000000-0000-0000-0000-000000000008',
    'Bundesinstitut für Arzneimittel und Medizinprodukte — Lieferengpässe',
    'BfArM',
    'Germany', 'DE', 'EU',
    'https://www.bfarm.de/DE/Arzneimittel/Pharmakovigilanz/Liefer-und-Versorgungsengpaesse/',
    NULL,
    24, 0.93,
    'German federal medicines authority. Downloadable shortage list available.'
),
(
    '10000000-0000-0000-0000-000000000009',
    'Agenzia Italiana del Farmaco — Carenze',
    'AIFA',
    'Italy', 'IT', 'EU',
    'https://www.aifa.gov.it/carenze',
    NULL,
    24, 0.90,
    'Italian medicines agency. Publishes active shortage list and historical data.'
),
(
    '10000000-0000-0000-0000-000000000010',
    'Agencia Española de Medicamentos y Productos Sanitarios — Suministro',
    'AEMPS',
    'Spain', 'ES', 'EU',
    'https://www.aemps.gob.es/medicamentos-de-uso-humano/problemas-de-suministro/',
    NULL,
    24, 0.90,
    'Spanish medicines agency. Mandatory reporting via AEMPS platform.'
),
(
    '10000000-0000-0000-0000-000000000011',
    'College ter Beoordeling van Geneesmiddelen — Tekorten',
    'CBG-MEB',
    'Netherlands', 'NL', 'EU',
    'https://www.cbg-meb.nl/actueel/nieuws/onderwerpen/geneesmiddelentekorten',
    NULL,
    24, 0.89,
    'Dutch medicines evaluation board. Links to national tekortenmeldpunt portal.'
),
(
    '10000000-0000-0000-0000-000000000012',
    'Danish Medicines Agency — Drug Shortages',
    'DKMA',
    'Denmark', 'DK', 'EU',
    'https://laegemiddelstyrelsen.dk/en/pharmacies/drug-shortages/',
    NULL,
    24, 0.88,
    'Downloadable shortage list updated regularly.'
),
(
    '10000000-0000-0000-0000-000000000013',
    'Finnish Medicines Agency — Availability Problems',
    'Fimea',
    'Finland', 'FI', 'EU',
    'https://www.fimea.fi/web/en/medicines/availability_problems',
    NULL,
    24, 0.87,
    'Covers both prescription and non-prescription medicines.'
),
(
    '10000000-0000-0000-0000-000000000014',
    'Health Products Regulatory Authority — Medicine Shortages',
    'HPRA',
    'Ireland', 'IE', 'EU',
    'https://www.hpra.ie/homepage/medicines/medicines-information/medicine-shortages',
    NULL,
    24, 0.87,
    'Irish medicines regulator. Categorises shortages by impact level.'
),
(
    '10000000-0000-0000-0000-000000000015',
    'Läkemedelsverket — Swedish Medical Products Agency Shortages',
    'MPA-SE',
    'Sweden', 'SE', 'EU',
    'https://www.lakemedelsverket.se/en/medicinal-product/shortages',
    NULL,
    24, 0.89,
    'Swedish national authority. Mandatory reporting since 2020.'
),
(
    '10000000-0000-0000-0000-000000000016',
    'Státní ústav pro kontrolu léčiv — Nedostupnost léčiv',
    'SÚKL',
    'Czech Republic', 'CZ', 'EU',
    'https://www.sukl.cz/leciva/nedostupnost-leciv',
    NULL,
    48, 0.83,
    'Czech State Institute for Drug Control. Shortage list in Czech and partial English.'
),
(
    '10000000-0000-0000-0000-000000000017',
    'Országos Gyógyszerészeti és Élelmezés-egészségügyi Intézet — Gyógyszer hiány',
    'OGYÉI',
    'Hungary', 'HU', 'EU',
    'https://ogyei.gov.hu/human_drug_shortage/',
    NULL,
    48, 0.80,
    'Hungarian National Institute of Pharmacy. Updated irregularly.'
),
(
    '10000000-0000-0000-0000-000000000018',
    'Swissmedic — Availability of Medicinal Products',
    'Swissmedic',
    'Switzerland', 'CH', 'Europe',
    'https://www.swissmedic.ch/swissmedic/en/home/humanarzneimittel/market-surveillance/availability-of-medicinal-products.html',
    NULL,
    24, 0.91,
    'Swiss therapeutic products agency. Non-EU but closely aligned with EMA.'
),
(
    '10000000-0000-0000-0000-000000000019',
    'Statens legemiddelverk — Norwegian Medicines Agency Shortages',
    'NOMA',
    'Norway', 'NO', 'Europe',
    'https://legemiddelverket.no/english/shortages',
    NULL,
    24, 0.88,
    'Norwegian Medicines Agency. EEA member, aligned with EMA.'
),
(
    '10000000-0000-0000-0000-000000000020',
    'Österreichische Agentur für Gesundheit und Ernährungssicherheit — Lieferengpässe',
    'AGES',
    'Austria', 'AT', 'EU',
    'https://www.ages.at/en/topics/drugs/drug-shortages/',
    NULL,
    48, 0.83,
    'Austrian Agency for Health and Food Safety. Shortage data in German.'
);
