-- 079_data_health_runs.sql
--
-- One row per daily data-quality run (backend.health.daily_check --persist).
-- The ops email path (Resend) has been failing with 403 for months, so the
-- daily findings were only ever visible in a laptop log file. Persisting them
-- here lets /admin/freshness show the latest run and its history, and gives
-- the volume-drift detector a previous day's per-source counts to compare to.
--
-- Service-role only: RLS on, no policies, anon/authenticated revoked.

CREATE TABLE IF NOT EXISTS public.data_health_runs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    runner         TEXT        NOT NULL,            -- e.g. 'railway:shortage-cron-daily', 'mac', 'manual'
    overall        TEXT        NOT NULL CHECK (overall IN ('ok', 'warn', 'error')),
    errors         INTEGER     NOT NULL DEFAULT 0,
    warnings       INTEGER     NOT NULL DEFAULT 0,
    findings       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- Finding.to_dict() list
    scenarios      JSONB,                                     -- scenario-suite results, NULL if not run
    source_counts  JSONB,                                     -- {data_source_id: open non-synthetic shortage rows}
    duration_s     NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_data_health_runs_run_at ON public.data_health_runs (run_at DESC);

ALTER TABLE public.data_health_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_health_runs FROM anon, authenticated;

COMMENT ON TABLE public.data_health_runs IS
  'Daily data-quality check results (detectors + scenario suite). Written by backend.health.daily_check --persist; read by /api/admin/freshness.';
