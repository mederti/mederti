-- ============================================================================
-- Migration 076: data_sources freshness signals — job health vs upstream
-- ============================================================================
-- /freshness separates two independent ways a source goes stale:
--
--   1. Our job stopped   — last successful run older than the cadence.
--                          Already answerable: data_sources.last_scraped_at is
--                          written by BaseScraper / BaseRecallScraper on every
--                          non-failed run.
--   2. Upstream stale    — our job runs fine, but the newest date the SOURCE
--                          itself reports has not advanced for N consecutive
--                          runs. A suspicion, never proof: a quiet register
--                          (Senegal, Sri Lanka) legitimately posts nothing new.
--
-- (2) needs per-run state the table does not hold, so the scrapers now record:
--
--   last_run_at / last_run_status
--       Every run, INCLUDING failures (last_scraped_at skips failures on
--       purpose, so on its own it cannot tell "not running" from "running and
--       failing" — Health Canada and SFDA were the latter for weeks).
--   newest_source_date
--       Max start/end/announced date the source itself published, excluding
--       dates on or after the run date (many scrapers default a missing date
--       to today, which would fake an advance on every run).
--   newest_source_date_first_seen_at
--       When a run watched newest_source_date ADVANCE to its current value.
--       NULL while the value is still the baseline from the first tracked run,
--       so the page never claims "advancing" before seeing a real advance.
--   newest_source_date_unchanged_runs
--       Consecutive non-failed runs since then that did not see a newer date.
--       A byte-identical payload (raw_scrapes status 'duplicate') counts as
--       unchanged without re-parsing.
--
-- Columns start NULL / 0 and fill from the first run after deploy — there is
-- deliberately no backfill from shortage_events, because stored start_dates
-- include "first seen by Mederti" fallbacks that are not source dates.
--
-- Additive and reversible: ALTER TABLE data_sources DROP COLUMN ... for each.
-- Scrapers write these best-effort and keep working if this is unapplied.
-- ============================================================================

ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS last_run_at                       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_status                   TEXT,
  ADD COLUMN IF NOT EXISTS newest_source_date                DATE,
  ADD COLUMN IF NOT EXISTS newest_source_date_first_seen_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS newest_source_date_unchanged_runs INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN data_sources.last_run_at IS
  'Finish time of the most recent run, successful or not (last_scraped_at = last non-failed run).';
COMMENT ON COLUMN data_sources.last_run_status IS
  'Status of the most recent run: success | partial | empty | duplicate | failed.';
COMMENT ON COLUMN data_sources.newest_source_date IS
  'Newest date the source itself published (start/end/announced), excluding run-date defaults.';
COMMENT ON COLUMN data_sources.newest_source_date_first_seen_at IS
  'When a run watched newest_source_date advance to its current value; NULL = still the first-run baseline.';
COMMENT ON COLUMN data_sources.newest_source_date_unchanged_runs IS
  'Consecutive non-failed runs since newest_source_date last advanced. High = suspected upstream stall, not proof.';
