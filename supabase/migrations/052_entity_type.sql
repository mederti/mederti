-- ============================================================================
-- Migration 052: drugs.entity_type — de-noising classifier (Phase 3a)
-- ============================================================================
-- The `drugs` table conflates three different KINDS of row: real canonical
-- molecules, scraper-derived product strings, AND non-product noise that leaked
-- in from regulator feeds — reference documents (drug-interaction articles,
-- guidance/advisory/review notices) and "For Export Only" listings. There is no
-- field distinguishing them, so they surface in product search as if they were
-- dispensable products. Worse, some carry mis-attributed shortage_events: e.g.
-- "Statins Atorvastatin Rosuvastatin Simvastatin Interaction" shows a phantom
-- "2 active shortages" badge.
--
-- This migration adds a single classification column and, for Phase 3a, populates
-- ONLY the two high-precision, non-product classes so the search route can
-- exclude them by default:
--
--     reference_document   — interaction/guidance/advisory/review/monograph/
--                            guideline prose, with NO molecule identity
--                            (atc_code IS NULL AND resolved_inn IS NULL)
--     export_only          — "for export only" listings (name-based; an export
--                            product may still resolve to an INN, so this rule
--                            is NOT gated on the null-identity guard)
--
-- The remaining values in the CHECK set — molecule | combination |
-- branded_product — are reserved for Phase 3b (the Type filter) and are
-- DELIBERATELY left unpopulated here. Rows stay NULL/unknown until 3b. The
-- classifier function and trigger below only ever emit the two 3a values, so a
-- future 3b backfill cannot be clobbered by this trigger (it returns NULL for
-- everything it doesn't recognise, and the trigger only SETs on non-NULL).
--
-- BLAST RADIUS (validated read-only against prod, 2026-06-07): exactly 8 rows
-- match, 0 false positives. The null-identity guard means no row carrying an
-- ATC code or a resolved INN — i.e. no real molecule — is ever tagged.
--
-- ANTI-ROT: classification runs in a BEFORE INSERT/UPDATE trigger at the DB
-- layer, not in app code. There is no shared drug-upsert helper in the ~28
-- scrapers to hook (backend/utils/db.py is a generic REST wrapper), so a trigger
-- is the only place that catches every new row regardless of which scraper
-- wrote it. New "For Export Only…" / interaction rows self-tag on arrival.
--
-- DEPENDENCY: the search route reads entity_type defensively (a row is only
-- excluded if a probe query returns it as bad-typed; a missing column degrades
-- to "exclude nothing"), so deploying the route change before this migration is
-- applied is SAFE — search keeps working and de-noising simply switches on once
-- the column exists.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) and reversible — see DOWN.
-- ============================================================================

ALTER TABLE drugs
  ADD COLUMN IF NOT EXISTS entity_type text
  CHECK (entity_type IN (
    'molecule', 'combination', 'branded_product',
    'reference_document', 'export_only', 'unknown'
  ));

COMMENT ON COLUMN drugs.entity_type IS
  'Classification of what KIND of row this is. Phase 3a populates only reference_document (interaction/guidance/advisory/review/etc. prose with no molecule identity) and export_only ("for export only" listings); the search route excludes both from product results by default. molecule | combination | branded_product are reserved for Phase 3b (the Type filter) and stay NULL until then. NULL/unknown rows are always shown — the route only ever excludes the two known-bad 3a values. Maintained by the set_drug_entity_type BEFORE INSERT/UPDATE trigger (classify_drug_entity_type), which only emits the 3a values and never overwrites a 3b classification.';

-- Partial index: the route filters ONLY on the two excluded values, so index
-- just those few rows. Keeps it tiny (≈8 rows today).
CREATE INDEX IF NOT EXISTS idx_drugs_entity_type_excluded
  ON drugs (entity_type)
  WHERE entity_type IN ('reference_document', 'export_only');

-- ── Classifier (Phase 3a rules only) ───────────────────────────────────────
-- IMMUTABLE pure function: name + identity → one of the two 3a values, or NULL
-- for everything else (so the trigger leaves non-3a rows, incl. future 3b
-- classifications, untouched). Lexicon kept deliberately tight — it is the exact
-- set that produced 8 hits / 0 false positives in the prod dry-run.
CREATE OR REPLACE FUNCTION classify_drug_entity_type(
  p_name text, p_atc text, p_inn text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- export_only is name-based: an export product can still carry an ATC/INN.
    WHEN p_name ILIKE '%for export only%' THEN 'export_only'
    -- reference_document requires NO molecule identity — the guard that makes
    -- the lexicon safe. A real molecule always has an ATC or a resolved INN.
    WHEN p_atc IS NULL AND p_inn IS NULL AND (
         p_name ILIKE '%interaction%'
      OR p_name ILIKE '%guideline%'
      OR p_name ILIKE '%guidance%'
      OR p_name ILIKE '%monograph%'
      OR p_name ILIKE '%advisory%'
      OR p_name ILIKE '%review%'
    ) THEN 'reference_document'
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION classify_drug_entity_type(text, text, text) IS
  'Phase 3a de-noising classifier. Returns ''export_only'' for "for export only" listings (name-based), ''reference_document'' for interaction/guideline/guidance/monograph/advisory/review prose that carries NO molecule identity (atc IS NULL AND inn IS NULL), else NULL. Returns NULL for products/molecules so the set_drug_entity_type trigger never clobbers a Phase 3b classification.';

CREATE OR REPLACE FUNCTION trg_set_drug_entity_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type text;
BEGIN
  v_type := classify_drug_entity_type(NEW.generic_name, NEW.atc_code, NEW.resolved_inn);
  -- Only SET on a positive 3a match; leave existing/other values (incl. NULL
  -- and any future 3b value) untouched.
  IF v_type IS NOT NULL THEN
    NEW.entity_type := v_type;
  END IF;
  RETURN NEW;
END
$$;

-- Fire on the columns the classifier reads. resolved_inn is included so that if
-- a row later gains an INN it can be re-evaluated on that write (the function
-- still won't UNSET a stale doc tag — see DOWN/notes — but docs don't resolve in
-- practice, so this is a non-issue; kept simple to avoid clobbering 3b).
DROP TRIGGER IF EXISTS set_drug_entity_type ON drugs;
CREATE TRIGGER set_drug_entity_type
  BEFORE INSERT OR UPDATE OF generic_name, atc_code, resolved_inn ON drugs
  FOR EACH ROW EXECUTE FUNCTION trg_set_drug_entity_type();

-- ── Backfill the existing 8 rows ────────────────────────────────────────────
-- Idempotent: re-running only ever (re)sets the same matched rows; everything
-- else is left NULL. Direct column write (not via the UPDATE-OF trigger).
UPDATE drugs
   SET entity_type = classify_drug_entity_type(generic_name, atc_code, resolved_inn)
 WHERE classify_drug_entity_type(generic_name, atc_code, resolved_inn) IS NOT NULL
   AND entity_type IS DISTINCT FROM
       classify_drug_entity_type(generic_name, atc_code, resolved_inn);

-- ============================================================================
-- DOWN (reverse this migration):
--   DROP TRIGGER IF EXISTS set_drug_entity_type ON drugs;
--   DROP FUNCTION IF EXISTS trg_set_drug_entity_type();
--   DROP FUNCTION IF EXISTS classify_drug_entity_type(text, text, text);
--   DROP INDEX IF EXISTS idx_drugs_entity_type_excluded;
--   ALTER TABLE drugs DROP COLUMN IF EXISTS entity_type;
-- Additive + reversible. No molecule data is touched; only the new column and
-- its classifier objects exist to remove.
-- ============================================================================

-- ── Verification (post-apply) ───────────────────────────────────────────────
-- Column exists, nullable, CHECK present:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name='drugs' AND column_name='entity_type';
--   Expected: entity_type | text | YES
--
-- Exactly the expected handful got tagged, nothing carrying an ATC/INN:
--   SELECT entity_type, COUNT(*) FROM drugs
--   WHERE entity_type IS NOT NULL GROUP BY entity_type;
--   Expected (today): export_only 1, reference_document 7  (≈8 total)
--
--   SELECT generic_name, entity_type, atc_code, resolved_inn FROM drugs
--   WHERE entity_type IN ('reference_document','export_only') ORDER BY entity_type;
--   Expected: every row has atc_code NULL AND resolved_inn NULL (export_only
--   may carry identity, but today's single export row does not).
--
-- Trigger self-tags new noise (smoke test, then delete):
--   INSERT INTO drugs (generic_name) VALUES ('Some New Drug Interaction Notice')
--     RETURNING generic_name, entity_type;   -- expect reference_document
--   DELETE FROM drugs WHERE generic_name = 'Some New Drug Interaction Notice';
