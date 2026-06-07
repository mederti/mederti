-- ============================================================================
-- Migration 053: drug_catalogue form_bucket + strength parse + supplement flag
-- ============================================================================
-- Adds the structured fields behind the Form and Strength search filters, and
-- tags non-medicine "listed" products (supplements/consumer-health) so they can
-- be excluded from product search.
--
-- WHY (validated read-only against prod, 2026-06-07):
--   • Form: the dosage_form column is ~6% populated for AU and cryptic where
--     present (ARTG codes like 'tabfc'). The form is reliably stated in the
--     product NAME ("injection vial", "oral suspension", "500mg capsule"), so
--     we parse a clean bucket from the name instead. For real medicines this is
--     high-coverage (amoxicillin partitions Oral liquid/Capsule/Tablet/Injectable
--     cleanly); the low broad-coverage headline (~45%) was supplement noise.
--   • Strength: the strength text is ~62% populated for AU but free-form
--     ("100 mg" vs "100mg"); strength_value/strength_unit (the clean numeric
--     pair) only ~33%. We backfill the numeric pair from the name/strength text.
--   • Supplements: ~37% of AU catalogue rows (11,596 / 31,321) are ARTG "Listed"
--     products (registration_number 'AUST L %') — Sensodyne, Fish Oil, Curcumin,
--     "Liver detox" — NOT registered medicines ('AUST R %'). The AUST L/R prefix
--     is a near-100% precise structured signal (AU atc_code is 0% populated, so
--     it is the ONLY usable medicine signal). These dilute every AU search.
--
-- This migration:
--   • drug_catalogue.form_bucket   — controlled-vocab dose form parsed from name
--   • drug_catalogue.is_supplement — TRUE for ARTG Listed (AUST L) products
--   • backfills strength_value / strength_unit where NULL (columns already exist)
--   • parse/classify functions + a BEFORE INSERT/UPDATE trigger (anti-rot at the
--     DB layer — there is no shared catalogue-upsert helper to hook)
--   • partial indexes for the filter hot paths
--
-- The search route reads all three DEFENSIVELY (probe-and-fallback), so deploying
-- the route change before this migration is applied is SAFE — search keeps
-- working and the filters/exclusion switch on once the columns exist.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) and reversible — see DOWN.
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS form_bucket text
  CHECK (form_bucket IN (
    'tablet','capsule','oral_liquid','injectable','topical',
    'inhalation','drops','suppository','patch','powder','other'
  ));

ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS is_supplement boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN drug_catalogue.form_bucket IS
  'Controlled-vocab dosage form parsed from the product name (parse_form_bucket). Powers the Form search filter. NULL = form not derivable from the name (left visible — only known buckets filter). Maintained by the set_catalogue_derived trigger.';
COMMENT ON COLUMN drug_catalogue.is_supplement IS
  'TRUE for non-medicine "listed" products — ARTG Listed (registration_number ILIKE ''AUST L%''): supplements, vitamins, consumer-health. Registered medicines are ''AUST R%''. The search route excludes is_supplement by default. Maintained by the set_catalogue_derived trigger.';

-- ── Parsers ─────────────────────────────────────────────────────────────────
-- Form: first-match-wins, ordered so compound forms ("powder for injection",
-- "oral solution") resolve before the bare token. Returns NULL when no keyword
-- is found (the row stays visible; the filter simply can't place it).
CREATE OR REPLACE FUNCTION parse_form_bucket(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    WHEN p_name ~* '(injection|for inj|inj\.|vial|infusion|ampoule|intraven|\bi\.?v\.?\b)' THEN 'injectable'
    WHEN p_name ~* '(inhal|nebuli|metered|puffer|aerosol|turbuhaler|accuhaler)'            THEN 'inhalation'
    WHEN p_name ~* '(eye |ear |ophthalmic|ocular|nasal drop|eye-drop|ear-drop)'            THEN 'drops'
    WHEN p_name ~* '(suspension|\bsusp\b|syrup|elixir|\bmixture\b|oral solution|oral liquid|oral drops|\bsolution for oral)' THEN 'oral_liquid'
    WHEN p_name ~* '(cream|ointment|\bgel\b|lotion|topical|dermal|transdermal patch)'      THEN 'topical'
    WHEN p_name ~* '(patch|transderm)'                                                     THEN 'patch'
    WHEN p_name ~* '(suppositor|pessary)'                                                  THEN 'suppository'
    WHEN p_name ~* '(capsule|\bcaps?\b|caphrd|capsft)'                                      THEN 'capsule'
    WHEN p_name ~* '(tablet|\btabs?\b|caplet|lozenge|chewable|\btab[a-z]{2,}\b)'            THEN 'tablet'
    WHEN p_name ~* '(powder|granule|sachet|effervescent)'                                  THEN 'powder'
    ELSE NULL
  END
$$;

-- Strength: first numeric+unit token from the name/strength text. Best-effort —
-- for solids this is the dose, for liquids it's the leading concentration
-- figure. Returns (value, unit) via the two helpers below.
CREATE OR REPLACE FUNCTION parse_strength_value(p_text text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF((regexp_match(
    p_text, '([0-9]+(?:\.[0-9]+)?)\s*(?:mg|mcg|microgram|micrograms|g|ml|%|iu|units?)', 'i'
  ))[1], '')::numeric
$$;

CREATE OR REPLACE FUNCTION parse_strength_unit(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
    (regexp_match(
      p_text, '[0-9]+(?:\.[0-9]+)?\s*(mg|mcg|microgram|micrograms|g|ml|%|iu|units?)', 'i'
    ))[1],
    'micrograms?', 'mcg', 'i'
  ))
$$;

COMMENT ON FUNCTION parse_form_bucket(text) IS
  'Phase 3b form parser: maps a product name to one of the form_bucket controlled values, NULL if no dose-form keyword is present. Ordered first-match (compound forms before bare tokens).';

-- ── Trigger: derive form_bucket, strength_value/unit, is_supplement ─────────
CREATE OR REPLACE FUNCTION set_catalogue_derived()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_src text;
BEGIN
  v_src := coalesce(NEW.brand_name, '') || ' ' || coalesce(NEW.generic_name, '');

  -- Form: only set when we can derive one (don't clobber an existing value with NULL).
  NEW.form_bucket := coalesce(parse_form_bucket(v_src), NEW.form_bucket);

  -- Strength: backfill the clean numeric pair only when missing, preferring the
  -- explicit strength text, falling back to the name.
  IF NEW.strength_value IS NULL THEN
    NEW.strength_value := coalesce(
      parse_strength_value(coalesce(NEW.strength, '')),
      parse_strength_value(v_src)
    );
    NEW.strength_unit := coalesce(
      NEW.strength_unit,
      parse_strength_unit(coalesce(NEW.strength, '')),
      parse_strength_unit(v_src)
    );
  END IF;

  -- Supplement: ARTG Listed products (AU). Other markets stay false here (a
  -- name-lexicon fallback can be added later); AU is where the clutter is.
  NEW.is_supplement := (NEW.registration_number ILIKE 'AUST L%');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS set_catalogue_derived ON drug_catalogue;
CREATE TRIGGER set_catalogue_derived
  BEFORE INSERT OR UPDATE OF brand_name, generic_name, strength, registration_number
  ON drug_catalogue
  FOR EACH ROW EXECUTE FUNCTION set_catalogue_derived();

-- ── Indexes (filter hot paths) ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_catalogue_is_supplement
  ON drug_catalogue (is_supplement) WHERE is_supplement = true;
CREATE INDEX IF NOT EXISTS idx_catalogue_form_bucket
  ON drug_catalogue (form_bucket) WHERE form_bucket IS NOT NULL;

-- ── Backfill (existing rows; trigger only fires on future writes) ────────────
UPDATE drug_catalogue
   SET form_bucket    = coalesce(parse_form_bucket(coalesce(brand_name,'') || ' ' || coalesce(generic_name,'')), form_bucket),
       strength_value = coalesce(strength_value, parse_strength_value(coalesce(strength,'')), parse_strength_value(coalesce(brand_name,'') || ' ' || coalesce(generic_name,''))),
       strength_unit  = coalesce(strength_unit, parse_strength_unit(coalesce(strength,'')), parse_strength_unit(coalesce(brand_name,'') || ' ' || coalesce(generic_name,''))),
       is_supplement  = (registration_number ILIKE 'AUST L%')
 WHERE registration_number ILIKE 'AUST L%'
    OR form_bucket IS NULL
    OR strength_value IS NULL;

-- ============================================================================
-- DOWN (reverse this migration):
--   DROP TRIGGER IF EXISTS set_catalogue_derived ON drug_catalogue;
--   DROP FUNCTION IF EXISTS set_catalogue_derived();
--   DROP FUNCTION IF EXISTS parse_form_bucket(text);
--   DROP FUNCTION IF EXISTS parse_strength_value(text);
--   DROP FUNCTION IF EXISTS parse_strength_unit(text);
--   DROP INDEX IF EXISTS idx_catalogue_is_supplement;
--   DROP INDEX IF EXISTS idx_catalogue_form_bucket;
--   ALTER TABLE drug_catalogue DROP COLUMN IF EXISTS form_bucket;
--   ALTER TABLE drug_catalogue DROP COLUMN IF EXISTS is_supplement;
-- strength_value/strength_unit are NOT dropped (pre-existing columns); the
-- backfill only filled NULLs, so no original value was overwritten.
-- ============================================================================

-- ── Verification (post-apply) ───────────────────────────────────────────────
-- Supplement split (expect ≈ AUST L 11596 / AUST R 19725 for AU):
--   SELECT is_supplement, COUNT(*) FROM drug_catalogue
--   WHERE source_country='AU' GROUP BY is_supplement;
--
-- Form coverage on real medicines (AUST R) should dominate:
--   SELECT form_bucket, COUNT(*) FROM drug_catalogue
--   WHERE source_country='AU' AND is_supplement=false GROUP BY form_bucket ORDER BY 2 DESC;
--
-- Amoxicillin partitions across forms:
--   SELECT form_bucket, COUNT(*) FROM drug_catalogue
--   WHERE source_country='AU' AND generic_name ILIKE '%amoxicillin%'
--     AND generic_name NOT ILIKE '%clav%' GROUP BY form_bucket ORDER BY 2 DESC;
