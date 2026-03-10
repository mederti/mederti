-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 — intelligence_sources
-- Standalone table for macro intelligence data sources.
-- Completely separate from shortage_events, recalls, and all drug tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence_sources (
    source_id                    TEXT        PRIMARY KEY,
    name                         TEXT        NOT NULL,
    owner_org                    TEXT,
    category                     TEXT,
    subcategory                  TEXT,
    geography_coverage           TEXT,
    access_method                TEXT,
    auth                         TEXT,
    raw_data_entrypoints         TEXT,
    docs_entrypoint              TEXT,
    formats                      TEXT,
    update_frequency_expected    TEXT,
    recommended_poll_frequency   TEXT,
    change_detection             TEXT,
    primary_keys                 TEXT,
    terms_notes                  TEXT,
    is_medicines_regulator       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_government_or_igo         BOOLEAN     NOT NULL DEFAULT FALSE,
    priority_for_daily_monitoring TEXT,
    notes                        TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Updated-at trigger (reuses existing set_updated_at function from migration 001)
CREATE TRIGGER trg_intelligence_sources_updated_at
    BEFORE UPDATE ON intelligence_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes for the two filterable columns
CREATE INDEX IF NOT EXISTS idx_intel_src_category  ON intelligence_sources (category);
CREATE INDEX IF NOT EXISTS idx_intel_src_priority  ON intelligence_sources (priority_for_daily_monitoring);
CREATE INDEX IF NOT EXISTS idx_intel_src_access    ON intelligence_sources (access_method);

-- RLS — public read, service_role write
ALTER TABLE intelligence_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intel_sources: public read"
    ON intelligence_sources FOR SELECT USING (true);

CREATE POLICY "intel_sources: service_role write"
    ON intelligence_sources FOR ALL USING (auth.role() = 'service_role');
