-- MapView: store geocoded coordinates for manufacturing facilities.
-- Backfilled by backend/scripts/geocode_manufacturing_facilities.py.

ALTER TABLE manufacturing_facilities
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
