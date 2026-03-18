-- Make drug_id nullable — required for non-English markets (JP, KR, CN etc.)
-- where name matching to our English drugs table isn't feasible at scrape time
ALTER TABLE shortage_events ALTER COLUMN drug_id DROP NOT NULL;

-- Also make start_date nullable with a default (some sources don't provide dates)
ALTER TABLE shortage_events ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;
ALTER TABLE shortage_events ALTER COLUMN start_date DROP NOT NULL;
