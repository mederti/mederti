-- 068: Promote brand + sponsor to first-class columns on shortage_events.
--
-- Hospital-pharmacist feedback (2026-07-03): shortage data is aggregated to
-- the ingredient level, but pharmacists procure by brand/SKU. The per-product
-- identity already arrives from the regulators and is preserved verbatim in
-- raw_data (e.g. TGA trade_names/sponsor, Health Canada brand_name/
-- company_name, EMA medicine_affected/marketing_authorisation_holder) — it is
-- just not queryable. First-class columns make brand-level display, filtering
-- and (later) brand-scoped watchlists possible without JSONB spelunking.
--
-- Both columns are nullable and honest-by-default: sources that publish no
-- product identity (e.g. MHRA) stay NULL and the UI must label them
-- ingredient-level. Populated by backend/scripts/backfill_event_brands.py
-- (idempotent; safe to re-run on cron until scrapers write these directly).

ALTER TABLE shortage_events ADD COLUMN IF NOT EXISTS brand_name TEXT;
ALTER TABLE shortage_events ADD COLUMN IF NOT EXISTS sponsor    TEXT;

COMMENT ON COLUMN shortage_events.brand_name IS
  'Trade/brand name of the specific product this event covers, as published by the regulator (TGA trade_names, Health Canada brand_name, EMA medicine_affected). NULL when the source reports at ingredient level only — never guessed from drugs.brand_names.';

COMMENT ON COLUMN shortage_events.sponsor IS
  'Sponsor / marketing-authorisation holder / company for this specific event (TGA Sponsor_Name, FDA company_name, Health Canada company_name, EMA MAH). NULL when the source does not publish it.';

-- Brand-scoped lookups per drug ("which brands of X are short, and when are
-- they back"). Partial: most historic rows stay NULL until backfilled.
CREATE INDEX IF NOT EXISTS idx_shortage_events_drug_brand
  ON shortage_events (drug_id, brand_name)
  WHERE brand_name IS NOT NULL;
