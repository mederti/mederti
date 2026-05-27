-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 — Relax external-identifier uniqueness on drugs
--
-- Migration 035 added drugs.cas_number and drugs.ema_product_number with
-- partial UNIQUE indexes. The first EMA EPAR backfill run revealed that
-- Mederti has multiple `drugs` rows per chemical entity (different scrapers
-- ingest the same INN as separate rows), so unique constraints reject
-- legitimate cross-references — 223/812 patches failed with HTTP 409 in
-- the first run.
--
-- The right long-term fix is to dedupe `drugs` so 1 entity = 1 row, but
-- until that lands we drop the unique constraints and replace them with
-- ordinary lookup indexes. Cross-walking from CAS → drug or EMA → drug
-- now returns a small set instead of erroring on insert.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS uniq_drugs_cas_number;
DROP INDEX IF EXISTS uniq_drugs_ema_product_number;

CREATE INDEX IF NOT EXISTS idx_drugs_cas_number
  ON drugs (cas_number) WHERE cas_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drugs_ema_product_number
  ON drugs (ema_product_number) WHERE ema_product_number IS NOT NULL;
