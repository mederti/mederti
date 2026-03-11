-- Add WHO INN canonical ID to ingredients table
ALTER TABLE active_ingredients
  ADD COLUMN IF NOT EXISTS who_inn_id text,
  ADD COLUMN IF NOT EXISTS inn_name text,
  ADD COLUMN IF NOT EXISTS cas_number text;

-- Index for INN lookups
CREATE INDEX IF NOT EXISTS idx_ingredients_inn_id
  ON active_ingredients(who_inn_id)
  WHERE who_inn_id IS NOT NULL;

-- Add country codes to drug_products for EU multi-country handling
ALTER TABLE drug_products
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS extra_countries text[];

-- Verification counts view
CREATE OR REPLACE VIEW v_coverage_summary AS
SELECT
  country,
  source,
  COUNT(*)                                                    AS total_products,
  COUNT(CASE WHEN registry_status = 'Active' THEN 1 END)     AS active_products,
  COUNT(CASE WHEN pbs_listed OR nhs_listed THEN 1 END)       AS reimbursable,
  COUNT(CASE WHEN otc THEN 1 END)                            AS otc_products
FROM drug_products
GROUP BY country, source
ORDER BY total_products DESC;
