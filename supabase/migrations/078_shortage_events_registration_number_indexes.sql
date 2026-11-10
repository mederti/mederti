-- ============================================================================
-- Migration 078: registration-number lookups on shortage_events
-- ============================================================================
-- NOT APPLIED. Needs Rob's or the CEO's approval before it is run on
-- production (drafted 2026-11-10 from the redesign review, item B5).
--
-- The drug page ties regulator notices to registered products by the
-- registration number inside raw_data:
--     country_code = 'AU' AND raw_data->>'artg_numb' IN (...)   -- TGA ARTG
--     country_code = 'CA' AND raw_data->>'din'       IN (...)   -- Health Canada DIN
-- (frontend/app/drugs/[id]/page.tsx, and the chat's product_status lookup).
--
-- No index covers those expressions, so Postgres reads every AU row of the
-- requested status and filters. Measured on production, 2026-11-10, EXPLAIN
-- (ANALYZE, BUFFERS) for one Amoxicillin page view:
--     resolved-history query: 1,561 buffers, 1,734 rows removed by filter, 7.2 ms
--     open-notices query:       705 buffers,   794 rows removed by filter, 2.0 ms
-- Those were cache hits; on a cold cache each is a disk read, on every drug
-- page view. With these indexes the lookups become a handful of index probes.
--
-- Expected benefit is from the plan shape; it has NOT been measured, because
-- that needs the index to exist. After applying, re-run the EXPLAINs above and
-- confirm an Index Scan / Bitmap Index Scan on the new index.
--
-- Size: shortage_events has ~61k rows; each index should be about 2 MB.
-- Plain CREATE INDEX takes a brief write lock on the table (seconds at this
-- size). Run it outside scraper hours (scrapers write 19:00-12:10 UTC), or
-- run each statement by hand with CONCURRENTLY outside a transaction.
--
-- Idempotent and reversible:
--     DROP INDEX IF EXISTS idx_shortage_events_country_artg;
--     DROP INDEX IF EXISTS idx_shortage_events_country_din;
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_shortage_events_country_artg
  ON shortage_events (country_code, (raw_data->>'artg_numb'));

CREATE INDEX IF NOT EXISTS idx_shortage_events_country_din
  ON shortage_events (country_code, (raw_data->>'din'));

COMMENT ON INDEX idx_shortage_events_country_artg IS
  'Drug page + chat: notices by TGA ARTG number (raw_data->>artg_numb) within a country.';
COMMENT ON INDEX idx_shortage_events_country_din IS
  'Drug page + chat: notices by Health Canada DIN (raw_data->>din) within a country.';
