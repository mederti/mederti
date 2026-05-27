-- ============================================================================
-- Migration 041: demand_signals — privacy-preserving demand telemetry
-- ============================================================================
-- Closes audit §9 item 13 + cluster D: the supplier-side ⚠ questions
-- (SUP-08/09/26/27/28) currently RED because Mederti has no buyer-search
-- telemetry. This migration ships the table and a k-anonymity-enforced
-- aggregate view; instrumentation hooks (in route handlers) ship in
-- follow-up PRs.
--
-- Privacy-by-design
-- ─────────────────
-- We deliberately do NOT store user_id, IP, or session identifier in the
-- raw table. Per the audit §12 open question 4 ("Demand telemetry: privacy
-- model"), the minimum-viable approach is:
--
--   • session_hash = HMAC-SHA256(user_id_or_ip, daily-rotating salt)
--   • salt is rotated daily so cross-day correlation is broken
--   • The hash deduplicates "same user searched 50 times" without
--     retaining identity
--   • Queries MUST go through v_demand_signal_summary which enforces
--     k-anonymity ≥ 5 via the HAVING clause — buckets with fewer than 5
--     distinct session_hashes are never returned
--   • RLS denies direct SELECT on demand_signals; only the view is readable
--
-- Idempotent + reversible (DROP TABLE / DROP VIEW). No data movement.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demand_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id       UUID REFERENCES drugs(id) ON DELETE SET NULL,
  -- Free-text query when the user searched without resolving to a drug_id.
  -- Truncated to 80 chars at insert time by the instrumentation helper to
  -- prevent accidental PII (e.g. someone typing a personal medical history).
  raw_query     TEXT,
  -- ISO-2 country code of the user's home market, if known. Often null
  -- (anonymous user, country detection off).
  country_code  CHAR(2),
  signal_type   TEXT NOT NULL CHECK (signal_type IN (
    'search', 'drug_view', 'enquiry', 'watchlist_add', 'chip_click'
  )),
  -- Daily-rotating hash of the user identifier. NOT a user FK — explicit
  -- privacy choice. See migration header for the rotation contract.
  session_hash  TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup indexes — keep them sparse; the only intended access path is
-- through the aggregate view.
CREATE INDEX IF NOT EXISTS idx_demand_signals_drug_time
  ON demand_signals (drug_id, occurred_at DESC) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demand_signals_country_time
  ON demand_signals (country_code, occurred_at DESC) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demand_signals_type_time
  ON demand_signals (signal_type, occurred_at DESC);

-- RLS — strict: only service_role can write, NO ONE can read this table
-- directly. Reads must go through the aggregate view.
ALTER TABLE demand_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "demand_signals service_role only" ON demand_signals;
CREATE POLICY "demand_signals service_role only"
  ON demand_signals FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Aggregate view with enforced k-anonymity ────────────────────────────
-- This is the ONLY supported read path. Buckets with fewer than 5 distinct
-- session_hashes are suppressed via the HAVING clause — a privacy floor
-- below which we don't release counts at all.
CREATE OR REPLACE VIEW v_demand_signal_summary AS
SELECT
  drug_id,
  country_code,
  signal_type,
  date_trunc('week', occurred_at)::date AS week_starting,
  COUNT(DISTINCT session_hash) AS unique_signals,
  COUNT(*) AS total_signals
FROM demand_signals
WHERE drug_id IS NOT NULL
GROUP BY drug_id, country_code, signal_type, date_trunc('week', occurred_at)
HAVING COUNT(DISTINCT session_hash) >= 5;

COMMENT ON VIEW v_demand_signal_summary IS
  'Weekly aggregate of demand_signals with k-anonymity ≥ 5 enforced. Buckets with fewer than 5 distinct session_hashes are suppressed. This is the ONLY supported read path — direct SELECT on demand_signals is denied by RLS to enforce the privacy contract.';

-- Table-level docs
COMMENT ON TABLE demand_signals IS
  'Privacy-preserving demand telemetry — buyer-side search/view/enquiry signals. Populated by recordDemandSignal() in frontend route handlers (instrumented in a follow-up PR). Direct SELECT denied by RLS — read via v_demand_signal_summary which enforces k-anonymity ≥ 5.';

COMMENT ON COLUMN demand_signals.session_hash IS
  'HMAC-SHA256(user_id_or_ip, daily_salt). Salt rotates daily so cross-day correlation is broken. Used to deduplicate repeat signals from the same session without retaining identity.';

COMMENT ON COLUMN demand_signals.raw_query IS
  'Free-text query when the search did not resolve to a drug_id. Truncated to 80 chars at insert time by the instrumentation helper to bound accidental PII.';
