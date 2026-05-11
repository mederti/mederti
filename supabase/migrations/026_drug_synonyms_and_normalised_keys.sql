-- ============================================================================
-- Migration 026: Drug synonyms + normalised composite-key columns
-- ============================================================================
-- Two improvements that unlock cross-border drug matching:
--
-- 1. drug_synonyms — every drug has zero or more known synonyms. Lets us
--    treat "paracetamol" and "acetaminophen", "salbutamol" and "albuterol",
--    "dipyrone" and "metamizole" as the same drug for matching.
--
-- 2. drug_catalogue.strength_value / strength_unit / form_normalised —
--    parsed once at link-time so the matcher can do composite (INN +
--    strength + form) joins without string-bashing on every query.
-- ============================================================================

-- ── 1. drug_synonyms ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drug_synonyms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id     UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  synonym     TEXT NOT NULL,
  -- The lower-trimmed form used for fast lookup
  synonym_normalised TEXT NOT NULL,
  -- Where the synonym came from: 'who_inn' / 'curated' / 'rxnorm' / 'manual'
  source      TEXT NOT NULL DEFAULT 'curated',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_drug_synonym
  ON drug_synonyms (drug_id, synonym_normalised);
CREATE INDEX IF NOT EXISTS idx_drug_synonym_lookup
  ON drug_synonyms (synonym_normalised);

-- Trigger to auto-populate synonym_normalised on insert/update if not set
CREATE OR REPLACE FUNCTION drug_synonyms_normalise() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.synonym_normalised IS NULL OR NEW.synonym_normalised = '' THEN
    NEW.synonym_normalised := lower(trim(NEW.synonym));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_drug_synonyms_normalise ON drug_synonyms;
CREATE TRIGGER trg_drug_synonyms_normalise
  BEFORE INSERT OR UPDATE ON drug_synonyms
  FOR EACH ROW EXECUTE FUNCTION drug_synonyms_normalise();

-- RLS: public read is fine (no PII)
ALTER TABLE drug_synonyms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drug_synonyms public read" ON drug_synonyms;
CREATE POLICY "drug_synonyms public read"
  ON drug_synonyms FOR SELECT USING (true);

-- ── 2. Normalised composite-key columns on drug_catalogue ──────────────────
ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS strength_value     NUMERIC,
  ADD COLUMN IF NOT EXISTS strength_unit      TEXT,
  ADD COLUMN IF NOT EXISTS form_normalised    TEXT,
  ADD COLUMN IF NOT EXISTS generic_normalised TEXT;

CREATE INDEX IF NOT EXISTS idx_drug_catalogue_generic_normalised
  ON drug_catalogue (generic_normalised) WHERE generic_normalised IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_form_normalised
  ON drug_catalogue (form_normalised) WHERE form_normalised IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drug_catalogue_composite
  ON drug_catalogue (generic_normalised, strength_value, strength_unit, form_normalised)
  WHERE generic_normalised IS NOT NULL;
