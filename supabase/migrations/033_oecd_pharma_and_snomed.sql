-- Migration 033: OECD pharmaceutical macro data + SNOMED CT scaffold (Path B)
--
-- Two new ingestion targets:
--   1. oecd_pharma_metrics — pharmaceutical sales / consumption / generic
--      share by country × ATC class × year, from OECD Health Statistics.
--      This is the reference-pricing baseline for the Procurement view's
--      trade-price tile until commercial wholesaler feeds (Sigma · Symbion)
--      are connected.
--
--   2. snomed_concepts — schema only. Full SNOMED CT data requires a
--      jurisdiction-specific affiliate license; the scaffold is in place
--      so an importer can populate it once the AU/UK/NZ license is granted.

-- ── 1. oecd_pharma_metrics ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oecd_pharma_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code3     CHAR(3) NOT NULL,          -- ISO 3166-1 alpha-3 (OECD format)
  country_code2     CHAR(2),                   -- mapped to alpha-2 for join with our tables
  country_name      TEXT NOT NULL,
  year              SMALLINT NOT NULL,
  atc_code          TEXT,                      -- "N02", "A10", "C09", etc. NULL for "_T" total
  atc_label         TEXT NOT NULL,
  measure           TEXT NOT NULL,             -- 'PH_SALES' | 'PH_CON' | 'PH_MARKET'
  measure_label     TEXT NOT NULL,
  unit              TEXT NOT NULL,             -- 'XDC' | 'USD_EXC' | 'USD_PPP_PS' | 'USD_PPP' | etc.
  unit_label        TEXT NOT NULL,
  market_type       TEXT,                      -- '_T' total, 'TPP' third-party, 'COMMUNITY' etc.
  value             NUMERIC(18,4) NOT NULL,
  source            TEXT NOT NULL DEFAULT 'OECD-HEALTH_PHMC',
  imported_at       TIMESTAMPTZ DEFAULT now(),

  UNIQUE (country_code3, year, atc_code, measure, unit, market_type)
);

CREATE INDEX IF NOT EXISTS idx_oecd_pharma_country ON oecd_pharma_metrics (country_code2, year);
CREATE INDEX IF NOT EXISTS idx_oecd_pharma_atc     ON oecd_pharma_metrics (atc_code, year);
CREATE INDEX IF NOT EXISTS idx_oecd_pharma_measure ON oecd_pharma_metrics (measure);

ALTER TABLE oecd_pharma_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oecd_pharma_metrics_public_read" ON oecd_pharma_metrics;
CREATE POLICY "oecd_pharma_metrics_public_read" ON oecd_pharma_metrics
  FOR SELECT USING (true);

-- View: latest per-country pharmaceutical spending per capita (USD PPP).
-- The Procurement view consumes this to show a market-size benchmark
-- alongside (or in place of) per-drug trade prices.
CREATE OR REPLACE VIEW v_country_pharma_spend_latest AS
SELECT DISTINCT ON (country_code2)
  country_code2,
  country_name,
  year,
  value AS spending_usd_ppp_per_capita
FROM oecd_pharma_metrics
WHERE measure = 'PH_SALES'
  AND unit    = 'USD_PPP_PS'
  AND atc_code IS NULL                         -- total, not by ATC class
  AND market_type = '_T'
  AND country_code2 IS NOT NULL
ORDER BY country_code2, year DESC;

GRANT SELECT ON v_country_pharma_spend_latest TO anon, authenticated;

-- View: per-drug benchmark spending in the AU market.
-- For a given drug's ATC code, find the OECD spending bracket. Used by
-- the Procurement view to contextualise a drug's market size.
CREATE OR REPLACE VIEW v_drug_oecd_class_spend AS
SELECT
  d.id          AS drug_id,
  d.generic_name,
  d.atc_code,
  o.country_code2,
  o.year,
  o.measure,
  o.unit,
  o.value
FROM drugs d
JOIN oecd_pharma_metrics o
  ON o.atc_code IS NOT NULL
  AND (
       o.atc_code = d.atc_code
    OR o.atc_code = SUBSTRING(d.atc_code FROM 1 FOR 4)   -- 4-char subgroup
    OR o.atc_code = SUBSTRING(d.atc_code FROM 1 FOR 3)   -- 3-char therapeutic
    OR o.atc_code = SUBSTRING(d.atc_code FROM 1 FOR 1)   -- 1-char anatomical
  )
WHERE d.atc_code IS NOT NULL;

GRANT SELECT ON v_drug_oecd_class_spend TO anon, authenticated;


-- ── 2. snomed_concepts (scaffold only) ────────────────────────────────────
-- SNOMED CT is the international clinical terminology covering 360,000+
-- concepts including every clinical drug. Full ingest requires a
-- jurisdiction-specific affiliate license (free for AU, UK, NZ, US et al.
-- but each country licenses separately via their National Release Centre).
--
-- The schema mirrors the canonical RF2 release format so once the license
-- arrives, the importer drops in without further DDL changes.
CREATE TABLE IF NOT EXISTS snomed_concepts (
  concept_id        BIGINT PRIMARY KEY,        -- SCTID
  effective_time    DATE NOT NULL,             -- yyyymmdd from RF2
  active            BOOLEAN NOT NULL DEFAULT true,
  module_id         BIGINT,                    -- which national extension
  definition_status BIGINT,                    -- primitive vs fully-defined

  -- Resolved descriptions (denormalised for fast read)
  fully_specified_name TEXT,
  preferred_term       TEXT,

  -- Most useful semantic tag for drug concepts:
  --   'product', 'substance', 'clinical drug', 'medicinal product form', etc.
  semantic_tag      TEXT,

  -- Linkage back to Mederti drugs (populated by manual mapping or
  --   automated ATC-bridge resolution once we have both).
  drug_id           UUID REFERENCES drugs(id) ON DELETE SET NULL,

  source            TEXT DEFAULT 'snomed-international',
  imported_at       TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snomed_concepts_active   ON snomed_concepts (active);
CREATE INDEX IF NOT EXISTS idx_snomed_concepts_semantic ON snomed_concepts (semantic_tag);
CREATE INDEX IF NOT EXISTS idx_snomed_concepts_drug     ON snomed_concepts (drug_id);
CREATE INDEX IF NOT EXISTS idx_snomed_concepts_pterm
  ON snomed_concepts USING gin (to_tsvector('english', preferred_term));

ALTER TABLE snomed_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "snomed_concepts_public_read" ON snomed_concepts;
CREATE POLICY "snomed_concepts_public_read" ON snomed_concepts
  FOR SELECT USING (true);

COMMENT ON TABLE snomed_concepts IS
  'Scaffold for SNOMED CT concept ingest. Populated by snomed_importer.py '
  'once a jurisdiction-specific affiliate license is obtained '
  '(free for AU/UK/NZ/US via each country''s National Release Centre).';
