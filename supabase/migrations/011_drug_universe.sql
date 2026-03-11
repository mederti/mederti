-- ============================================================
-- Migration 011: Drug Universe Schema (multi-country)
-- ============================================================

-- 1. Active ingredients (shared global lookup layer)
CREATE TABLE IF NOT EXISTS active_ingredients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  name_normalised     text GENERATED ALWAYS AS (lower(trim(name))) STORED,
  inn                 text,
  atc_code            text,
  who_essential       boolean DEFAULT false,
  drug_class          text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE(name_normalised)
);

-- 2. Sponsors (manufacturers / MAHs — shared across countries)
CREATE TABLE IF NOT EXISTS sponsors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  name_normalised     text GENERATED ALWAYS AS (lower(trim(name))) STORED,
  country             text,
  created_at          timestamptz DEFAULT now(),
  UNIQUE(name_normalised)
);

-- 3. Drug products (one row per registry entry, any country)
CREATE TABLE IF NOT EXISTS drug_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_id         text NOT NULL,
  product_name        text NOT NULL,
  trade_name          text,
  strength            text,
  dosage_form         text,
  route               text,
  product_category    text,
  schedule            text,
  nhs_listed          boolean DEFAULT false,
  pbs_listed          boolean DEFAULT false,
  is_generic          boolean DEFAULT false,
  sponsor_id          uuid REFERENCES sponsors(id),
  registry_status     text DEFAULT 'Active',
  registration_date   date,
  cancellation_date   date,
  country             text NOT NULL,
  source              text NOT NULL,
  raw_data            jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE(source, registry_id)
);

-- 4. Junction: product <-> active ingredients (many-to-many)
CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id          uuid REFERENCES drug_products(id) ON DELETE CASCADE,
  ingredient_id       uuid REFERENCES active_ingredients(id),
  quantity            text,
  quantity_unit       text,
  is_primary          boolean DEFAULT true,
  PRIMARY KEY (product_id, ingredient_id)
);

-- 5. Drug availability / shortage status (country-level)
CREATE TABLE IF NOT EXISTS drug_availability (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid REFERENCES drug_products(id),
  ingredient_id        uuid REFERENCES active_ingredients(id),
  country              text NOT NULL,
  status               text NOT NULL DEFAULT 'available',
  severity             text,
  shortage_reason      text,
  expected_resolution  date,
  resolution_range_min date,
  resolution_range_max date,
  confidence_score     integer,
  source_agency        text,
  source_url           text,
  last_verified_at     timestamptz DEFAULT now(),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE(product_id, country)
);

-- Indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_drug_products_registry    ON drug_products(source, registry_id);
CREATE INDEX IF NOT EXISTS idx_drug_products_name        ON drug_products USING gin(to_tsvector('english', product_name));
CREATE INDEX IF NOT EXISTS idx_drug_products_sponsor     ON drug_products(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_drug_products_country     ON drug_products(country);
CREATE INDEX IF NOT EXISTS idx_active_ingredients_name   ON active_ingredients(name_normalised);
CREATE INDEX IF NOT EXISTS idx_drug_availability_country ON drug_availability(country);
CREATE INDEX IF NOT EXISTS idx_drug_availability_status  ON drug_availability(status);
CREATE INDEX IF NOT EXISTS idx_product_ingredients_ing   ON product_ingredients(ingredient_id);

-- Views
CREATE OR REPLACE VIEW v_au_drug_universe AS
SELECT
  dp.registry_id      AS artg_id,
  dp.product_name,
  dp.trade_name,
  dp.strength,
  dp.dosage_form,
  dp.route,
  dp.schedule,
  dp.pbs_listed,
  dp.registry_status,
  ai.name             AS primary_ingredient,
  ai.who_essential,
  ai.atc_code,
  s.name              AS sponsor,
  da.status           AS availability_status,
  da.severity,
  da.expected_resolution,
  da.last_verified_at
FROM drug_products dp
LEFT JOIN product_ingredients pi2 ON pi2.product_id = dp.id AND pi2.is_primary = true
LEFT JOIN active_ingredients  ai  ON ai.id = pi2.ingredient_id
LEFT JOIN sponsors            s   ON s.id  = dp.sponsor_id
LEFT JOIN drug_availability   da  ON da.product_id = dp.id AND da.country = 'AU'
WHERE dp.country = 'AU';

CREATE OR REPLACE VIEW v_gb_drug_universe AS
SELECT
  dp.registry_id      AS pl_number,
  dp.product_name,
  dp.trade_name,
  dp.strength,
  dp.dosage_form,
  dp.route,
  dp.schedule,
  dp.nhs_listed,
  dp.registry_status,
  ai.name             AS primary_ingredient,
  ai.who_essential,
  ai.atc_code,
  s.name              AS sponsor,
  da.status           AS availability_status,
  da.severity,
  da.expected_resolution,
  da.last_verified_at
FROM drug_products dp
LEFT JOIN product_ingredients pi2 ON pi2.product_id = dp.id AND pi2.is_primary = true
LEFT JOIN active_ingredients  ai  ON ai.id = pi2.ingredient_id
LEFT JOIN sponsors            s   ON s.id  = dp.sponsor_id
LEFT JOIN drug_availability   da  ON da.product_id = dp.id AND da.country = 'GB'
WHERE dp.country = 'GB';

CREATE OR REPLACE VIEW v_drug_universe_global AS
SELECT
  dp.country,
  dp.registry_id,
  dp.product_name,
  dp.strength,
  dp.dosage_form,
  dp.route,
  dp.registry_status,
  ai.name             AS primary_ingredient,
  ai.who_essential,
  s.name              AS sponsor,
  da.status           AS availability_status,
  da.severity
FROM drug_products dp
LEFT JOIN product_ingredients pi2 ON pi2.product_id = dp.id AND pi2.is_primary = true
LEFT JOIN active_ingredients  ai  ON ai.id = pi2.ingredient_id
LEFT JOIN sponsors            s   ON s.id  = dp.sponsor_id
LEFT JOIN drug_availability   da  ON da.product_id = dp.id AND da.country = dp.country;
