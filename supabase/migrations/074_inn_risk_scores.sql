-- ============================================================================
-- Migration 074: inn_risk_scores + inn_risk_score_history
-- ============================================================================
-- Portfolio risk score, Phase 1 (docs/portfolio-risk-score-scope.md).
-- One row per molecule (INN) in the clinically-important universe: every
-- single-ingredient medicine on the current WHO Model List
-- (who_essential_medicines.on_current_list) or the EU Union list of critical
-- medicines (eu_critical_medicines.is_current).
--
-- Written nightly by backend/analysis/risk_score.py (full refresh). Two axes:
--   clinical_importance   0–10, from which authoritative lists the molecule is on
--   supply_vulnerability  0–10, 10 × fragility × (0.5 + 0.5 × pressure);
--                         NULL when there is no supplier data at all — missing
--                         data is never scored as safe
-- and a band derived from both. Every input behind a number is in `components`
-- so any surface can show "why" with sources.
--
-- inn_risk_score_history keeps one row per molecule per day. It is the only
-- record of what we flagged and when: supplier inputs (DMF, DECRS) are current
-- snapshots, so past scores cannot be reconstructed later. It backs the
-- backtest and any future "flagged N days before the regulator" claim.
--
-- Not public data: RLS on with no policies, so only the service role (used by
-- the Next.js route handlers) can read or write.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inn_risk_scores (
  inn                    TEXT PRIMARY KEY,         -- lower-case INN, e.g. 'cisplatin'
  display_name           TEXT NOT NULL,            -- e.g. 'Cisplatin'
  band                   TEXT NOT NULL
    CHECK (band IN ('high_risk', 'risk', 'caution', 'low', 'insufficient_data')),

  clinical_importance    NUMERIC(3,1) NOT NULL,    -- 0–10
  supply_vulnerability   NUMERIC(3,1),             -- 0–10; NULL = insufficient supply data
  fragility              NUMERIC(4,3),             -- 0–1 structural
  pressure               NUMERIC(4,3),             -- 0–1 current instability

  -- Clinical-importance inputs (sources: WHO eEML, EMA Union list)
  who_eml_list           TEXT CHECK (who_eml_list IN ('core', 'complementary')),
  who_emlc               BOOLEAN NOT NULL DEFAULT FALSE,
  eu_critical            BOOLEAN NOT NULL DEFAULT FALSE,
  eu_routes              TEXT[],                   -- verbatim from EMA, as published

  -- Supply inputs
  n_api_makers           INTEGER,                  -- NULL = no API supplier data
  n_finished_firms       INTEGER,                  -- NULL = no approval/recall firm data
  api_country_hhi        NUMERIC(4,3),
  top_api_country        TEXT,
  short_countries        TEXT[] NOT NULL DEFAULT '{}',   -- active shortage now
  anticipated_countries  TEXT[] NOT NULL DEFAULT '{}',
  shortage_episodes_3y   INTEGER NOT NULL DEFAULT 0,     -- distinct country × start-month
  recalls_5y             INTEGER NOT NULL DEFAULT 0,

  drug_ids               UUID[] NOT NULL DEFAULT '{}',   -- drugs rows grouped under this INN
  inputs_used            TEXT[] NOT NULL DEFAULT '{}',
  components             JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version          TEXT NOT NULL,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inn_risk_scores IS
  'Per-molecule supply risk: clinical importance (WHO EML / EU Union list) x supply vulnerability (API + finished-dose concentration, shortage breadth). Full refresh nightly by backend/analysis/risk_score.py. supply_vulnerability NULL means no supplier data, never "safe".';

CREATE INDEX IF NOT EXISTS idx_inn_risk_band ON inn_risk_scores (band);
CREATE INDEX IF NOT EXISTS idx_inn_risk_drug_ids ON inn_risk_scores USING GIN (drug_ids);

CREATE TABLE IF NOT EXISTS inn_risk_score_history (
  inn                    TEXT NOT NULL,
  computed_on            DATE NOT NULL,
  band                   TEXT NOT NULL,
  clinical_importance    NUMERIC(3,1) NOT NULL,
  supply_vulnerability   NUMERIC(3,1),
  short_countries        TEXT[] NOT NULL DEFAULT '{}',
  model_version          TEXT NOT NULL,
  PRIMARY KEY (inn, computed_on)
);

COMMENT ON TABLE inn_risk_score_history IS
  'Daily snapshot of inn_risk_scores (one row per molecule per day). Evidence for backtests and lead-time claims; never rewritten.';

ALTER TABLE inn_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inn_risk_score_history ENABLE ROW LEVEL SECURITY;

-- ── Verification ─────────────────────────────────────────────────────────
--   SELECT band, count(*) FROM inn_risk_scores GROUP BY band ORDER BY 2 DESC;
--   SELECT inn, band, clinical_importance, supply_vulnerability
--   FROM inn_risk_scores WHERE inn IN ('cisplatin', 'atorvastatin', 'metformin');
