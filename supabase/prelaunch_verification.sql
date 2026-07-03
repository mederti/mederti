-- ============================================================================
-- Pre-launch production DB verification
-- ----------------------------------------------------------------------------
-- Paste this WHOLE file into the Supabase SQL editor (project mleblwjozjvpbuztggxp)
-- and run it. It is READ-ONLY — it mutates nothing. It returns one row per
-- migration/object the live code depends on, with a PASS / FAIL status.
--
-- Any FAIL is a launch blocker: apply that migration in the SQL editor, then
-- re-run this. Rows are ordered by severity (security first).
--
-- Context: this project applies migrations manually and drift is routine
-- (044 was "applied" twice then vanished), so trust THIS query, not any doc.
-- ============================================================================

SELECT * FROM (

  -- 028 — is_admin column locked (privilege escalation). authenticated/anon
  -- must NOT hold UPDATE/INSERT on user_profiles.is_admin.
  SELECT 1 AS ord, '028' AS migration, 'is_admin column locked (priv-esc)' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COALESCE(string_agg(grantee || ':' || privilege_type, ', '), 'no bad grants') AS detail
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'is_admin'
    AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('UPDATE', 'INSERT')

  UNION ALL
  -- 047 — anon PostgREST read revoked. anon must have NO grants on `drugs`
  -- (representative of the whole public schema).
  SELECT 2, '047', 'anon direct read revoked (drugs)',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(string_agg(privilege_type, ', '), 'none')
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'drugs' AND grantee = 'anon'

  UNION ALL
  -- 062 — role='patient' permitted by the user_profiles CHECK constraint.
  SELECT 3, '062', 'patient role allowed by CHECK',
    CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(string_agg(conname, ', '), 'no CHECK mentions patient')
  FROM pg_constraint
  WHERE conrelid = 'public.user_profiles'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%patient%'

  UNION ALL
  -- 064 (sources) — 14 expansion data_sources rows (ids …104–117). Missing =
  -- every new-country scraper FK-fails on insert (the AR/HK/PL/TR failure mode).
  SELECT 4, '064-src', '14 expansion data_sources (104-117)',
    CASE WHEN count(*) = 14 THEN 'PASS' ELSE 'FAIL (' || count(*) || '/14)' END,
    'expected ids …0000000104 through …0000000117'
  FROM data_sources
  WHERE id::text LIKE '10000000-0000-0000-0000-0000000001%'
    AND right(id::text, 3) BETWEEN '104' AND '117'

  UNION ALL
  -- 066 — 5 backfilled data_sources rows (HK/IL/PL/AR/TR: ids …045,046,049,051,054).
  SELECT 5, '066', '5 backfilled data_sources (HK/IL/PL/AR/TR)',
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL (' || count(*) || '/5)' END,
    'expected ids …045, …046, …049, …051, …054'
  FROM data_sources
  WHERE id::text LIKE '10000000-0000-0000-0000-0000000000%'
    AND right(id::text, 3) IN ('045', '046', '049', '051', '054')

  UNION ALL
  -- 049 — anticipated_start_date column. 065's RPC body references it and
  -- FAILS TO CREATE without it, so this must exist BEFORE 065.
  SELECT 6, '049', 'shortage_events.anticipated_start_date',
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN count(*) = 1 THEN 'present' ELSE 'MISSING (apply before 065)' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shortage_events'
    AND column_name = 'anticipated_start_date'

  UNION ALL
  -- 065 — shortage_trends_monthly RPC. Without it the trends route falls back
  -- to draining ~30k rows per cache miss (disk-IO burn), not a hard failure.
  SELECT 7, '065', 'shortage_trends_monthly() RPC',
    CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN count(*) > 0 THEN 'present' ELSE 'missing (route drains table instead)' END
  FROM pg_proc WHERE proname = 'shortage_trends_monthly'

  UNION ALL
  -- 067 — pricing trigram + composite indexes. Without them the drug-page /
  -- price-trends name fallback hits the statement timeout (tolerated as empty).
  -- Apply with CREATE INDEX CONCURRENTLY, one at a time, outside a transaction.
  SELECT 8, '067', 'pricing trgm + composite indexes',
    CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL (' || count(*) || '/2)' END,
    COALESCE(string_agg(indexname, ', '), 'none')
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN ('idx_pricing_generic_name_trgm', 'idx_pricing_drug_country_date')

  UNION ALL
  -- 063 — manufacturing_facilities coordinates (map layer). Map degrades
  -- gracefully without these, so not a hard blocker.
  SELECT 9, '063', 'manufacturing_facilities lat/long/geocoded_at',
    CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'PARTIAL (' || count(*) || '/3)' END,
    COALESCE(string_agg(column_name, ', '), 'none')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manufacturing_facilities'
    AND column_name IN ('latitude', 'longitude', 'geocoded_at')

  UNION ALL
  -- 069 (was the duplicate 064) — manufacturers HQ coordinates (map layer).
  SELECT 10, '069', 'manufacturers hq_city/hq_latitude/hq_longitude',
    CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'PARTIAL (' || count(*) || '/3)' END,
    COALESCE(string_agg(column_name, ', '), 'none')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'manufacturers'
    AND column_name IN ('hq_city', 'hq_latitude', 'hq_longitude')

  UNION ALL
  -- 060 — parallel-trade tables. Found missing by a preview smoke test:
  -- /api/parallel-trade/search 500s even on a clean query when these are
  -- absent. Not a page-crash (drug-page panels degrade gracefully), but no
  -- parallel-trade data shows anywhere until this is applied.
  SELECT 11, '060', 'parallel_trade tables present',
    CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL (' || count(*) || '/2)' END,
    COALESCE(string_agg(table_name, ', '), 'neither table exists')
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('parallel_trade_licences', 'product_parallel_trade_matches')

) checks
ORDER BY ord;
