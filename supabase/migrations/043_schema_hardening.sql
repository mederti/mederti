-- ============================================================================
-- Migration 043: schema hardening — audit-log immutability + FK alias + orphans
-- ============================================================================
-- Closes three related findings from docs/architecture-audit.md:
--
--   • D1-14 (⚠ hidden-failure) — audit_logs is documented as immutable but
--     RLS only restricts INSERT to service_role; UPDATE and DELETE are
--     unguarded. The table's tamper-evidence promise is unbacked. Add a
--     BEFORE UPDATE OR DELETE trigger that RAISE EXCEPTION.
--
--   • D1-07 (🟠) — recalls.source_id and shortage_events.data_source_id
--     both FK to data_sources(id) but use different column names. Every
--     cross-source query special-cases this. Add a GENERATED ALWAYS AS
--     (source_id) STORED `data_source_id` so both tables expose the same
--     join key. Backwards-compatible — `source_id` stays canonical.
--
--   • D1-11 (🟡) — `v_au_drug_universe`, `v_gb_drug_universe`,
--     `v_drug_universe_global` (from migration 011) have zero callers in
--     the frontend per repo grep. Drop them. The data is still in the
--     base tables; if needed they can be re-created.
--
-- Idempotent + reversible. None of the changes lose data.
-- ============================================================================

-- ── 1. audit_logs immutability ───────────────────────────────────────────
-- Enforce the "Never UPDATE or DELETE rows here" promise documented in
-- migration 001. Without this, any code path with the service-role key
-- can rewrite audit history.

CREATE OR REPLACE FUNCTION audit_logs_block_mutations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only (FINDING-D1-14); refused %', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_block_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_block_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();

DROP TRIGGER IF EXISTS trg_audit_logs_block_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_block_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();

COMMENT ON FUNCTION audit_logs_block_mutations() IS
  'Guards audit_logs append-only property; closes audit FINDING-D1-14. Returning a value here would block the operation; RAISE EXCEPTION instead so the caller sees a clear error.';

-- ── 2. recalls.data_source_id alias ──────────────────────────────────────
-- shortage_events uses `data_source_id`; recalls uses `source_id`. Both
-- target data_sources(id). Add a generated alias so cross-source queries
-- can use one column name everywhere.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'recalls'
      AND column_name  = 'data_source_id'
  ) THEN
    ALTER TABLE recalls
      ADD COLUMN data_source_id UUID GENERATED ALWAYS AS (source_id) STORED;

    COMMENT ON COLUMN recalls.data_source_id IS
      'Generated alias for source_id — matches shortage_events.data_source_id. Closes audit FINDING-D1-07 (naming drift). source_id remains canonical for INSERT/UPDATE; this column is read-only and computed.';
  END IF;
END $$;

-- Index the alias so joins on it are as cheap as joins on source_id. Partial
-- index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_recalls_data_source_id
  ON recalls (data_source_id);

-- ── 3. Drop orphan drug_universe views (FINDING-D1-11) ───────────────────
-- These views were built for a multi-country architecture that did not
-- survive the pivot to `drug_catalogue`. `grep "drug_universe" frontend/`
-- returns zero hits. Drop with CASCADE in case any downstream view we don't
-- know about depends on them — better to surface that than leave orphans.

DROP VIEW IF EXISTS v_drug_universe_global CASCADE;
DROP VIEW IF EXISTS v_au_drug_universe     CASCADE;
DROP VIEW IF EXISTS v_gb_drug_universe     CASCADE;

-- ── Verification queries (post-apply) ────────────────────────────────────
-- After applying, validate with:
--
--   -- D1-14: confirm trigger blocks update
--   UPDATE audit_logs SET action = 'INSERT' WHERE id = (SELECT id FROM audit_logs LIMIT 1);
--   -- expected: ERROR: audit_logs is append-only (FINDING-D1-14); refused UPDATE
--
--   -- D1-07: confirm alias column exists and matches
--   SELECT id, source_id, data_source_id, source_id = data_source_id AS match
--     FROM recalls LIMIT 1;
--
--   -- D1-11: confirm views gone
--   SELECT viewname FROM pg_views
--     WHERE viewname IN ('v_au_drug_universe','v_gb_drug_universe','v_drug_universe_global');
--   -- expected: 0 rows
