-- ============================================================================
-- Migration 065: shortage_trends_monthly() aggregation RPC (+ country_code idx)
-- ============================================================================
-- Backs /api/insights/shortage-trends (the dashboard + intelligence trend
-- charts). Without this, the route drains the whole shortage_events table
-- (~30k rows) to Node and aggregates there on every cache miss, because a
-- WHERE country_code = … query is unindexed and times out (see the disk-IO /
-- migration-044 drift notes). This function does the month-bucketing IN
-- Postgres and returns ~18 tiny rows instead.
--
-- Two parts:
--   1. A plain btree index on country_code so the per-country scan below (and
--      any other country-only filter, e.g. the /api/shortages fallback) stops
--      sequential-scanning the table. 044's composite indexes only cover
--      status IN ('active','anticipated'); the trend function reads ALL
--      statuses (including resolved), so it needs this.
--   2. shortage_trends_monthly(p_country, p_from, p_to) → per-month:
--        onsets       new shortages STARTED that month (start_date)
--        resolved     shortages ENDED that month (end_date)
--        active       open at that month-end (start ≤ end, not yet ended)
--        anticipated  status='anticipated' by anticipated_start_date
--      p_country = 'ALL' aggregates every market. Status 'anticipated' rows are
--      excluded from onsets/resolved/active (they haven't started) and are the
--      sole source of the anticipated column — matching the route's split of
--      observed history vs regulator-published forward signal.
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS). Read-only; no data movement.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_shortage_events_country_code
  ON shortage_events (country_code);

CREATE OR REPLACE FUNCTION public.shortage_trends_monthly(
  p_country text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  month date,
  onsets integer,
  resolved integer,
  active integer,
  anticipated integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS MATERIALIZED (
    -- Scan the (optionally country-filtered) rows once, into memory.
    SELECT status, start_date, end_date, anticipated_start_date
    FROM public.shortage_events
    WHERE (p_country = 'ALL' OR country_code = p_country)
  ),
  months AS (
    SELECT gs::date AS m,
           (gs + interval '1 month' - interval '1 day')::date AS m_end
    FROM generate_series(date_trunc('month', p_from),
                         date_trunc('month', p_to),
                         interval '1 month') gs
  )
  SELECT
    mo.m AS month,
    (SELECT count(*) FROM ev e
       WHERE e.status IS DISTINCT FROM 'anticipated'
         AND e.start_date >= mo.m AND e.start_date < mo.m + interval '1 month')::int AS onsets,
    (SELECT count(*) FROM ev e
       WHERE e.status IS DISTINCT FROM 'anticipated'
         AND e.end_date >= mo.m AND e.end_date < mo.m + interval '1 month')::int AS resolved,
    (SELECT count(*) FROM ev e
       WHERE e.status IS DISTINCT FROM 'anticipated'
         AND e.start_date <= mo.m_end
         AND (e.end_date IS NULL OR e.end_date > mo.m_end))::int AS active,
    (SELECT count(*) FROM ev e
       WHERE e.status = 'anticipated'
         AND e.anticipated_start_date >= mo.m
         AND e.anticipated_start_date < mo.m + interval '1 month')::int AS anticipated
  FROM months mo
  ORDER BY mo.m;
$$;

COMMENT ON FUNCTION public.shortage_trends_monthly(text, date, date) IS
  'Monthly shortage time series (onsets/resolved/active/anticipated) for one market or ALL. Backs /api/insights/shortage-trends. Migration 065.';

-- Server routes call this with the service-role key, but grant execute to
-- authenticated too so it stays usable if ever called from a user session.
GRANT EXECUTE ON FUNCTION public.shortage_trends_monthly(text, date, date)
  TO authenticated, service_role;
