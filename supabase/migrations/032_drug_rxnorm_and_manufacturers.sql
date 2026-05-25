-- Migration 032: RxNorm mapping table + Manufacturer directory (Path A 2/3 + 3/3)
--
-- Two new ingestion targets:
--   1. drug_rxnorm — links every Mederti drug to its canonical US RxNorm
--      identifier (RxCUI) so we can interoperate with US clinical systems
--      and pull related-ingredient / brand-equivalence data on demand.
--   2. api_manufacturers — directory of API (active pharmaceutical ingredient)
--      manufacturers harvested from PharmaCompass / api-data.com. Provides
--      the substrate for manufacturer concentration risk scoring.

-- ── 1. drug_rxnorm ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drug_rxnorm (
  drug_id            UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  rxcui              TEXT NOT NULL,
  rxnorm_name        TEXT,
  rxnorm_tty         TEXT,             -- term type: IN (ingredient), BN (brand), SCD (clinical drug)
  ingredient_rxcuis  TEXT[] DEFAULT '{}'::TEXT[],
  brand_rxcuis       TEXT[] DEFAULT '{}'::TEXT[],
  atc_from_rxnorm    TEXT,             -- cross-check vs our regulator-sourced atc_code
  imported_at        TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (drug_id, rxcui)
);

CREATE INDEX IF NOT EXISTS idx_drug_rxnorm_rxcui ON drug_rxnorm (rxcui);
CREATE INDEX IF NOT EXISTS idx_drug_rxnorm_drug  ON drug_rxnorm (drug_id);

ALTER TABLE drug_rxnorm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drug_rxnorm_public_read" ON drug_rxnorm;
CREATE POLICY "drug_rxnorm_public_read" ON drug_rxnorm
  FOR SELECT USING (true);


-- ── 2. api_manufacturers ──────────────────────────────────────────────────
-- Maps APIs (active pharmaceutical ingredients) to their qualified manufacturers.
-- Source: PharmaCompass / api-data.com public directory.
CREATE TABLE IF NOT EXISTS api_manufacturers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name            TEXT NOT NULL,          -- e.g. "Metformin Hydrochloride"
  api_name_normalized TEXT NOT NULL,          -- lowercased, trimmed, used for matching
  manufacturer_name   TEXT NOT NULL,
  country             TEXT,
  country_code        CHAR(2),
  dmf_count           INTEGER DEFAULT 0,      -- Drug Master File filings
  cep_count           INTEGER DEFAULT 0,      -- EU Certificate of Suitability count
  written_confirmations INTEGER DEFAULT 0,
  source_url          TEXT,
  source              TEXT DEFAULT 'pharmacompass',
  imported_at         TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (api_name_normalized, manufacturer_name, country)
);

CREATE INDEX IF NOT EXISTS idx_api_manufacturers_api          ON api_manufacturers (api_name_normalized);
CREATE INDEX IF NOT EXISTS idx_api_manufacturers_country      ON api_manufacturers (country_code);
CREATE INDEX IF NOT EXISTS idx_api_manufacturers_manufacturer ON api_manufacturers (manufacturer_name);

ALTER TABLE api_manufacturers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_manufacturers_public_read" ON api_manufacturers;
CREATE POLICY "api_manufacturers_public_read" ON api_manufacturers
  FOR SELECT USING (true);

-- ── 3. api_supply_summary ────────────────────────────────────────────────
-- Aggregate counts per active pharmaceutical ingredient: total suppliers,
-- DMF filings by jurisdiction, EU written confirmations, etc.
-- Source: PharmaCompass active-pharmaceutical-ingredients pages.
CREATE TABLE IF NOT EXISTS api_supply_summary (
  api_name_normalized   TEXT PRIMARY KEY,
  api_name_display      TEXT NOT NULL,
  total_suppliers       INTEGER DEFAULT 0,
  usdmf_count           INTEGER DEFAULT 0,  -- US Drug Master Files
  cep_count             INTEGER DEFAULT 0,  -- EU Certificate of Suitability
  jdmf_count            INTEGER DEFAULT 0,  -- Japan DMF
  kdmf_count            INTEGER DEFAULT 0,  -- Korea DMF
  eu_wc_count           INTEGER DEFAULT 0,  -- EU Written Confirmations
  ndc_count             INTEGER DEFAULT 0,  -- US NDC entries
  drugs_in_development  INTEGER DEFAULT 0,
  source_url            TEXT,
  imported_at           TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_supply_summary_suppliers
  ON api_supply_summary (total_suppliers DESC);

ALTER TABLE api_supply_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_supply_summary_public_read" ON api_supply_summary;
CREATE POLICY "api_supply_summary_public_read" ON api_supply_summary
  FOR SELECT USING (true);


-- View: manufacturer concentration per drug.
-- Joins drugs → api_manufacturers via fuzzy generic-name match.
-- "How many qualified manufacturers exist for this API and where?"
CREATE OR REPLACE VIEW v_drug_manufacturer_concentration AS
SELECT
  d.id           AS drug_id,
  d.generic_name,
  -- Prefer per-maker counts when we have them; otherwise fall back to
  -- the PharmaCompass aggregate total_suppliers number.
  COALESCE(
    NULLIF(COUNT(DISTINCT am.manufacturer_name), 0),
    sm.total_suppliers,
    0
  )::INTEGER                                          AS manufacturer_count,
  COUNT(DISTINCT am.country_code)                     AS country_count_per_maker,
  SUM(am.dmf_count)                                   AS total_dmfs_per_maker,
  SUM(am.cep_count)                                   AS total_ceps_per_maker,
  sm.usdmf_count,
  sm.cep_count                                        AS aggregate_cep_count,
  sm.eu_wc_count,
  ARRAY_AGG(DISTINCT am.country_code) FILTER (WHERE am.country_code IS NOT NULL) AS countries,
  CASE
    WHEN COALESCE(NULLIF(COUNT(DISTINCT am.manufacturer_name), 0), sm.total_suppliers, 0) = 0 THEN 'unknown'
    WHEN COALESCE(NULLIF(COUNT(DISTINCT am.manufacturer_name), 0), sm.total_suppliers, 0) <= 2  THEN 'high_risk'
    WHEN COALESCE(NULLIF(COUNT(DISTINCT am.manufacturer_name), 0), sm.total_suppliers, 0) <= 5  THEN 'moderate_risk'
    ELSE 'low_risk'
  END                                                 AS concentration_risk
FROM drugs d
LEFT JOIN api_manufacturers am
  ON am.api_name_normalized = LOWER(TRIM(d.generic_name))
LEFT JOIN api_supply_summary sm
  ON sm.api_name_normalized = LOWER(TRIM(d.generic_name))
GROUP BY d.id, d.generic_name, sm.total_suppliers, sm.usdmf_count, sm.cep_count, sm.eu_wc_count;

GRANT SELECT ON v_drug_manufacturer_concentration TO anon, authenticated;
