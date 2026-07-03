-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 067 — trigram index on drug_pricing_history.generic_name
--
-- The NADAC 18-month backfill (2026-07-03) grew drug_pricing_history from
-- ~110k to ~600k rows. The generic_name ILIKE fallback used by the drug page
-- (buildMarketPricing) and /api/insights/price-trends now seq-scans and dies
-- on the statement timeout (57014). The code was made resilient (drug_id-first,
-- name fallback best-effort) — this index makes the fallback actually work for
-- price rows that never resolved to a drug_id (unlinked-variant case, e.g.
-- Mometasone / Pregabalin GB history).
--
-- pg_trgm is already enabled (011 / 038 / 053), but guard anyway.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pricing_generic_name_trgm
    ON drug_pricing_history USING gin (generic_name gin_trgm_ops);

-- Also cover the (country, effective_date) read path the trends route uses
-- with drug_id — 024 indexed (country, effective_date DESC) and (drug_id)
-- separately; the composite below serves "this drug in this market ordered by
-- date" without a sort node.
CREATE INDEX IF NOT EXISTS idx_pricing_drug_country_date
    ON drug_pricing_history (drug_id, country, effective_date);
