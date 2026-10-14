-- ============================================================================
-- Migration 070: clinical_advisories table
-- ============================================================================
-- Sub-national clinical guidance attached to a drug — the "what do I do
-- instead?" layer that national regulator shortage feeds (TGA, FDA …) don't
-- carry. First source: NSW Health Clinical Excellence Commission "Medication
-- safety updates" (https://cec.health.nsw.gov.au/therapeutics-safety/medication-updates):
-- ~260 entries covering shortages, discontinuations, recalls, safety
-- considerations and practice changes, each with Formulary-approved
-- substitutes / conservation advice for NSW Health hospitals.
--
-- Deliberately NOT written into shortage_events: these are advisories from a
-- state health system, not regulator notices, and ~80% duplicate an existing
-- TGA shortage. Storing them as shortage rows would double-count AU. They
-- enrich the AU picture instead (drug page "NSW Health guidance" panel).
--
-- Idempotent + reversible (DROP TABLE IF EXISTS to revert). Table starts
-- empty; backend/scrapers/advisories/* populate it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS clinical_advisories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Primary resolved canonical drug (null when unresolved).
  drug_id             UUID REFERENCES drugs(id) ON DELETE SET NULL,
  -- All canonical drugs the advisory covers ("Cyclophosphamide and ifosfamide
  -- injections" → both). Always contains drug_id when drug_id is set.
  drug_ids            UUID[] NOT NULL DEFAULT '{}',
  -- Advisory title as published ("Bleomycin 15,000 IU powder for injection vial").
  title               TEXT NOT NULL,
  -- Resolved INN when known, else the raw title. Used for ilike fallback lookups.
  generic_name        TEXT,
  -- Issuing body + jurisdiction. jurisdiction is ISO 3166-2 ("AU-NSW").
  source              TEXT NOT NULL CHECK (source IN ('nsw_cec', 'other')),
  country_code        CHAR(2) NOT NULL,
  jurisdiction        TEXT NOT NULL,
  -- Publisher's stable id for the entry (CEC Matrix assetId).
  source_reference    TEXT NOT NULL,
  -- current | resolved as published; lapsed = no longer listed by the source.
  status              TEXT NOT NULL DEFAULT 'current' CHECK (status IN (
    'current', 'resolved', 'lapsed'
  )),
  -- Normalised category tags: shortage | discontinuation | recall |
  -- safety_consideration | practice_change.
  categories          TEXT[] NOT NULL DEFAULT '{}',
  -- Publisher keywords (supplier, brand, "S19A").
  keywords            TEXT,
  -- Guidance body as plain text (HTML stripped server-side at scrape time —
  -- never render publisher HTML). Paragraphs separated by blank lines, list
  -- items prefixed "• ".
  guidance            TEXT,
  date_issued         DATE,
  date_updated        DATE,
  source_url          TEXT,
  source_name         TEXT,
  raw_data            JSONB,
  last_verified_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_reference)
);

CREATE INDEX IF NOT EXISTS idx_clinical_advisories_drug
  ON clinical_advisories (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinical_advisories_drug_ids
  ON clinical_advisories USING GIN (drug_ids);
CREATE INDEX IF NOT EXISTS idx_clinical_advisories_generic_norm
  ON clinical_advisories (lower(generic_name));
CREATE INDEX IF NOT EXISTS idx_clinical_advisories_source_status
  ON clinical_advisories (source, status);

CREATE OR REPLACE FUNCTION clinical_advisories_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinical_advisories_updated_at ON clinical_advisories;
CREATE TRIGGER trg_clinical_advisories_updated_at
  BEFORE UPDATE ON clinical_advisories
  FOR EACH ROW EXECUTE FUNCTION clinical_advisories_touch_updated_at();

-- RLS on; no anon/authenticated policy. Consistent with migration 047 (anon
-- PostgREST access revoked) — the drug page reads via the service-role client
-- server-side; scrapers write with service_role.
ALTER TABLE clinical_advisories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_advisories FROM anon;

COMMENT ON TABLE clinical_advisories IS
  'Sub-national clinical guidance per drug (substitutes, conservation, safety advice). First source: NSW Health CEC Medication safety updates. Enrichment only — not counted as shortage_events. Populated by backend/scrapers/advisories/*.';
