-- ============================================================================
-- Migration 062: Add 'patient' to the user_profiles.role CHECK constraint
-- ============================================================================
-- The onboarding UI and lib/roles.ts (VALID_PROFILE_ROLES) now offer a
-- "Patient or carer" persona. The DB CHECK constraint from migration 025 did
-- not include 'patient', so a patient signup was accepted by the API but
-- rejected by Postgres (23514) — the profile upsert failed silently and the
-- user was left with no user_profiles row (broken persona routing /
-- personalisation).
--
-- This rebuilds user_profiles_role_check to the migration-025 set PLUS
-- 'patient', keeping the DB and app role lists in lockstep.
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
    'patient',                 -- patient or carer managing their own medicines
    -- Legacy values (kept for back-compat with rows already in the table)
    'pharmacist','hospital','supplier','default','other'
  ));
