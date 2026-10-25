-- ============================================================================
-- Migration 072: Union list of critical medicines (EMA / HMA / EC) — raw table
-- ============================================================================
-- drugs.critical_medicine_eu (migration 024) is already CONSUMED by the chat
-- badges (DrugPane, PreviewPane, CardChrome), the chat drug tools, so-what and
-- drug-resilience — but nothing ever populated it: 0 of ~21k drugs flagged in
-- prod (counted 2026-10-25). The signal was dark.
--
-- The importer (backend/importers/eu_critical_medicines_importer.py) downloads
-- the official Union list xlsx from ema.europa.eu and:
--   1. writes every list entry verbatim into THIS table (citable source of
--      record: ATC level 5, substance, routes, date of inclusion, list version),
--   2. sets drugs.critical_medicine_eu = TRUE on exactly-resolved drugs rows.
--
-- The Union list is ROUTE-SCOPED (e.g. esomeprazole is listed for intravenous
-- use only). Our drugs rows are substance-level with no route data, so the
-- drugs flag means "substance appears on the list for at least one route";
-- the routes column here is the precise statement and should be shown with
-- the badge wherever space allows.
--
-- The list is reviewed annually and entries can be removed. Rows absent from
-- the latest file are kept with is_current = FALSE (history stays citable) and
-- the importer clears the drugs flag they set.
--
-- Idempotent + reversible (DROP TABLE). No data movement on existing tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS eu_critical_medicines (
  -- Natural key: ATC level-5 code + substance as printed (lower-cased).
  entry_key          TEXT PRIMARY KEY,

  atc_code           TEXT NOT NULL,            -- ATC level 5, e.g. 'A02BC05'
  substance          TEXT NOT NULL,            -- as printed, e.g. 'ESOMEPRAZOLE'
  atc_group          TEXT,                     -- nearest ATC level-4 heading in the file
  routes             TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'intravenous use'}
  date_of_inclusion  DATE,

  list_version       TEXT NOT NULL,            -- e.g. 'version 2.1 (revision 1)'
  document_ref       TEXT,                     -- e.g. 'EMA/4040/2026'
  document_date      DATE,
  is_current         BOOLEAN NOT NULL DEFAULT TRUE,

  -- Soft resolution to a drugs row (exact-name DrugResolver; never a
  -- canonical head). NULL = not resolved; the entry is still stored.
  drug_id            UUID REFERENCES drugs(id) ON DELETE SET NULL,
  match_method       TEXT,                     -- 'exact_name' | 'inn_usan_alias' | 'salt_form'

  source_url         TEXT NOT NULL,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE eu_critical_medicines IS
  'Union list of critical medicines (EMA/HMA/European Commission), one row per list entry (ATC level 5 x substance). Source of record for drugs.critical_medicine_eu. Entries are route-scoped: see routes. is_current = FALSE marks entries dropped in a later list version.';
COMMENT ON COLUMN eu_critical_medicines.routes IS
  'Routes of administration the entry covers, verbatim from the list. The list is route-scoped; a substance listed for intravenous use only is not critical in its oral form.';

CREATE INDEX IF NOT EXISTS idx_eu_crit_drug_id
  ON eu_critical_medicines (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eu_crit_atc
  ON eu_critical_medicines (atc_code);

-- RLS: parity with who_essential_medicines (public reference data, service-
-- role writes; anon PostgREST access was revoked wholesale in 047).
ALTER TABLE eu_critical_medicines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eu_crit_public_read ON eu_critical_medicines;
CREATE POLICY eu_crit_public_read
  ON eu_critical_medicines FOR SELECT
  USING (true);

-- ── Verification (post-apply, after first importer run) ──────────────────
--   SELECT list_version, count(*) AS entries, count(drug_id) AS resolved
--   FROM eu_critical_medicines WHERE is_current GROUP BY list_version;
--   SELECT count(*) FROM drugs WHERE critical_medicine_eu;   -- was 0
