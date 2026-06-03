-- ============================================================================
-- Migration 047: revoke the anonymous role's direct PostgREST access
-- ============================================================================
-- Ruthless data-protection pass.
--
-- THE HOLE THIS CLOSES
-- Migration 029 enabled RLS on the previously-unguarded tables, but the
-- public-read policies (migration 001's "drugs: public read" / "shortage_events:
-- public read" and 029's `FOR SELECT USING (true)` on the reference tables)
-- combined with Supabase's DEFAULT table GRANTs to `anon` mean the public
-- anon key — which ships to every browser — can still bulk-read the entire
-- database straight from PostgREST, bypassing the app entirely:
--
--     curl -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>" \
--       "https://<ref>.supabase.co/rest/v1/drugs?select=*&limit=1000&offset=0"
--
-- Loop the offset and you have the whole dataset. No app logic, no rate limit,
-- nothing we control. RLS `USING (true)` does not help — it explicitly allows
-- the anon role.
--
-- WHY REVOKING `anon` IS SAFE HERE (verified against the codebase)
--   • Every LOGGED-OUT read path goes through the service-role key:
--       – Public pages (`app/drugs/[id]/page.tsx`, etc.) read via
--         getSupabaseAdmin() in server components.
--       – All /api/* route handlers use getSupabaseAdmin()/...Typed().
--     None of these use the `anon` role, so none are affected.
--   • Every BROWSER `.from(...)` table read lives on an AUTH-GATED page
--     (dashboard cards, /home watchlist, /account, use-user-profile). A
--     logged-in request carries the user's JWT, so PostgREST runs it under
--     the `authenticated` role — which keeps its grants below — NOT `anon`.
--   • Logged-in users reading their own rows (user_watchlists, user_profiles,
--     supplier_enquiries) are likewise `authenticated`, scoped by RLS.
--
-- NET EFFECT
--   anon          → cannot touch any table in `public` via PostgREST.
--   authenticated → unchanged (grants below + existing RLS still apply).
--   service_role  → unchanged (bypasses RLS; powers the app server-side).
--
-- This does NOT touch RLS policies or schema USAGE — PostgREST still works;
-- the anon role simply has no table privileges to exercise.
-- ============================================================================

-- 1. Strip ALL table privileges from the anon role on every existing table.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

-- 2. Strip sequence privileges too (defence in depth; anon never needs them).
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 3. Future tables created by this migration role must NOT auto-grant anon.
--    (Supabase's global default privileges still grant anon on tables created
--    by supabase_admin, so NEW migrations should add an explicit
--    `REVOKE ALL ON <table> FROM anon;` — see the assertion block at the end.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 4. Re-assert the grants the LOGGED-IN app depends on, so this migration is
--    self-contained and can't be undone by an inconsistent earlier grant.
--    RLS still scopes every one of these; the grant is the floor, RLS the gate.
--    Public reference data the authenticated dashboards read directly:
GRANT SELECT ON
  drugs,
  shortage_events,
  shortage_status_log,
  drug_availability,
  drug_products,
  drug_alternatives,
  recalls,
  data_sources
TO authenticated;

--    User-scoped tables the browser reads/writes for the signed-in user
--    (RLS already restricts these to auth.uid()):
GRANT SELECT, INSERT, UPDATE ON
  user_watchlists,
  user_profiles,
  supplier_enquiries
TO authenticated;

-- 5. service_role keeps full access (it bypasses RLS and powers all server
--    reads/writes). Re-assert in case a prior migration narrowed it.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- Verification (run manually after applying):
--
--   -- Should now return: permission denied for table drugs
--   curl -s -H "apikey: <ANON_KEY>" \
--     "https://<ref>.supabase.co/rest/v1/drugs?select=id&limit=1" | jq
--
--   -- App still works: every public read uses the service-role key server-side,
--   -- and logged-in dashboards run under the `authenticated` role.
--
-- REMINDER FOR FUTURE MIGRATIONS: tables created after this point may be
-- re-granted to anon by Supabase's global default privileges. Any new public
-- table should ship with `REVOKE ALL ON <table> FROM anon;` in its migration.
-- ============================================================================
