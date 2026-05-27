-- ============================================================================
-- Migration 044: composite + partial indexes on shortage_events hot filters
-- ============================================================================
-- Closes audit FINDING-P5-06.
--
-- shortage_events has single-column indexes on country_code (001:227) and
-- status (001:229) and severity (001:230). The two most common list-page
-- filter combos — (country_code, status) and (status, severity) — must
-- currently be served by a bitmap-AND of two index scans, which is fine
-- for moderate selectivity but degrades as the table grows (21,500 rows
-- today; 100k+ within a year).
--
-- Partial-indexing on active|anticipated keeps the indexes tiny — those
-- two statuses are the only ones the public-facing routes filter on —
-- and write-cost stays minimal because the predicate matches a minority
-- of rows over time as shortages resolve.
--
-- Idempotent + reversible (DROP INDEX IF EXISTS). No data movement.
-- ============================================================================

-- ── (country_code, status) — the dominant list-page filter ──────────────
-- Used by: /api/freshness, /api/predictive-signals (via shortage_events
-- aggregation), /shortages page filter chips, the chat tool
-- list_active_shortages.
CREATE INDEX IF NOT EXISTS idx_shortage_events_country_status_active
  ON shortage_events (country_code, status)
  WHERE status IN ('active', 'anticipated');

-- ── (status, severity) — for "critical shortages right now" lookups ─────
-- Used by: /api/intelligence/briefing, the persona landing pages' real-
-- data preview rows, the chat tools that segment by severity.
CREATE INDEX IF NOT EXISTS idx_shortage_events_status_severity_active
  ON shortage_events (status, severity)
  WHERE status IN ('active', 'anticipated');

-- ── (drug_id, status, country_code) — drug-detail page hot path ─────────
-- Used by: /drugs/[id] page (server component pulls active shortages per
-- drug, grouped by country). Currently served by idx_shortage_events_drug_id
-- + post-filter; this version filters in the index.
CREATE INDEX IF NOT EXISTS idx_shortage_events_drug_status_country_active
  ON shortage_events (drug_id, status, country_code)
  WHERE status IN ('active', 'anticipated');

COMMENT ON INDEX idx_shortage_events_country_status_active IS
  'Partial composite for active|anticipated rows. Closes FINDING-P5-06. Hot path: /shortages, list_active_shortages chat tool.';

COMMENT ON INDEX idx_shortage_events_status_severity_active IS
  'Partial composite for severity segmentation on live shortages. Hot path: intelligence briefing, persona landings.';

COMMENT ON INDEX idx_shortage_events_drug_status_country_active IS
  'Partial composite for the drug-detail page hot path: drug × status × country, restricted to live rows.';

-- ── Verification (post-apply) ────────────────────────────────────────────
-- Run an EXPLAIN ANALYZE on a representative query to confirm the planner
-- now picks the new index instead of the bitmap-AND:
--
--   EXPLAIN ANALYZE
--   SELECT * FROM shortage_events
--   WHERE country_code = 'AU' AND status = 'active'
--   ORDER BY start_date DESC LIMIT 50;
--
-- Look for "Index Scan using idx_shortage_events_country_status_active"
-- in the plan. Before this migration, that plan was a Bitmap Heap Scan
-- AND-ing the two single-column indexes.
