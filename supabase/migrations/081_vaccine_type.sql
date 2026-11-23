-- 081_vaccine_type.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- drugs.vaccine_type groups the many records one vaccine arrives under
-- (Boostrix Polio alone has Norwegian, Dutch, French and Slovenian records)
-- so pages can show every shortage notice for a vaccine type together.
--
-- Grouping, not merging: scrapers resolve drugs by exact generic name, so
-- re-pointing shortage rows to one canonical record would make the next
-- scrape mint duplicates under the original record. A type key moves nothing.
--
-- Set by backend/scripts/classify_vaccines.py from backend/utils/vaccine_types.py
-- (strict: ambiguous records stay NULL). Keys are Mederti slugs
-- ("dtap-ipv", "pcv", "mmr"), not ATC codes; vaccine_type_name is the
-- English display name.
--
-- Additive and idempotent; safe to re-run.
--
-- APPLIED TO PRODUCTION 2026-11-23 via `supabase db query --linked -f`;
-- classify_vaccines --execute typed 177 of 181 vaccine records (44 types).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE drugs ADD COLUMN IF NOT EXISTS vaccine_type text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS vaccine_type_name text;

COMMENT ON COLUMN drugs.vaccine_type IS
  'Vaccine grouping key (e.g. dtap-ipv); NULL when not a vaccine or not certain. See backend/utils/vaccine_types.py.';
COMMENT ON COLUMN drugs.vaccine_type_name IS
  'English display name for drugs.vaccine_type.';

CREATE INDEX IF NOT EXISTS idx_drugs_vaccine_type ON drugs (vaccine_type) WHERE vaccine_type IS NOT NULL;
