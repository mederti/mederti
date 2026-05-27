-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035 — External drug identifiers (CAS + EMA product number)
--
-- The drugs table already carries rxcui, snomed_ct_code, unii, chembl_id
-- (added in migration 024). This adds two more identifiers that procurement
-- teams and regulators actually use:
--
--   cas_number          — CAS Registry Number (e.g. "134523-00-5" for
--                         atorvastatin). Universal chemistry identifier;
--                         RxNav exposes it for free via the property API,
--                         so the rxnorm_backfill importer can populate it
--                         alongside UNII without a new data source.
--
--   ema_product_number  — EMA's EPAR procedure number (e.g. "EMEA/H/C/000509"
--                         for Sortis/atorvastatin centrally-authorized
--                         products). Populated separately by the EMA EPAR
--                         importer.
--
-- Non-unique indexes — Mederti has multiple `drugs` rows per chemical entity
-- (different scrapers ingest the same INN as separate rows). Each row needs
-- to be able to reference the same CAS / EMEA number. A UNIQUE index here
-- (as in the first cut of this migration) only papers over the dedup issue
-- by rejecting legitimate cross-references — see migration 037 which fixes
-- that on the live DB.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE drugs
  ADD COLUMN IF NOT EXISTS cas_number TEXT,
  ADD COLUMN IF NOT EXISTS ema_product_number TEXT;

CREATE INDEX IF NOT EXISTS idx_drugs_cas_number
  ON drugs (cas_number) WHERE cas_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drugs_ema_product_number
  ON drugs (ema_product_number) WHERE ema_product_number IS NOT NULL;

COMMENT ON COLUMN drugs.cas_number IS
  'CAS Registry Number (Chemical Abstracts Service). Populated by rxnorm_backfill from RxNav property API.';
COMMENT ON COLUMN drugs.ema_product_number IS
  'EMA EPAR procedure number (e.g. EMEA/H/C/000509). Populated by ema_epar_importer for centrally-authorized products.';
