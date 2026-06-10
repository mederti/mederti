-- ============================================================================
-- Migration 055: dispensed_amount on drug_pricing (PBS trade-price ingest)
-- ============================================================================
-- The /api/search trade-price column and the drug-page price card display BOTH
-- sides of an Australian PBS price:
--
--   • AEMP — Approved Ex-Manufacturer Price → existing drug_pricing.price_amount
--   • DPMQ — Dispensed Price for Maximum Quantity → had nowhere to live
--
-- frontend/app/api/search/route.ts already SELECTs
--   drug_id,price_amount,dispensed_amount,currency,pack_size,price_date
-- behind a defensive probe ("the dispensed_amount column / populated rows may
-- not exist yet"), so search degrades to "no price" until this column exists.
-- This migration creates the column; the PBS importer
-- (backend/importers/pbs_pricing_importer.py) populates it monthly from the
-- PBS Schedule API (data-api.health.gov.au, refreshed on the 1st of the month).
--
-- DPMQ is kept as a sibling amount rather than a second row because the two
-- prices describe the SAME observation (one PBS item on one schedule date) —
-- a row per price-type would force the read path to re-join what the source
-- publishes as one record.
--
-- NON-DESTRUCTIVE: nullable column, no default, no backfill. Non-PBS pricing
-- rows (OECD class-level spend lives elsewhere; future NHS tariff etc.) simply
-- leave it NULL.
-- ============================================================================

ALTER TABLE drug_pricing
    ADD COLUMN IF NOT EXISTS dispensed_amount NUMERIC(14,4);

COMMENT ON COLUMN drug_pricing.dispensed_amount IS
    'Dispensed-side price for the same observation as price_amount (e.g. PBS DPMQ vs AEMP). NULL when the source publishes only one price.';
