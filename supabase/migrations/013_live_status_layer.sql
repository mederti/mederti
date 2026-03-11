-- ============================================================
-- STEP 1: Scraper run tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS scraper_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper_name    text NOT NULL,
  country         text NOT NULL,
  started_at      timestamptz DEFAULT now(),
  finished_at     timestamptz,
  status          text DEFAULT 'running',
  products_checked  integer DEFAULT 0,
  products_updated  integer DEFAULT 0,
  products_new      integer DEFAULT 0,
  error_message   text,
  run_metadata    jsonb
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_name    ON scraper_runs(scraper_name);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_started ON scraper_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_status  ON scraper_runs(status);

CREATE OR REPLACE VIEW v_scraper_health AS
SELECT DISTINCT ON (scraper_name)
  scraper_name, country, status, started_at, finished_at,
  products_checked, products_updated, products_new, error_message,
  EXTRACT(EPOCH FROM (finished_at - started_at))::integer AS duration_seconds,
  EXTRACT(EPOCH FROM (now() - started_at))::integer / 3600 AS hours_since_run
FROM scraper_runs
ORDER BY scraper_name, started_at DESC;

-- ============================================================
-- STEP 2: Status history — every status change logged
-- ============================================================

CREATE TABLE IF NOT EXISTS drug_availability_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid REFERENCES drug_products(id),
  ingredient_id   uuid REFERENCES active_ingredients(id),
  country         text NOT NULL,
  old_status      text,
  new_status      text NOT NULL,
  scraper_name    text,
  source_agency   text,
  source_url      text,
  changed_at      timestamptz DEFAULT now(),
  run_id          uuid REFERENCES scraper_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_history_product    ON drug_availability_history(product_id);
CREATE INDEX IF NOT EXISTS idx_history_ingredient ON drug_availability_history(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_history_country    ON drug_availability_history(country);
CREATE INDEX IF NOT EXISTS idx_history_changed    ON drug_availability_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_status     ON drug_availability_history(new_status);

-- ============================================================
-- Daily snapshots — point-in-time record of all drug statuses
-- ============================================================

CREATE TABLE IF NOT EXISTS drug_status_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   date NOT NULL DEFAULT CURRENT_DATE,
  country         text NOT NULL,
  total_products  integer,
  in_shortage     integer,
  recalled        integer,
  discontinued    integer,
  available       integer,
  snapshot_data   jsonb,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, country)
);

-- ============================================================
-- Shortage duration view
-- ============================================================

CREATE OR REPLACE VIEW v_shortage_duration AS
SELECT
  dp.product_name,
  dp.country,
  da.status,
  da.severity,
  ai.name           AS primary_ingredient,
  da.expected_resolution,
  da.last_verified_at,
  MIN(h.changed_at) FILTER (WHERE h.new_status = 'shortage') AS shortage_started,
  EXTRACT(DAY FROM now() - MIN(h.changed_at) FILTER (WHERE h.new_status = 'shortage'))::integer AS days_in_shortage,
  COUNT(h.id)       AS status_changes
FROM drug_availability da
JOIN drug_products dp ON dp.id = da.product_id
LEFT JOIN product_ingredients pi2 ON pi2.product_id = dp.id AND pi2.is_primary = true
LEFT JOIN active_ingredients ai ON ai.id = pi2.ingredient_id
LEFT JOIN drug_availability_history h ON h.product_id = da.product_id AND h.country = da.country
WHERE da.status IN ('shortage', 'limited', 'recalled')
GROUP BY dp.product_name, dp.country, da.status, da.severity,
         ai.name, da.expected_resolution, da.last_verified_at
ORDER BY days_in_shortage DESC NULLS LAST;

-- ============================================================
-- Daily snapshot function — call after each scraper run
-- ============================================================

CREATE OR REPLACE FUNCTION take_daily_snapshot()
RETURNS void AS $$
BEGIN
  INSERT INTO drug_status_snapshots (snapshot_date, country, total_products,
    in_shortage, recalled, discontinued, available)
  SELECT
    CURRENT_DATE,
    country,
    COUNT(*)                                                     AS total_products,
    COUNT(*) FILTER (WHERE status = 'shortage')                  AS in_shortage,
    COUNT(*) FILTER (WHERE status = 'recalled')                  AS recalled,
    COUNT(*) FILTER (WHERE status = 'discontinued')              AS discontinued,
    COUNT(*) FILTER (WHERE status = 'available')                 AS available
  FROM drug_availability
  GROUP BY country
  ON CONFLICT (snapshot_date, country) DO UPDATE SET
    total_products = EXCLUDED.total_products,
    in_shortage    = EXCLUDED.in_shortage,
    recalled       = EXCLUDED.recalled,
    discontinued   = EXCLUDED.discontinued,
    available      = EXCLUDED.available;
END;
$$ LANGUAGE plpgsql;
