-- MapView: city-level HQ location for manufacturers.
-- Backfilled by backend/scripts/geocode_manufacturing_facilities.py --manufacturers
-- (Nominatim name+country lookup, dry-run first). Rows without coordinates
-- fall back to country-centroid markers labelled "country-level" in the UI.

ALTER TABLE manufacturers
  ADD COLUMN IF NOT EXISTS hq_city TEXT,
  ADD COLUMN IF NOT EXISTS hq_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS hq_longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS hq_geocoded_at TIMESTAMPTZ;
