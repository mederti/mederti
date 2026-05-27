-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 038 — Trigram GIN indexes on autocomplete hot columns
--
-- The autocomplete endpoint (frontend/app/api/drug-autocomplete) runs
-- `ilike '%q%'` in parallel against three tables on every keystroke:
--
--   drugs.generic_name             (16k rows)
--   drug_catalogue.generic_name    (161k rows)
--   drug_products.product_name     (217k rows)
--
-- None of these columns had an index that Postgres could use for
-- leading-wildcard ilike, so each keystroke triggered three sequential
-- scans across ~394k rows. Measured p50 was ~600–750ms warm.
--
-- pg_trgm GIN indexes accelerate ilike '%q%' (case-insensitive — the
-- trigram opclass normalises internally). The extension is already
-- enabled (migration 001 / 011).
--
-- Existing trigram indexes:
--   idx_drugs_generic_trgm — on drugs.generic_name_normalised (the
--     route queries generic_name, not the normalised column, so this
--     index goes unused here). We index the raw column so the existing
--     route benefits without a code change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_drugs_generic_name_trgm
  ON drugs USING GIN (generic_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_drug_catalogue_generic_name_trgm
  ON drug_catalogue USING GIN (generic_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_drug_products_product_name_trgm
  ON drug_products USING GIN (product_name gin_trgm_ops);
