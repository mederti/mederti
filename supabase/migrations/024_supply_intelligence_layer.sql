-- ============================================================================
-- Migration 024: Supply Intelligence Layer
-- ============================================================================
-- Adds the foundation for the four key questions the platform must answer:
--   1. Where is the medicine?           — drug_pricing_history, NHS Drug Tariff
--   2. Can it legally be used here?     — drug_approvals (Drugs@FDA, EPAR)
--   3. How reliable is the supply?      — manufacturing_facilities, api_suppliers
--   4. What alternatives exist?         — therapeutic_equivalence (TE codes)
-- ============================================================================

-- ── 1. Manufacturing facilities (FDA inspections + EMA EudraGMDP) ──────────
CREATE TABLE IF NOT EXISTS manufacturing_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fei_number TEXT,                       -- FDA FEI (Facility Establishment Identifier)
  duns_number TEXT,                      -- EU DUNS / EU GMP cert reference
  facility_name TEXT NOT NULL,
  company_name TEXT,
  country TEXT,                          -- ISO-2
  state_or_region TEXT,
  city TEXT,
  facility_type TEXT,                    -- API, finished_dose, packaging, biotech, etc.
  -- Latest inspection state (FDA dashboard)
  last_inspection_date DATE,
  last_inspection_classification TEXT
    CHECK (last_inspection_classification IN ('NAI','VAI','OAI','unknown')),
  inspection_count_5y INTEGER DEFAULT 0,
  oai_count_5y INTEGER DEFAULT 0,        -- "Official Action Indicated" — most serious
  -- Latest GMP certificate state (EMA EudraGMDP)
  gmp_certified BOOLEAN,
  gmp_expiry_date DATE,
  gmp_authority TEXT,                    -- EMA / FDA / MHRA / TGA / Health Canada / WHO PQ
  warning_letter_count_5y INTEGER DEFAULT 0,
  import_alert_active BOOLEAN DEFAULT FALSE,
  import_alert_number TEXT,
  source TEXT,                           -- 'fda_dashboard' / 'eudragmdp' / 'who_pq'
  source_url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_fei
  ON manufacturing_facilities (fei_number) WHERE fei_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facility_country
  ON manufacturing_facilities (country);
CREATE INDEX IF NOT EXISTS idx_facility_classification
  ON manufacturing_facilities (last_inspection_classification)
  WHERE last_inspection_classification = 'OAI';
CREATE INDEX IF NOT EXISTS idx_facility_company
  ON manufacturing_facilities (company_name);


-- ── 2. API suppliers (PharmaCompass / api-data.com) ────────────────────────
CREATE TABLE IF NOT EXISTS api_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  generic_name TEXT NOT NULL,            -- INN / API name
  manufacturer_name TEXT NOT NULL,
  facility_id UUID REFERENCES manufacturing_facilities(id) ON DELETE SET NULL,
  country TEXT,                          -- where the API is made
  capabilities TEXT[],                   -- ['DMF holder', 'CEP holder', 'WHO PQ']
  cep_holder BOOLEAN DEFAULT FALSE,      -- EU Certificate of Suitability
  dmf_holder BOOLEAN DEFAULT FALSE,      -- US Drug Master File
  who_pq BOOLEAN DEFAULT FALSE,
  source TEXT,
  source_url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_suppliers_drug ON api_suppliers (drug_id);
CREATE INDEX IF NOT EXISTS idx_api_suppliers_inn ON api_suppliers (lower(generic_name));
CREATE INDEX IF NOT EXISTS idx_api_suppliers_country ON api_suppliers (country);


-- ── 3. Drug approvals (Drugs@FDA, EMA EPAR, MHRA, TGA approvals) ────────────
CREATE TABLE IF NOT EXISTS drug_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  generic_name TEXT,
  brand_name TEXT,
  authority TEXT NOT NULL                -- FDA / EMA / MHRA / TGA / Health Canada / PMDA
    CHECK (authority IN ('FDA','EMA','MHRA','TGA','HC','PMDA','HSA','Other')),
  application_number TEXT,                -- NDA/BLA/MAA/ARTG number
  application_type TEXT,                  -- NDA, BLA, ANDA, biosimilar, OTC, etc.
  approval_date DATE,
  status TEXT,                            -- approved, withdrawn, suspended, etc.
  applicant_name TEXT,
  marketing_authorisation_holder TEXT,
  -- Therapeutic Equivalence (Orange Book)
  te_code TEXT,                           -- AB, AB1, AA, BX, etc.
  reference_listed_drug TEXT,
  -- Indication
  indication TEXT,
  -- Source
  source_url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_drug_approval
  ON drug_approvals (authority, application_number) WHERE application_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_drug ON drug_approvals (drug_id);
CREATE INDEX IF NOT EXISTS idx_approval_authority ON drug_approvals (authority);
CREATE INDEX IF NOT EXISTS idx_approval_te ON drug_approvals (te_code) WHERE te_code IS NOT NULL;


-- ── 4. Drug pricing history (NHS Drug Tariff, OECD comparators) ─────────────
CREATE TABLE IF NOT EXISTS drug_pricing_history (
  id BIGSERIAL PRIMARY KEY,
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  generic_name TEXT,
  product_name TEXT,
  pack_description TEXT,                  -- "100 tablets", "30 capsules 500mg"
  -- The price record
  country TEXT NOT NULL,                  -- ISO-2
  authority TEXT,                         -- 'NHS-BSA', 'OECD', 'PBS'
  price_type TEXT NOT NULL                -- 'tariff', 'concession', 'list', 'wac', 'amp'
    CHECK (price_type IN ('tariff','concession','list','wac','amp','reimbursement','tender','other')),
  category TEXT,                          -- NHS Cat M, Cat A, Cat C, etc.
  unit_price NUMERIC,
  currency TEXT NOT NULL DEFAULT 'GBP',
  pack_price NUMERIC,
  effective_date DATE NOT NULL,           -- first day this price applies
  expires_date DATE,                      -- if known (e.g. month boundary)
  source TEXT,
  source_url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_drug
  ON drug_pricing_history (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricing_country_date
  ON drug_pricing_history (country, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_concession
  ON drug_pricing_history (effective_date DESC) WHERE price_type = 'concession';


-- ── 5. Therapeutic equivalence groupings (clinical alternatives) ────────────
CREATE TABLE IF NOT EXISTS therapeutic_equivalents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  alternative_drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  equivalence_type TEXT NOT NULL          -- generic_substitute, therapeutic_alternative, biosimilar
    CHECK (equivalence_type IN ('generic_substitute','therapeutic_alternative','biosimilar','same_class')),
  evidence_level TEXT,                    -- A / B / C / expert_consensus
  notes TEXT,
  source TEXT,                            -- FDA_orange_book / clinician / who_eml
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (drug_id <> alternative_drug_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_equivalence
  ON therapeutic_equivalents (drug_id, alternative_drug_id, equivalence_type);
CREATE INDEX IF NOT EXISTS idx_equiv_drug ON therapeutic_equivalents (drug_id);


-- ── 6. Add identity / cross-reference codes to drugs table ─────────────────
ALTER TABLE drugs
  ADD COLUMN IF NOT EXISTS rxcui TEXT,                      -- RxNorm concept unique identifier (US)
  ADD COLUMN IF NOT EXISTS snomed_ct_code TEXT,             -- SNOMED CT concept
  ADD COLUMN IF NOT EXISTS unii TEXT,                       -- FDA UNII (substance identifier)
  ADD COLUMN IF NOT EXISTS chembl_id TEXT,
  ADD COLUMN IF NOT EXISTS atc_code_full TEXT,              -- full L1.L2.L3.L4.L5 chain
  ADD COLUMN IF NOT EXISTS critical_medicine_eu BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS who_pq_count INTEGER DEFAULT 0;  -- count of WHO-prequalified manufacturers

CREATE INDEX IF NOT EXISTS idx_drugs_rxcui ON drugs (rxcui) WHERE rxcui IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drugs_atc ON drugs (atc_code_full) WHERE atc_code_full IS NOT NULL;


-- ── RLS Policies (all public-read for these regulatory data) ───────────────
ALTER TABLE manufacturing_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_approvals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_pricing_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapeutic_equivalents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facilities_public_read" ON manufacturing_facilities;
CREATE POLICY "facilities_public_read" ON manufacturing_facilities FOR SELECT USING (true);

DROP POLICY IF EXISTS "api_suppliers_public_read" ON api_suppliers;
CREATE POLICY "api_suppliers_public_read" ON api_suppliers FOR SELECT USING (true);

DROP POLICY IF EXISTS "approvals_public_read" ON drug_approvals;
CREATE POLICY "approvals_public_read" ON drug_approvals FOR SELECT USING (true);

DROP POLICY IF EXISTS "pricing_public_read" ON drug_pricing_history;
CREATE POLICY "pricing_public_read" ON drug_pricing_history FOR SELECT USING (true);

DROP POLICY IF EXISTS "equiv_public_read" ON therapeutic_equivalents;
CREATE POLICY "equiv_public_read" ON therapeutic_equivalents FOR SELECT USING (true);

-- ── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_supply_intel_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facilities_updated ON manufacturing_facilities;
CREATE TRIGGER facilities_updated BEFORE UPDATE ON manufacturing_facilities
  FOR EACH ROW EXECUTE FUNCTION update_supply_intel_updated_at();

DROP TRIGGER IF EXISTS api_suppliers_updated ON api_suppliers;
CREATE TRIGGER api_suppliers_updated BEFORE UPDATE ON api_suppliers
  FOR EACH ROW EXECUTE FUNCTION update_supply_intel_updated_at();

DROP TRIGGER IF EXISTS approvals_updated ON drug_approvals;
CREATE TRIGGER approvals_updated BEFORE UPDATE ON drug_approvals
  FOR EACH ROW EXECUTE FUNCTION update_supply_intel_updated_at();

COMMENT ON TABLE manufacturing_facilities IS 'FDA inspection results + EMA EudraGMDP — drives Force #4 (Fragile Manufacturing) signals';
COMMENT ON TABLE api_suppliers           IS 'Active pharmaceutical ingredient manufacturer mapping (PharmaCompass + DMF/CEP/WHO PQ)';
COMMENT ON TABLE drug_approvals          IS 'Drugs@FDA, EMA EPAR, MHRA, TGA approvals — answers "Can it be used here?"';
COMMENT ON TABLE drug_pricing_history    IS 'NHS Drug Tariff + OECD comparators — Force #2 (Price = Supply Decision)';
COMMENT ON TABLE therapeutic_equivalents IS 'Generic substitution + therapeutic alternatives — answers "What alternatives exist?"';
