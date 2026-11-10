-- ============================================================================
-- Migration 073: who_essential_medicines.on_current_list
-- ============================================================================
-- The eEML /medicines index is NOT the Model List. Of 1,100 records
-- (imported 2026-10-25) only 541 are on the current list:
--   • status 'RemovedFromEml' / 'ApplicationRejected' rows still carry a
--     core/complementary recommendation (the listing they had or applied for),
--   • ~310 rows are AWaRe antibiotic classifications only (incl. the WHO
--     "Not Recommended" group) with no listing at all,
--   • ~110 'AddedToEml' rows have no recommendation of their own — square-box
--     therapeutic alternatives (atorvastatin "used as an alternative to
--     simvastatin").
-- A medicine is on the current list iff status = 'AddedToEml' AND it has a
-- core/complementary recommendation. This column is the one definition every
-- consumer (importer drugs flag, badges, risk score) must use.
-- ============================================================================

ALTER TABLE who_essential_medicines
  ADD COLUMN IF NOT EXISTS on_current_list BOOLEAN
  GENERATED ALWAYS AS (raw->>'status' = 'AddedToEml' AND eml_list IS NOT NULL) STORED;

COMMENT ON COLUMN who_essential_medicines.on_current_list IS
  'TRUE only for medicines on the current WHO Model List (eEML status AddedToEml with a core/complementary recommendation). Removed, rejected, AWaRe-only and square-box-alternative records are FALSE.';

-- Verification:
--   SELECT on_current_list, eml_list, count(*) FROM who_essential_medicines GROUP BY 1, 2;
--   -- expect TRUE: core 423, complementary 118
