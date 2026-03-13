-- =============================================================================
-- 014 — Intelligence articles (AI-generated content pipeline)
-- =============================================================================
-- Daily content agent generates draft articles from shortage data.
-- Human reviews via admin page, then publishes to /intelligence hub.

CREATE TABLE intelligence_articles (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              TEXT        NOT NULL UNIQUE,
    title             TEXT        NOT NULL,
    description       TEXT        NOT NULL,
    category          TEXT        NOT NULL
                      CHECK (category IN ('article', 'report', 'data', 'media')),
    content_type      TEXT        NOT NULL
                      CHECK (content_type IN ('NEWS', 'ANALYSIS', 'DATA_REPORT', 'PODCAST_SUMMARY')),
    body_json         JSONB       NOT NULL,
    author            TEXT        NOT NULL DEFAULT 'Mederti Intelligence',
    read_time         TEXT,
    status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'rejected')),
    drug_id           UUID        REFERENCES drugs(id) ON DELETE SET NULL,
    drug_name         TEXT,
    shortage_event_id UUID        REFERENCES shortage_events(id) ON DELETE SET NULL,
    source_data       JSONB,
    meta_description  TEXT,
    pull_quote        TEXT,
    published_at      TIMESTAMPTZ,
    rejected_at       TIMESTAMPTZ,
    reviewed_by       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ia_status_published ON intelligence_articles(published_at DESC)
    WHERE status = 'published';
CREATE INDEX idx_ia_category         ON intelligence_articles(category)
    WHERE status = 'published';
CREATE INDEX idx_ia_drug_created     ON intelligence_articles(drug_id, created_at DESC)
    WHERE drug_id IS NOT NULL;
CREATE INDEX idx_ia_created          ON intelligence_articles(created_at DESC);

-- Reuse existing set_updated_at() trigger function from migration 001
CREATE TRIGGER trg_intelligence_articles_updated_at
    BEFORE UPDATE ON intelligence_articles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE intelligence_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_published" ON intelligence_articles
    FOR SELECT USING (status = 'published');

CREATE POLICY "service_role_all" ON intelligence_articles
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authed_read_all" ON intelligence_articles
    FOR SELECT USING (auth.role() = 'authenticated');
