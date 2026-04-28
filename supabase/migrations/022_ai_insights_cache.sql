-- ============================================================================
-- Migration 022: AI Insights Cache
-- ============================================================================
-- Persists Claude-generated supplier intelligence so we don't pay LLM costs
-- on every page load. Each row is keyed by (supplier_id, insight_type, entity_id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_supplier_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL
    CHECK (insight_type IN (
      'daily_briefing',       -- whole-portfolio executive summary
      'enquiry_note',         -- per-enquiry strategic note
      'quote_coaching',       -- per-enquiry quote pricing/timing
      'drug_foresight',       -- per-drug 30/60/90 day forecast
      'analytics_narrative'   -- analytics page narrative
    )),
  entity_id TEXT,             -- enquiry_id / drug_id / null for whole-portfolio
  payload JSONB NOT NULL,     -- structured insight: {summary, items, confidence}
  expires_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  UNIQUE (supplier_id, insight_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_lookup
  ON ai_supplier_insights (supplier_id, insight_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_expires
  ON ai_supplier_insights (expires_at);

ALTER TABLE ai_supplier_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_insights_owner_read" ON ai_supplier_insights;
CREATE POLICY "ai_insights_owner_read" ON ai_supplier_insights
  FOR SELECT USING (
    supplier_id IN (SELECT id FROM supplier_profiles WHERE user_id = auth.uid())
  );

COMMENT ON TABLE ai_supplier_insights IS
  'Cached Claude-generated strategic insights for the supplier dashboard';
