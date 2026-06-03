-- ============================================================================
-- Migration 048: Health Canada "Tier 3" designation as a first-class column
-- ============================================================================
-- Health Canada's drug-shortage export (healthproductshortages.ca) carries a
-- "Tier 3" flag: TRUE means the shortage has the greatest potential impact on
-- the health system — a medically necessary product with no or limited
-- alternatives. It is HC's own clinical-priority signal and the single most
-- decision-relevant field in the feed for procurement and pharmacy users.
--
-- Until now the scraper captured Tier 3 only INDIRECTLY:
--   • folded into severity='critical' (lossy — conflates it with any future
--     critical-severity logic; can't tell a Tier 3 shortage from a non-Tier-3
--     one that happened to score critical), and
--   • appended to the free-text notes column / raw_data JSONB (not queryable).
--
-- This migration promotes it to a first-class, indexable column so the signal
-- can be filtered and surfaced directly:
--   • Adds shortage_events.tier_3 BOOLEAN (nullable, no default)
--       - TRUE  = HC Tier 3 (highest impact)
--       - FALSE = HC explicitly not Tier 3
--       - NULL  = jurisdiction has no Tier-3 concept / unknown (every non-CA
--                 source leaves it NULL, which is truthful — they don't emit it)
--   • Adds a partial index for the hot path: active/anticipated Tier 3 rows.
--   • Adds a COMMENT documenting the semantics for future agents.
--
-- severity is left untouched: Tier 3 still elevates severity to 'critical' in
-- the scraper. This column is additive — no existing rows change (all default
-- to NULL); the next Health Canada scrape backfills CA rows with TRUE/FALSE.
--
-- Idempotent + reversible (DROP COLUMN). No data movement.
-- ============================================================================

ALTER TABLE shortage_events
  ADD COLUMN IF NOT EXISTS tier_3 BOOLEAN;

COMMENT ON COLUMN shortage_events.tier_3 IS
  'Health Canada "Tier 3" clinical-priority designation: TRUE = greatest potential health-system impact (medically necessary, no/limited alternatives), FALSE = explicitly not Tier 3, NULL = source does not emit this signal (all non-Canada feeds). Sourced from the healthproductshortages.ca export. Tier 3 also elevates severity to ''critical'' in the Health Canada scraper, but this column is the authoritative, queryable signal — prefer it over parsing notes/raw_data.';

-- Partial index — the decision-relevant query is "active/anticipated Tier 3
-- shortages right now". Non-Tier-3 and resolved rows are excluded to keep it
-- small.
CREATE INDEX IF NOT EXISTS idx_shortage_events_tier3_active
  ON shortage_events (last_verified_at DESC)
  WHERE tier_3 = TRUE
    AND status IN ('active', 'anticipated');

-- ── Verification (post-apply) ────────────────────────────────────────────
-- Confirm the column exists, nullable, no default:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name='shortage_events' AND column_name='tier_3';
-- Expected: tier_3 | boolean | (null) | YES
--
-- After the next Health Canada scrape, confirm CA rows are populated and the
-- Tier 3 count matches the live export (~23 active+anticipated as of 2026-06-03):
--   SELECT tier_3, COUNT(*) FROM shortage_events
--   WHERE country_code='CA' AND status IN ('active','anticipated')
--   GROUP BY tier_3;
