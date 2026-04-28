-- ============================================================================
-- Migration 023: Pipeline + Regulatory Calendar
-- ============================================================================
-- Adds two tables that turn Mederti from a shortage tracker into a forward-
-- looking supply intelligence platform:
--
--   regulatory_events  — FDA AdComm, PDUFA, EMA CHMP, MHRA EAMS, TGA AUSPAR
--                        events keyed to drugs in our catalogue.
--   clinical_trials    — ClinicalTrials.gov Phase III interventions on drugs
--                        in our catalogue (predicts approvals 12-18 months out).
-- ============================================================================

CREATE TABLE IF NOT EXISTS regulatory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'fda_pdufa',         -- FDA action date (decision deadline)
    'fda_adcomm',        -- FDA Advisory Committee meeting
    'fda_approval',      -- FDA approval announced
    'ema_chmp',          -- EMA Committee for Human Medicinal Products meeting
    'ema_approval',      -- EMA marketing authorisation
    'mhra_decision',     -- MHRA medicines decision
    'mhra_eams',         -- UK Early Access to Medicines Scheme designation
    'tga_auspar',        -- TGA evaluation report published
    'tga_approval',      -- TGA registration
    'other'
  )),
  event_date DATE,                    -- when the event occurs/occurred
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  generic_name TEXT,                   -- INN for matching even if drug_id is null
  brand_name TEXT,
  sponsor TEXT,                        -- pharma company applicant
  indication TEXT,                     -- disease/condition
  description TEXT,
  outcome TEXT CHECK (outcome IN ('scheduled', 'approved', 'rejected', 'postponed', 'withdrawn', 'unknown')) DEFAULT 'scheduled',
  source_url TEXT,
  source_country TEXT,                 -- US/EU/GB/AU
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency: same drug + event type + date should not duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uniq_regulatory_event
  ON regulatory_events (event_type, COALESCE(drug_id::text, generic_name), event_date)
  WHERE event_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_regulatory_events_drug
  ON regulatory_events (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regulatory_events_date
  ON regulatory_events (event_date DESC) WHERE event_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regulatory_events_upcoming
  ON regulatory_events (event_date) WHERE event_date >= CURRENT_DATE AND outcome = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_regulatory_events_country
  ON regulatory_events (source_country, event_date DESC);


CREATE TABLE IF NOT EXISTS clinical_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nct_id TEXT UNIQUE NOT NULL,         -- ClinicalTrials.gov NCT identifier
  drug_id UUID REFERENCES drugs(id) ON DELETE SET NULL,
  intervention_name TEXT,              -- raw intervention text (drug/biologic name)
  brief_title TEXT,
  sponsor TEXT,
  phase TEXT,                          -- 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'N/A'
  overall_status TEXT,                 -- recruiting/active_not_recruiting/completed/terminated
  primary_completion_date DATE,
  start_date DATE,
  conditions TEXT[],
  countries TEXT[],
  results_first_posted DATE,
  enrollment_count INTEGER,
  source_url TEXT,
  raw_data JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_trials_drug
  ON clinical_trials (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinical_trials_phase
  ON clinical_trials (phase) WHERE phase IN ('Phase 3', 'Phase 4');
CREATE INDEX IF NOT EXISTS idx_clinical_trials_completion
  ON clinical_trials (primary_completion_date) WHERE primary_completion_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinical_trials_active
  ON clinical_trials (overall_status, primary_completion_date);


-- ── Public read access (no RLS — these are public domain regulatory data) ──
ALTER TABLE regulatory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_trials   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regulatory_events_public_read" ON regulatory_events;
CREATE POLICY "regulatory_events_public_read" ON regulatory_events
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "clinical_trials_public_read" ON clinical_trials;
CREATE POLICY "clinical_trials_public_read" ON clinical_trials
  FOR SELECT USING (true);


-- Helper: refresh updated_at timestamps automatically
CREATE OR REPLACE FUNCTION update_regulatory_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS regulatory_events_updated_at ON regulatory_events;
CREATE TRIGGER regulatory_events_updated_at
  BEFORE UPDATE ON regulatory_events
  FOR EACH ROW EXECUTE FUNCTION update_regulatory_events_updated_at();

COMMENT ON TABLE regulatory_events IS 'FDA/EMA/MHRA/TGA regulatory events: PDUFA dates, advisory committee meetings, approvals';
COMMENT ON TABLE clinical_trials  IS 'ClinicalTrials.gov Phase III interventions matched to drugs in our catalogue';

-- ── WHO Essential Medicines flag on drugs table ──
ALTER TABLE drugs
  ADD COLUMN IF NOT EXISTS who_essential_medicine BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS who_eml_section TEXT,
  ADD COLUMN IF NOT EXISTS who_eml_year INTEGER;

CREATE INDEX IF NOT EXISTS idx_drugs_who_eml ON drugs (who_essential_medicine) WHERE who_essential_medicine = TRUE;

-- ── UN Comtrade pharmaceutical trade flows ──
CREATE TABLE IF NOT EXISTS pharma_trade_flows (
  id BIGSERIAL PRIMARY KEY,
  reporter_country TEXT NOT NULL,    -- exporting country (ISO3)
  partner_country  TEXT NOT NULL,    -- importing country (ISO3)
  hs_code TEXT NOT NULL,             -- '30' for pharmaceuticals (or 6-digit subcat)
  hs_description TEXT,
  flow_type TEXT CHECK (flow_type IN ('import', 'export', 're-import', 're-export')),
  period DATE NOT NULL,              -- monthly bucket (1st of month)
  trade_value_usd NUMERIC,           -- cumulative monthly value
  net_weight_kg NUMERIC,
  source TEXT DEFAULT 'comtrade',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reporter_country, partner_country, hs_code, flow_type, period)
);

CREATE INDEX IF NOT EXISTS idx_pharma_trade_period ON pharma_trade_flows (period DESC);
CREATE INDEX IF NOT EXISTS idx_pharma_trade_reporter ON pharma_trade_flows (reporter_country, period DESC);

ALTER TABLE pharma_trade_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pharma_trade_public_read" ON pharma_trade_flows;
CREATE POLICY "pharma_trade_public_read" ON pharma_trade_flows
  FOR SELECT USING (true);

COMMENT ON TABLE pharma_trade_flows IS 'UN Comtrade pharmaceutical trade flows (HS code 30) — bilateral, monthly';
