-- ============================================================================
-- Migration 039: first_reported_date on shortage_events
-- ============================================================================
-- Closes audit §5.3 issue #10 + §9 item 10: there is no separate field for
-- "when did the supplier / regulator first report this shortage" vs
-- "when did the shortage actually begin". Currently start_date conflates the
-- two. Several questions in the bank hinge on the gap between them:
--
--   GOV-07  — "Which suppliers have a pattern of late or missing notifications?"
--   HPR-02  — "Which suppliers consistently fail to notify ahead of shortages?"
--   GOV-08  — "Has our national shortage rate improved year-on-year?" (uses
--             reporting date for trend analysis, not onset date)
--
-- This migration adds the column (nullable, no backfill — backfill is a
-- separate scraper-side change). When source data permits it, scrapers
-- should populate first_reported_date with the regulator's notification
-- timestamp.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) and reversible (DROP COLUMN).
-- No production data is changed by this migration.
-- ============================================================================

ALTER TABLE shortage_events
  ADD COLUMN IF NOT EXISTS first_reported_date DATE;

COMMENT ON COLUMN shortage_events.first_reported_date IS
  'Date the regulator / supplier FIRST notified this shortage. Distinct from start_date (which is the onset date the regulator publishes). The gap between first_reported_date and start_date is the supplier-notification lead time — a negative value means the supplier flagged the shortage before it began (good behaviour); zero / positive means they reported on or after onset. Nullable; many regulator feeds do not surface a separate notification timestamp.';

-- Optional partial index — useful for "late notifier" analytics that filter
-- for rows where first_reported_date is on or after start_date.
CREATE INDEX IF NOT EXISTS idx_shortage_events_late_notification
  ON shortage_events (data_source_id, first_reported_date)
  WHERE first_reported_date IS NOT NULL;
