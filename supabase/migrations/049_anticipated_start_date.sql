-- ============================================================================
-- Migration 049: anticipated_start_date on shortage_events + per-country
--                anticipated-vs-active status breakdown view
-- ============================================================================
-- Forward-looking shortage signal is core to the product, but several
-- regulators publish a *distinct* anticipated / upcoming shortage status
-- ahead of onset:
--
--   • Health Canada — "Anticipated shortage" status, with a mandatory
--     "Anticipated start date" (suppliers must report >= 6 months ahead).
--   • TGA           — "Anticipated shortage" status in the MSI feed.
--   • ANSM / NOMA / HSA / SFDA — map their forward-looking categories
--     ("tension d'approvisionnement", "forventet", MAH-change, "expected")
--     onto our 'anticipated' enum value today.
--
-- The status enum already carries 'anticipated' (see 001_initial_schema.sql)
-- so the *status* is captured. What was missing is a dedicated column for the
-- anticipated ONSET date when the source publishes one separately from the
-- (actual) start_date. Health Canada is the headline case: it carries BOTH an
-- "Actual start date" and an "Anticipated start date", and start_date prefers
-- the actual — so the early-warning lead time (today minus anticipated start)
-- had nowhere to live and was only stashed inside raw_data.
--
-- NOTE: commit 3259cf1 ("persist Tier 3 + anticipated onset from Health Canada")
-- already shipped the WRITE path for this column (base_scraper.upsert passthrough
-- + health_canada_scraper emission) but NO migration ever created the column —
-- so those HC upserts have been failing the unknown-column write (caught and
-- counted as "skipped" in upsert's try/except). This migration closes that gap.
-- ADD COLUMN IF NOT EXISTS is idempotent: a no-op if the column was added to the
-- DB out-of-band, otherwise it creates it. Either way the write path starts
-- persisting.
--
-- This migration:
--   • Adds shortage_events.anticipated_start_date DATE (nullable, no default).
--   • Adds a partial index for the early-warning query path.
--   • Adds v_shortage_status_by_country — a cheap pivot powering the
--     "how much anticipated-vs-active signal do we actually hold, per country"
--     count endpoint (/api/shortages/status-breakdown).
--
-- NON-DESTRUCTIVE: no existing row's status is reclassified, and no existing
-- column is modified. The new column starts NULL everywhere; the daily
-- Health Canada scrape (idempotent upsert on shortage_id) backfills it on the
-- next run for every anticipated AU/CA record that carries a distinct
-- anticipated start. We deliberately do NOT parse-and-backfill from raw_data
-- in SQL — date-format fragility there could corrupt the new column, and the
-- scraper repopulates within a day anyway (same precedent as migration 039).
--
-- Idempotent (ADD COLUMN / CREATE OR REPLACE / IF NOT EXISTS) and fully
-- reversible — see the DOWN block at the foot of this file.
-- ============================================================================

ALTER TABLE shortage_events
  ADD COLUMN IF NOT EXISTS anticipated_start_date DATE;

COMMENT ON COLUMN shortage_events.anticipated_start_date IS
  'For status=''anticipated'' rows: the date the shortage is expected to BEGIN, as published by the regulator/supplier ahead of onset. Distinct from start_date — Health Canada (and others) publish both an actual start date and an anticipated start date, and start_date prefers the actual onset. The gap between today and anticipated_start_date is the forward early-warning runway (Canada mandates >= 6 months ahead). Nullable; populated only when the source publishes a separate anticipated-onset date. For sources whose only date IS the anticipated onset (e.g. NOMA "forventet"), start_date already carries it and this column may stay NULL.';

-- Early-warning query path: "anticipated shortages whose onset is still ahead
-- of us", ordered by how soon they land. Partial so it stays small.
CREATE INDEX IF NOT EXISTS idx_shortage_events_anticipated_start
  ON shortage_events (anticipated_start_date)
  WHERE status = 'anticipated' AND anticipated_start_date IS NOT NULL;

-- ── Per-country status breakdown view ──────────────────────────────────────
-- Powers /api/shortages/status-breakdown. FILTER aggregates give us a pivot
-- (active | anticipated | resolved | stale) per country in a single scan.
-- security_invoker = true → the view runs with the caller's privileges, so the
-- public RLS read policy on shortage_events still applies (service-role
-- callers bypass RLS as usual).
--
-- ORDER-INDEPENDENT re: migration 046. The synthetic flag (recall-derived
-- rows, migration 046) SHOULD be excluded from public counts — but prod has
-- migration drift and 046 may not be applied yet (the column may not exist).
-- A view referencing a missing column fails to create, so we build the view
-- dynamically: the synthetic filter is included only if the column exists.
-- When the column is absent there are also no synthetic rows to exclude, so
-- the count is identical. After 046 lands, RE-RUN this migration (it's
-- CREATE OR REPLACE) to pick up the filter.
DO $mig049$
DECLARE
    has_synthetic BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'shortage_events'
          AND column_name  = 'synthetic'
    ) INTO has_synthetic;

    EXECUTE format($v$
        CREATE OR REPLACE VIEW v_shortage_status_by_country
          WITH (security_invoker = true) AS
        SELECT
            country,
            country_code,
            COUNT(*) FILTER (WHERE status = 'active')                     AS active,
            COUNT(*) FILTER (WHERE status = 'anticipated')                AS anticipated,
            COUNT(*) FILTER (WHERE status = 'resolved')                   AS resolved,
            COUNT(*) FILTER (WHERE status = 'stale')                      AS stale,
            COUNT(*) FILTER (WHERE status IN ('active', 'anticipated'))   AS live_total,
            COUNT(*)                                                      AS total,
            MIN(anticipated_start_date) FILTER (
                WHERE status = 'anticipated' AND anticipated_start_date IS NOT NULL
            )                                                             AS next_anticipated_start
        FROM shortage_events
        %s
        GROUP BY country, country_code;
    $v$, CASE WHEN has_synthetic
              THEN 'WHERE COALESCE(synthetic, FALSE) = FALSE'
              ELSE '' END);
END
$mig049$;

COMMENT ON VIEW v_shortage_status_by_country IS
  'Per-country pivot of shortage_events.status (active/anticipated/resolved/stale) plus live_total (active+anticipated) and next_anticipated_start (soonest published anticipated onset). Excludes synthetic recall-derived rows when the synthetic column exists (migration 046); re-run migration 049 after 046 lands to apply that filter. Powers /api/shortages/status-breakdown — surfaces how much forward-looking (anticipated) early-warning signal we hold vs in-progress (active) shortages, per country.';

-- ============================================================================
-- DOWN (reverse this migration):
--   DROP VIEW IF EXISTS v_shortage_status_by_country;
--   DROP INDEX IF EXISTS idx_shortage_events_anticipated_start;
--   ALTER TABLE shortage_events DROP COLUMN IF EXISTS anticipated_start_date;
-- No data is lost on the way down beyond the additive column itself; status
-- values are never touched by this migration in either direction.
-- ============================================================================

-- ── Verification (post-apply) ──────────────────────────────────────────────
-- Column exists, nullable, no default:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name='shortage_events' AND column_name='anticipated_start_date';
--   Expected: anticipated_start_date | date | YES | (null)
--
-- No existing row was reclassified (column starts NULL everywhere):
--   SELECT COUNT(*) FROM shortage_events WHERE anticipated_start_date IS NOT NULL;
--   Expected: 0 immediately post-apply (HC scrape backfills within a day).
--
-- Breakdown view returns one row per country:
--   SELECT country_code, active, anticipated, resolved, stale
--   FROM v_shortage_status_by_country ORDER BY anticipated DESC;
