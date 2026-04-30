-- ============================================================================
-- Migration 025: User profile onboarding fields
-- ============================================================================
-- Extends user_profiles with the five signup-profiling answers that drive
-- personalisation and BI:
--
--   1. role               (extended)  who the user is
--   2. countries          (new)       which markets they operate in
--   3. use_case           (new)       what brought them in today
--   4. org_size           (new)       optional band
--   5. therapy_areas      (new)       optional ATC L1 areas
--
-- Plus onboarding meta (completed flag, timestamp).
-- ============================================================================

-- ── 1. Widen the role enum ─────────────────────────────────────────────────
-- New roles cover the full B2B audience: hospital pharmacist, community
-- pharmacist, hospital procurement, wholesaler/distributor, pharma
-- manufacturer, gov/regulator, researcher/journalist.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN (
    'hospital_pharmacist',     -- clinical pharmacist in hospital
    'community_pharmacist',    -- retail / community pharmacy
    'hospital_procurement',    -- hospital supply chain / purchasing
    'wholesaler',              -- wholesaler / distributor
    'manufacturer',            -- pharma manufacturer / supplier (the supplier side)
    'government',              -- regulator / health-system planner
    'researcher',              -- academic / journalist / analyst
    -- Legacy values (kept for back-compat with rows already in the table)
    'pharmacist','hospital','supplier','default','other'
  ));

-- ── 2. New profile fields ──────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS countries          TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS use_case           TEXT,
  ADD COLUMN IF NOT EXISTS org_size           TEXT,
  ADD COLUMN IF NOT EXISTS therapy_areas      TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_done    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_done_at TIMESTAMPTZ;

-- Use-case enum (kept as TEXT with a CHECK so it's easy to extend later)
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_use_case_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_use_case_check CHECK (
    use_case IS NULL OR use_case IN (
      'find_alternative',   -- "a specific drug is short and I need an alternative"
      'plan_ahead',         -- "I'm planning ahead for likely shortages"
      'sell_or_source',     -- "I source / supply medicines"
      'analyse_market',     -- "I track the industry for analysis or reporting"
      'just_exploring'
    )
  );

-- Org-size band
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_org_size_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_org_size_check CHECK (
    org_size IS NULL OR org_size IN (
      'just_me',
      '2_10',
      '11_50',
      '51_250',
      '251_1000',
      '1000_plus'
    )
  );

-- ── 3. Indexes for cohort analysis (BI) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_use_case
  ON user_profiles (use_case) WHERE use_case IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_org_size
  ON user_profiles (org_size) WHERE org_size IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_onboarding_done
  ON user_profiles (onboarding_done);
CREATE INDEX IF NOT EXISTS idx_user_profiles_countries
  ON user_profiles USING GIN (countries);
CREATE INDEX IF NOT EXISTS idx_user_profiles_therapy_areas
  ON user_profiles USING GIN (therapy_areas);
