-- ============================================================================
-- Migration 036: Schema legibility lift
-- ============================================================================
-- Two unrelated-but-bundled fixes from the 2026-05-27 persona-coverage audit
-- (docs/persona-coverage-audit.md):
--
-- 1. drug_catalogue — document the existing production table in the migration
--    history. The audit's schema agent flagged this as an "orphan" because no
--    CREATE TABLE exists in migrations 001–035 (migration 026 only ALTERs it).
--    In reality the table exists, holds 160k+ rows, and is referenced by 7+
--    backend scripts. It was created outside the standard migration sequence
--    (Supabase dashboard or a squashed migration). This block retroactively
--    captures the production schema as CREATE TABLE IF NOT EXISTS so:
--      • fresh DB clones reproduce the table
--      • production is unaffected (IF NOT EXISTS is a no-op against the
--        existing populated table)
--      • the migration history becomes self-sufficient again
--
-- 2. COMMENT ON COLUMN — ten high-leverage column comments per audit §5.4.
--    Closes the "ambiguous timestamp semantics", "dual status enum", and
--    "regulator-supplied vs Mederti-derived" gaps that an LLM hitting raw
--    SQL would otherwise misinterpret.
--
-- This migration is idempotent and reversible. All DDL is IF NOT EXISTS or
-- COMMENT ON (the latter is by definition idempotent — running it twice
-- produces the same result, and to "revert" you re-run COMMENT ON with NULL).
-- ============================================================================

-- ── 1. drug_catalogue — documenting CREATE TABLE IF NOT EXISTS ─────────────
-- Column definitions match production via PostgREST OpenAPI inspection
-- on 2026-05-27. If the production table later diverges (e.g. via dashboard
-- changes), update this block and re-run; CREATE TABLE IF NOT EXISTS will
-- skip, but a fresh clone will pick up the new shape.
CREATE TABLE IF NOT EXISTS drug_catalogue (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id              UUID REFERENCES drugs(id) ON DELETE SET NULL,
  generic_name         TEXT,
  brand_name           TEXT,
  strength             TEXT,
  dosage_form          TEXT,
  route                TEXT,
  source_country       TEXT,
  registration_number  TEXT,
  registration_status  TEXT DEFAULT 'active',
  sponsor              TEXT,
  atc_code             TEXT,
  therapeutic_class    TEXT,
  active_ingredients   JSONB,
  source_name          TEXT,
  source_url           TEXT,
  source_updated_at    TIMESTAMPTZ,
  has_active_shortage  BOOLEAN DEFAULT FALSE,
  shortage_count       INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector        TSVECTOR,
  -- The four columns added by migration 026 (already in production; declared
  -- here for fresh-clone reproducibility). Migration 026's ADD COLUMN IF NOT
  -- EXISTS still runs cleanly when these are present.
  strength_value       NUMERIC,
  strength_unit        TEXT,
  form_normalised      TEXT,
  generic_normalised   TEXT
);

-- Indexes (mirroring production where known; migration 026 declares the
-- composite ones — these are the additional general-purpose ones the
-- backend import scripts depend on).
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_drug_id
  ON drug_catalogue (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_source_country
  ON drug_catalogue (source_country);
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_registration_number
  ON drug_catalogue (registration_number) WHERE registration_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_search_vector
  ON drug_catalogue USING GIN (search_vector);

-- RLS — only apply if drug_catalogue has no policies yet (fresh-clone path).
-- Production may already have its own RLS configuration we don't want to
-- step on; this DO block makes the migration a strict no-op there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drug_catalogue') THEN
    EXECUTE 'ALTER TABLE drug_catalogue ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "drug_catalogue public read" ON drug_catalogue FOR SELECT USING (true)';
  END IF;
END $$;

-- Documenting comments specific to drug_catalogue
COMMENT ON TABLE drug_catalogue IS
  'Flattened multi-country drug-registry import target. One row per country-specific registration entry across TGA (AU), MHRA/EMA (GB/EU), FDA NDC (US), PMDA (JP) and others. Populated by scripts/catalogue_import_*.py and linked to the master drugs table via scripts/link_catalogue_to_drugs.py. Use drug_products for the canonical registry-entry layer; use drug_catalogue for cross-border name + strength + form matching during ingest.';

COMMENT ON COLUMN drug_catalogue.generic_normalised IS
  'Lower-trimmed normalised form of generic_name, populated at link time by scripts/link_catalogue_to_drugs.py. Used with strength_value + strength_unit + form_normalised for fast composite-key matching across countries.';

COMMENT ON COLUMN drug_catalogue.has_active_shortage IS
  'Denormalised cache: TRUE if any shortage_events row references this catalogue entry''s linked drug_id with status=active. Refreshed by health detectors; treat as advisory, not source-of-truth — query shortage_events directly for an authoritative count.';

COMMENT ON COLUMN drug_catalogue.shortage_count IS
  'Denormalised cache: count of active shortage_events for the linked drug_id at last refresh. See has_active_shortage caveat.';

COMMENT ON COLUMN drug_catalogue.source_updated_at IS
  'Timestamp from the source registry''s own record (when the country regulator last modified the registration entry). Distinct from updated_at, which is when Mederti last touched this row.';

-- ── 2. Top-10 schema legibility comments (audit §5.4) ──────────────────────

-- shortage_events
COMMENT ON COLUMN shortage_events.start_date IS
  'Date shortage began per source regulator. May differ from scraper discovery date. Nullable; defaults to CURRENT_DATE when source provides none.';

COMMENT ON COLUMN shortage_events.last_verified_at IS
  'Timestamp of last scraper run that confirmed this shortage in its output. mark_stale_shortages() moves rows with last_verified_at > 7d to status=stale.';

COMMENT ON COLUMN shortage_events.estimated_resolution_date IS
  'Regulator-supplied estimate. NOT a Mederti forecast. Treat as low-confidence and never present without explicit caveat — see refusal patterns in chat system prompt.';

COMMENT ON COLUMN shortage_events.source_confidence_score IS
  '0-100. Overrides data_sources.reliability_weight for this signal. NULL = use data_sources.reliability_weight.';

COMMENT ON COLUMN shortage_events.status IS
  'Regulator-reported shortage state: active | resolved | anticipated | stale. For per-country product availability use drug_availability.status instead.';

-- drug_availability
COMMENT ON COLUMN drug_availability.status IS
  'Aggregate availability state per product per country: available | shortage | limited | discontinued | recalled. For regulator-declared shortage events use shortage_events.status.';

-- drugs
COMMENT ON COLUMN drugs.who_essential_medicine IS
  'TRUE if on the current WHO Essential Medicines List. See who_eml_section and who_eml_year for section / year of inclusion.';

-- recalls
COMMENT ON COLUMN recalls.recall_class IS
  'FDA classification (I/II/III/Unclassified). Non-US recalls mapped to nearest equivalent at scrape time; mapping is approximate — consult raw_data for source-native classification.';

-- drug_products
COMMENT ON COLUMN drug_products.registry_status IS
  'Country-specific registration status. Values vary by source (ARTG: Active/Cancelled; PL: Authorised/Suspended; etc.). See raw_data for source-native value.';

-- alert_notifications
COMMENT ON COLUMN alert_notifications.shortage_event_id IS
  'FK to shortage_events. Nullable since v007 to support recall alerts. For recall alerts, the affected drug is at watchlist.drug_id (shortage_event_id is NULL).';
