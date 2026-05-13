-- ============================================================================
-- Migration 027: Expand drug search vector — Phase 1 of search broadening
-- ============================================================================
-- Folds the columns that already exist on `drugs` (dosage_forms, strengths,
-- routes_of_administration, drug_class) plus the rows in `drug_synonyms`
-- into `drugs.search_vector`, so a single FTS query can match by:
--
--   • generic name              (weight A — primary)
--   • brand names               (weight B)
--   • synonyms                  (weight B — paracetamol↔acetaminophen)
--   • ATC code/description      (weight C)
--   • therapeutic class         (weight C)
--   • drug class                (weight C)
--   • dosage form               (weight C — tablet, injection…)
--   • strength                  (weight C — 5mg, 500mg/mL…)
--   • route                     (weight C — oral, IV…)
--
-- Manufacturer name and registry IDs (ARTG/NDA/DIN/PL) are intentionally
-- deferred to Phase 2 — they require cross-table aggregation from
-- shortage_events/manufacturers and will arrive via a nightly refresh job.
-- ============================================================================

-- ── 1. Synonyms aggregate column ────────────────────────────────────────────
ALTER TABLE drugs
  ADD COLUMN IF NOT EXISTS synonyms_text TEXT;

COMMENT ON COLUMN drugs.synonyms_text IS
  'Space-joined cache of drug_synonyms.synonym for this drug. '
  'Maintained by trg_drug_synonyms_refresh; folded into search_vector weight B.';

-- ── 2. Replace tsvector trigger function ────────────────────────────────────
-- Same shape as 001 but folds in: synonyms_text (B), drug_class +
-- dosage_forms + strengths + routes_of_administration (C).
CREATE OR REPLACE FUNCTION update_drug_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.generic_name_normalised := lower(trim(NEW.generic_name));
    NEW.brand_names_text        := array_to_string(NEW.brand_names, ' ');

    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.generic_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.brand_names_text, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.synonyms_text, '')), 'B') ||
        setweight(to_tsvector('english',
            COALESCE(NEW.atc_code, '')             || ' ' ||
            COALESCE(NEW.atc_description, '')      || ' ' ||
            COALESCE(NEW.therapeutic_category, '') || ' ' ||
            COALESCE(NEW.drug_class, '')           || ' ' ||
            COALESCE(array_to_string(NEW.dosage_forms, ' '), '')             || ' ' ||
            COALESCE(array_to_string(NEW.strengths, ' '), '')                || ' ' ||
            COALESCE(array_to_string(NEW.routes_of_administration, ' '), '')
        ), 'C');
    RETURN NEW;
END;
$$;

-- ── 3. Refresh trigger on drug_synonyms ─────────────────────────────────────
-- Whenever a synonym is added/changed/removed, recompute the parent drug's
-- synonyms_text. The UPDATE on drugs re-fires update_drug_search_vector,
-- which folds the new synonyms_text into search_vector.
CREATE OR REPLACE FUNCTION refresh_drug_synonyms_text()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_drug_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_drug_id := OLD.drug_id;
    ELSE
        target_drug_id := NEW.drug_id;
    END IF;

    UPDATE drugs
       SET synonyms_text = (
               SELECT string_agg(synonym, ' ' ORDER BY synonym)
                 FROM drug_synonyms
                WHERE drug_id = target_drug_id
           )
     WHERE id = target_drug_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_drug_synonyms_refresh ON drug_synonyms;
CREATE TRIGGER trg_drug_synonyms_refresh
    AFTER INSERT OR UPDATE OR DELETE ON drug_synonyms
    FOR EACH ROW EXECUTE FUNCTION refresh_drug_synonyms_text();

-- ── 4. Backfill synonyms_text for existing drugs ────────────────────────────
UPDATE drugs d
   SET synonyms_text = sub.s
  FROM (
      SELECT drug_id, string_agg(synonym, ' ' ORDER BY synonym) AS s
        FROM drug_synonyms
       GROUP BY drug_id
  ) sub
 WHERE d.id = sub.drug_id
   AND (d.synonyms_text IS DISTINCT FROM sub.s);

-- ── 5. Recompute search_vector across every drug ────────────────────────────
-- Touch updated_at so the BEFORE trigger refires and folds the new fields in.
UPDATE drugs SET updated_at = NOW();
