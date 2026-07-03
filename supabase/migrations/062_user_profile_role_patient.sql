-- ============================================================================
-- Migration 062: Add 'patient' to the user_profiles role CHECK constraint
-- ============================================================================
-- Adds a "Patient or carer" persona to signup/onboarding. Must stay in lockstep
-- with VALID_PROFILE_ROLES in frontend/lib/roles.ts — a value the API accepts
-- but the constraint rejects causes a silent upsert failure.
--
-- Rebuilds the full constraint from migration 025 with 'patient' appended.
-- ============================================================================

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
    'patient',                 -- patient or carer affected by a shortage
    -- Legacy values (kept for back-compat with rows already in the table)
    'pharmacist','hospital','supplier','default','other'
  ));
