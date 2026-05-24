-- ============================================================================
-- Migration 028: Lock down `user_profiles.is_admin` — security hardening
-- ============================================================================
-- Issue
-- -----
-- The policy `user_profiles: users manage own row` in 015_supplier_dashboard
-- grants `FOR ALL` to authenticated users on their own row, with a WITH CHECK
-- that only verifies `auth.uid() = user_id`. There is no column-level
-- restriction on is_admin, and Supabase's defaults give the `authenticated`
-- role full UPDATE/INSERT privileges on tables in the public schema.
--
-- Net result: any signed-in user can self-promote via
--   PATCH /rest/v1/user_profiles?user_id=eq.<their-uid>  body {"is_admin":true}
-- and the next call to requireAdmin() (frontend/lib/admin-auth.ts) treats
-- them as an admin — unlocking intelligence CRUD, cohort listing
-- (which leaks every user's email via auth.admin.listUsers), etc.
--
-- Fix
-- ---
-- Revoke column-level UPDATE and INSERT privileges on `is_admin` from the
-- authenticated and anon roles. service_role (used by getSupabaseAdmin) is
-- unaffected — it bypasses both RLS and column GRANTs. The DEFAULT FALSE on
-- the column means signups continue to work; admins are seeded server-side
-- using the service-role client.
-- ============================================================================

REVOKE UPDATE (is_admin) ON public.user_profiles FROM authenticated;
REVOKE INSERT (is_admin) ON public.user_profiles FROM authenticated;

-- Defensive: anon should never write to user_profiles at all, but explicit
-- revokes guard against any future policy widening.
REVOKE UPDATE (is_admin) ON public.user_profiles FROM anon;
REVOKE INSERT (is_admin) ON public.user_profiles FROM anon;

-- ----------------------------------------------------------------------------
-- Verification (run in the SQL editor while logged in as the postgres role)
-- ----------------------------------------------------------------------------
-- 1. Confirm `authenticated` no longer has UPDATE on the column:
--
--    SELECT grantee, privilege_type, is_grantable
--      FROM information_schema.column_privileges
--     WHERE table_schema = 'public'
--       AND table_name   = 'user_profiles'
--       AND column_name  = 'is_admin'
--     ORDER BY grantee, privilege_type;
--
--    Expect rows for `postgres`, `service_role`, possibly `supabase_admin` —
--    but NOT `authenticated` or `anon` with UPDATE/INSERT.
--
-- 2. Live exploit attempt against the REST endpoint (replace placeholders):
--
--    curl -X PATCH \
--      "https://<project>.supabase.co/rest/v1/user_profiles?user_id=eq.<uid>" \
--      -H "apikey: <anon-key>" \
--      -H "Authorization: Bearer <user-jwt>" \
--      -H "Content-Type: application/json" \
--      -H "Prefer: return=representation" \
--      -d '{"is_admin": true}'
--
--    Pre-migration: returns 200/204 + `is_admin: true` (BAD)
--    Post-migration: returns 403 with code 42501 / "permission denied for
--    column is_admin" (GOOD)
-- ----------------------------------------------------------------------------
