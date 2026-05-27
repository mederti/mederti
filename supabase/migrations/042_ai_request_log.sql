-- ============================================================================
-- Migration 042: ai_request_log — per-call observability for Claude usage
-- ============================================================================
-- Closes audit FINDING-AI-02: the only telemetry on /api/chat today is one
-- `console.log` line that goes to Vercel function logs and disappears after
-- the retention window. No structured cost breakdown, no per-tool latency,
-- nothing for the 5 ancillary AI surfaces (chip-answer, daily-question,
-- so-what, intelligence/briefing, supplier-insights).
--
-- This table is the substrate. The frontend/lib/ai/usage-log.ts helper does
-- the fire-and-forget write. Route handlers call recordAiUsage(...) right
-- after every Anthropic call.
--
-- Design notes
-- ────────────
--   • Privacy: user_id is nullable and only set when the route already has
--     it (chat resolves session; ancillary surfaces don't). No IP stored.
--   • Cost: we store raw token counts, not USD. Pricing changes; tokens
--     don't. The /admin/ai-spend dashboard does USD math at render time
--     using the most-recent rate card.
--   • Failure modes: insert errors degrade silently (helper logs to
--     console only when DEBUG flag is set). Never blocks the user request.
--   • Idempotent + reversible (DROP TABLE / DROP VIEW). No data movement.
--
-- RLS: service_role only. No direct read access; the /admin/ai-spend page
-- (admin-gated already via requireAdmin) reads via getSupabaseAdmin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_request_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which Mederti surface called Anthropic. Keep as free-text rather than
  -- enum so new AI routes can record without a migration.
  route                       TEXT NOT NULL,
  -- Model snapshot ID actually sent to Anthropic (after env override).
  -- Important for cost attribution because Opus 4.7 is ~5× Sonnet.
  model                       TEXT NOT NULL,
  -- Anthropic usage block — surfaced verbatim from the SDK response.
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  -- End-to-end latency including tool-use loop iterations.
  latency_ms                  INTEGER,
  -- Chat's tool-use loop only — null for non-chat surfaces.
  tool_calls                  INTEGER,
  -- Hit the 12-iteration MAX_ITERATIONS ceiling (chat only).
  truncated                   BOOLEAN,
  -- Set only when the route already resolved auth.getUser().
  user_id                     UUID,
  -- 'success' | 'error' | 'rate_limited' | 'fallback' | 'no_key'
  status                      TEXT NOT NULL DEFAULT 'success',
  -- Free-form annotation: error message, fallback reason, etc. Bounded
  -- to 500 chars at insert time by the helper.
  notes                       TEXT,
  -- Caller can stamp a SYSTEM_PROMPT_VERSION constant so reports can pin
  -- a regression to a specific prompt revision (audit FINDING-AI-06).
  prompt_version              TEXT,
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_request_log_occurred_at
  ON ai_request_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_request_log_route_time
  ON ai_request_log (route, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_request_log_model_time
  ON ai_request_log (model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_request_log_status
  ON ai_request_log (status, occurred_at DESC) WHERE status <> 'success';

-- RLS — strict service-role-only. The /admin/ai-spend dashboard reads via
-- getSupabaseAdmin which bypasses RLS; no other surface should see this.
ALTER TABLE ai_request_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_request_log service_role only" ON ai_request_log;
CREATE POLICY "ai_request_log service_role only"
  ON ai_request_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Daily rollup view ────────────────────────────────────────────────────
-- Cheap aggregation for the admin dashboard. Per-route, per-model, per-day
-- token totals so /admin/ai-spend can render a chart without scanning the
-- whole table.
CREATE OR REPLACE VIEW v_ai_request_daily AS
SELECT
  date_trunc('day', occurred_at)::date AS day,
  route,
  model,
  COUNT(*)                                        AS requests,
  COUNT(*) FILTER (WHERE status <> 'success')     AS error_count,
  SUM(input_tokens)                               AS input_tokens,
  SUM(output_tokens)                              AS output_tokens,
  SUM(cache_creation_input_tokens)                AS cache_creation_tokens,
  SUM(cache_read_input_tokens)                    AS cache_read_tokens,
  AVG(latency_ms)::INTEGER                        AS avg_latency_ms,
  MAX(latency_ms)                                 AS max_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::INTEGER AS p95_latency_ms
FROM ai_request_log
GROUP BY date_trunc('day', occurred_at), route, model;

-- Table-level docs
COMMENT ON TABLE ai_request_log IS
  'Per-call Anthropic usage log — populated by frontend/lib/ai/usage-log.ts recordAiUsage() helper. One row per Claude call across all 6 AI surfaces (chat + chip-answer + daily-question + so-what + intelligence/briefing + supplier-insights). Direct SELECT denied by RLS; read via getSupabaseAdmin from admin surfaces only.';

COMMENT ON COLUMN ai_request_log.route IS
  'Mederti surface that made the call (e.g. /api/chat, /api/chip-answer). Free-text not enum so new routes can log without a migration.';

COMMENT ON COLUMN ai_request_log.model IS
  'Actual Anthropic model snapshot ID sent (after ANTHROPIC_MODEL env override). Important for cost attribution — Opus 4.7 input is ~5× Sonnet.';

COMMENT ON COLUMN ai_request_log.cache_read_input_tokens IS
  'Tokens read from the prompt cache (cache_control: ephemeral). High cache_read / input ratio = good cache hit rate. Low = the prompt is being invalidated.';

COMMENT ON COLUMN ai_request_log.tool_calls IS
  'Chat-only: how many tool-use iterations the model ran (MAX_ITERATIONS=12). Null for non-chat surfaces.';

COMMENT ON COLUMN ai_request_log.prompt_version IS
  'Optional version stamp emitted with the answer so eval regressions can be pinned to a prompt revision (audit FINDING-AI-06).';

COMMENT ON VIEW v_ai_request_daily IS
  'Daily roll-up of ai_request_log by route+model. Backs /admin/ai-spend dashboard. Includes p95 latency so a tool regression that doubles tail latency is visible.';
