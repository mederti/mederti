-- ============================================================================
-- Migration 075: watchlist_alert_state — last tier emailed per watch
-- ============================================================================
-- The daily watchlist digest (backend/alerts/watchlist_digest.py) emails a
-- user only when a watched medicine changes tier in their market:
--   short_now · anticipated · early_warning (short in ≥2 peers, not here) · watching
-- (the same four tiers as /api/watchlist/risk-board). This table remembers the
-- tier each (user, drug, market) was in at the last digest, so a change is a
-- transition between two daily snapshots — intra-day status flapping in the
-- raw shortage_status_log (~750 resolved↔active flips/week) never reaches a
-- user, and an unchanged watchlist sends nothing.
--
-- It replaces per-row emails from dispatch_pending_alerts(), which would have
-- sent one email per status-log row across every country.
--
-- Service-role only (RLS on, no policies). Reversible: DROP TABLE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchlist_alert_state (
  user_id          UUID NOT NULL,
  drug_id          UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  country          TEXT NOT NULL,                 -- ISO-2 market the tier is for
  tier             TEXT NOT NULL
    CHECK (tier IN ('short_now', 'anticipated', 'early_warning', 'watching')),
  peers            TEXT[] NOT NULL DEFAULT '{}',  -- peers short at last snapshot
  tier_since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_emailed_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, drug_id, country)
);

COMMENT ON TABLE watchlist_alert_state IS
  'Tier of each watched medicine per user and market at the last daily digest. A digest email is sent only for tier transitions. Written by backend/alerts/watchlist_digest.py.';

ALTER TABLE watchlist_alert_state ENABLE ROW LEVEL SECURITY;
