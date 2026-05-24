-- ============================================================================
-- Migration 029: Enable RLS on previously unguarded tables
-- ============================================================================
-- Issue
-- -----
-- Nine tables shipped without ENABLE ROW LEVEL SECURITY. With Supabase's
-- default GRANTs on the `public` schema the `anon` role can read them via
-- PostgREST. That's only a real exposure for the operational logs that may
-- contain error messages, internal metadata, or alert-dispatch state — but
-- the convention everywhere else in the project is "RLS on, explicit
-- policy", and the linter (Supabase Security Advisor) will keep flagging
-- these until they're locked down.
--
-- Policy decisions
-- ----------------
-- Public-read (regulatory/reference data, also already public via the
-- shortage_events + recalls tables which RLS-allow anon read):
--   * shortage_status_log       — status changes (no PII)
--   * drug_availability_history — product status changes
--   * drug_status_snapshots     — daily aggregate stats
--   * active_ingredients        — INN/ATC lookup table
--   * sponsors                  — manufacturer/MAH directory
--   * drug_products             — registry entries
--   * product_ingredients       — junction table
--   * drug_availability         — country-level availability
--
-- Service-role only (operational, may contain error_message / internal):
--   * scraper_runs              — when no policy exists, service_role
--                                 bypasses RLS while anon/authenticated
--                                 get nothing.
-- ============================================================================

-- ── 1. Enable RLS on all nine tables ────────────────────────────────────────
ALTER TABLE shortage_status_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_availability_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_status_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_ingredients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ingredients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_availability         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_runs              ENABLE ROW LEVEL SECURITY;

-- ── 2. Public-read policies (idempotent) ────────────────────────────────────
DROP POLICY IF EXISTS "public read" ON shortage_status_log;
CREATE POLICY "public read" ON shortage_status_log
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON drug_availability_history;
CREATE POLICY "public read" ON drug_availability_history
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON drug_status_snapshots;
CREATE POLICY "public read" ON drug_status_snapshots
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON active_ingredients;
CREATE POLICY "public read" ON active_ingredients
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON sponsors;
CREATE POLICY "public read" ON sponsors
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON drug_products;
CREATE POLICY "public read" ON drug_products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON product_ingredients;
CREATE POLICY "public read" ON product_ingredients
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read" ON drug_availability;
CREATE POLICY "public read" ON drug_availability
  FOR SELECT USING (true);

-- scraper_runs: intentionally no policy. With RLS enabled and no policy,
-- anon and authenticated roles see nothing; service_role bypasses RLS.

-- ── 3. Verification ─────────────────────────────────────────────────────────
-- After running, this should return rls_enabled = true for all nine:
--
--   SELECT tablename, rowsecurity AS rls_enabled
--     FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN (
--        'shortage_status_log','drug_availability_history','drug_status_snapshots',
--        'active_ingredients','sponsors','drug_products','product_ingredients',
--        'drug_availability','scraper_runs'
--      )
--    ORDER BY tablename;
--
-- And anon should be blocked from scraper_runs:
--   curl -H "apikey: <anon-key>" \
--        "https://<project>.supabase.co/rest/v1/scraper_runs?select=*&limit=1"
--   Expect [] (empty), not a real row.
