-- ============================================================================
-- Migration 040: regulatory_eligibility table (Sprint 2 PR 3)
-- ============================================================================
-- Closes audit §9 item 12 + cluster E: 8 ⚠ HALLUCINATION RISK questions
-- (SUP-15/16/17/18, RET-08/27, HPR-18) currently rely on the §11 eligibility
-- refusal template because Mederti has no structured eligibility lookup.
-- This table is the substrate for that lookup.
--
-- Pilot scope (per audit roadmap): AU + UK + US + EU. Other countries to
-- follow.
--
-- Schemes covered:
--   • TGA Section 19A — Australia, overseas-registered supply during shortage
--   • MHRA SSP        — UK, Serious Shortage Protocol
--   • DHSC MSN        — UK, Medicine Supply Notification (lighter-weight than SSP)
--   • FDA 503B        — US, outsourcing-facility bulk-list eligibility
--   • FDA shortage    — US, FDA Drug Shortage list (gates many emergency pathways)
--   • EU Art 5(2)     — EU per-country emergency-supply exemption
--   • Other           — extensible
--
-- Idempotent + reversible (DROP TABLE IF EXISTS to revert). No production
-- data is changed by this migration — the table starts empty; scrapers
-- (backend/scrapers/eligibility/*) populate it on their next run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS regulatory_eligibility (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id             UUID REFERENCES drugs(id) ON DELETE SET NULL,
  -- Generic name carried even when drug_id can't be resolved at scrape time
  generic_name        TEXT NOT NULL,
  brand_name          TEXT,
  -- ISO-2 country of the regulator that issued the eligibility
  country_code        CHAR(2) NOT NULL,
  scheme              TEXT NOT NULL CHECK (scheme IN (
    'tga_s19a',
    'mhra_ssp',
    'dhsc_msn',
    'fda_503b',
    'fda_shortage',
    'eu_art_5_2',
    'other'
  )),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'lapsed', 'withdrawn', 'historical'
  )),
  -- Identifier as published by the issuing regulator (e.g. TGA s19A approval
  -- number, NHS BSA SSP reference, FDA shortage list ID).
  scheme_reference    TEXT,
  -- Description text from the regulator's listing — what's permitted, any
  -- conditions (paediatric only, IV only, etc.).
  description         TEXT,
  -- Lifecycle dates the regulator publishes. Nullable individually because
  -- coverage varies by scheme.
  listed_at           DATE,
  expires_at          DATE,
  withdrawn_at        DATE,
  -- Provenance — every row should carry the canonical URL the user can
  -- verify against.
  source_url          TEXT,
  source_name         TEXT,
  -- Original scraper payload kept as JSONB so future enrichment doesn't
  -- require a re-scrape.
  raw_data            JSONB,
  -- Scraper bookkeeping — `last_verified_at` is the staleness signal, same
  -- semantics as shortage_events.last_verified_at.
  last_verified_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness — one row per (scheme, scheme_reference) when the scheme
-- publishes a stable ID; fallback uniqueness on (scheme, generic_name,
-- country_code, listed_at) when it doesn't.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_regulatory_eligibility_ref
  ON regulatory_eligibility (scheme, scheme_reference)
  WHERE scheme_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_regulatory_eligibility_fallback
  ON regulatory_eligibility (scheme, generic_name, country_code, listed_at)
  WHERE scheme_reference IS NULL AND listed_at IS NOT NULL;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_regulatory_eligibility_drug
  ON regulatory_eligibility (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regulatory_eligibility_country_status
  ON regulatory_eligibility (country_code, status);
CREATE INDEX IF NOT EXISTS idx_regulatory_eligibility_scheme_active
  ON regulatory_eligibility (scheme) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_regulatory_eligibility_generic_norm
  ON regulatory_eligibility (lower(generic_name));

-- updated_at trigger
CREATE OR REPLACE FUNCTION regulatory_eligibility_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_regulatory_eligibility_updated_at ON regulatory_eligibility;
CREATE TRIGGER trg_regulatory_eligibility_updated_at
  BEFORE UPDATE ON regulatory_eligibility
  FOR EACH ROW EXECUTE FUNCTION regulatory_eligibility_touch_updated_at();

-- RLS — public read (consistent with reference tables); service_role writes via scrapers.
ALTER TABLE regulatory_eligibility ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "regulatory_eligibility public read" ON regulatory_eligibility;
CREATE POLICY "regulatory_eligibility public read"
  ON regulatory_eligibility FOR SELECT USING (true);

-- Table-level + column-level documentation
COMMENT ON TABLE regulatory_eligibility IS
  'Structured eligibility entries for shortage-specific regulatory pathways (TGA Section 19A, MHRA SSP, FDA 503B + Drug Shortage list, EU Article 5(2)). Replaces the audit §11 eligibility refusal template once populated. Populated by backend/scrapers/eligibility/*; coverage is daily-refresh per scheme.';

COMMENT ON COLUMN regulatory_eligibility.scheme IS
  'Eligibility scheme. tga_s19a = TGA overseas-registered supply approval; mhra_ssp = NHSBSA Serious Shortage Protocol; dhsc_msn = DHSC Medicine Supply Notification (lighter-touch); fda_503b = FDA 503B outsourcing bulk-list eligibility; fda_shortage = FDA Drug Shortage list entry (gates many emergency pathways); eu_art_5_2 = per-country EU emergency-supply exemption; other = catch-all for new schemes pending categorisation.';

COMMENT ON COLUMN regulatory_eligibility.status IS
  'Lifecycle: active (currently in force) | lapsed (expiry passed without renewal) | withdrawn (regulator removed before expiry) | historical (kept for audit; not actionable). Always filter status=active for live-eligibility queries.';

COMMENT ON COLUMN regulatory_eligibility.last_verified_at IS
  'Same staleness semantics as shortage_events.last_verified_at — timestamp of the most recent scraper run that re-confirmed this entry. Used by the chat tool to attach a freshness label and confidence score.';
