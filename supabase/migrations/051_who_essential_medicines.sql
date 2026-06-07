-- ============================================================================
-- Migration 051: WHO Model List of Essential Medicines — authoritative raw table
-- ============================================================================
-- Mederti already CONSUMES a WHO Essential Medicine signal everywhere:
--   • drugs.who_essential_medicine / who_eml_section / who_eml_year columns
--     (added in migration 023) drive badges (DrugPane, PreviewPane, CardChrome),
--     the chat sole-source tools, predictive-signals, drug-resilience, SEO and
--     OG images.
--   • BUT nothing populated them — only ~70 of ~18k drugs were hand-seeded, vs
--     the ~460 substances on the real 23rd WHO Model List (2023). The signal was
--     effectively dark.
--
-- The new importer (backend/importers/who_eml_importer.py) ingests the official
-- electronic EML (eEML, list.essentialmeds.org) JSON-LD API and:
--   1. writes the authoritative WHO records verbatim into THIS table, and
--   2. denormalises the flag/section/year back onto matched `drugs` rows so the
--      existing UI lights up with no further change.
--
-- This table is the citable / exportable source of record — one row per eEML
-- medicine entry (a medicine × its EML listing). It is intentionally richer than
-- the three denormalised columns on `drugs`: it carries the core/complementary
-- distinction, the children's-list (EMLc) flag, the AWaRe antibiotic-stewardship
-- group, and the formulations — fields the "world's leading cited source"
-- positioning needs but that don't belong as columns on every drug.
--
-- `drug_id` is a NULLABLE soft link: WHO lists ~460 substances; the importer
-- resolves each to a canonical `drugs` row by INN name (primary — 18k rows carry
-- generic_name_normalised) then ATC code (secondary). Unmatched WHO entries are
-- still stored (the list stays complete and citable) but carry a NULL drug_id.
--
-- Idempotent + reversible (DROP TABLE). No data movement on existing tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS who_essential_medicines (
  -- eEML stable medicine id (list.essentialmeds.org/medicines/{id}) — natural PK
  eeml_id            INTEGER PRIMARY KEY,

  inn                TEXT NOT NULL,            -- nonProprietaryName (clean INN)
  atc_code           TEXT,                     -- from the recommendation (may be NULL)
  description         TEXT,                    -- short WHO description, where present

  -- EML classification
  eml_section        TEXT,                     -- e.g. "8.2.2. Targeted therapies"
  eml_list           TEXT,                     -- 'core' | 'complementary' (lower-cased)
  included_in_emlc   BOOLEAN DEFAULT FALSE,    -- on the children's list (EMLc)?
  aware_group        TEXT,                     -- antibiotic AWaRe: Access|Watch|Reserve

  eml_edition        INTEGER NOT NULL,         -- list edition number (e.g. 23)
  eml_year           INTEGER NOT NULL,         -- list year (e.g. 2023)

  formulations       JSONB,                    -- drugUnit[] strings, verbatim
  raw                JSONB,                    -- full JSON-LD record (audit / re-derive)

  -- Soft resolution to Mederti's canonical drug. NULL = WHO entry we could not
  -- (yet) map to a drugs row. ON DELETE SET NULL: deleting a drug never deletes
  -- the authoritative WHO record.
  drug_id            UUID REFERENCES drugs(id) ON DELETE SET NULL,
  match_method       TEXT,                     -- 'inn' | 'atc' | NULL (unmatched)

  source_url         TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE who_essential_medicines IS
  'Authoritative WHO Model List of Essential Medicines (eEML, list.essentialmeds.org), one row per medicine listing. Source of record for the WHO-essential signal; the importer denormalises inn/section/year onto drugs.who_essential_medicine for fast badge/filter queries. drug_id is a nullable soft link (INN-primary, ATC-secondary match); unmatched WHO entries are retained with NULL drug_id so the list stays complete and citable.';

COMMENT ON COLUMN who_essential_medicines.eml_list IS
  '''core'' = WHO Core List (minimum needs of a basic health system); ''complementary'' = Complementary List (needs specialist diagnosis/monitoring or higher cost).';
COMMENT ON COLUMN who_essential_medicines.aware_group IS
  'WHO AWaRe antibiotic-stewardship classification (Access / Watch / Reserve) for antibiotics; NULL for non-antibiotics. The only place Mederti carries this signal.';

-- Hot paths: resolve by drug, and filter the unmatched backlog.
CREATE INDEX IF NOT EXISTS idx_who_eml_drug_id
  ON who_essential_medicines (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_who_eml_inn
  ON who_essential_medicines (lower(inn));
CREATE INDEX IF NOT EXISTS idx_who_eml_atc
  ON who_essential_medicines (atc_code) WHERE atc_code IS NOT NULL;

-- RLS: keep parity with the other reference tables. Public read (it is public
-- WHO data and the frontend reads via service role anyway); writes are
-- service-role only (anon PostgREST access was revoked wholesale in 047).
ALTER TABLE who_essential_medicines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS who_eml_public_read ON who_essential_medicines;
CREATE POLICY who_eml_public_read
  ON who_essential_medicines FOR SELECT
  USING (true);

-- ── Verification (post-apply) ────────────────────────────────────────────
-- Confirm the table and policy exist:
--   SELECT count(*) FROM who_essential_medicines;            -- 0 before first run
-- After the first importer run (expect ~1,100 medicine rows, ~460 unique INNs):
--   SELECT count(*) AS total,
--          count(drug_id) AS matched,
--          count(*) FILTER (WHERE eml_list='core') AS core,
--          count(*) FILTER (WHERE included_in_emlc) AS emlc,
--          count(*) FILTER (WHERE aware_group IS NOT NULL) AS antibiotics
--   FROM who_essential_medicines;
-- And confirm the denormalised flag was backfilled on drugs:
--   SELECT count(*) FROM drugs WHERE who_essential_medicine = TRUE;  -- ≫ 70
