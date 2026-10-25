-- 076_tfda_opendata_source.sql
-- Taiwan scraper v2 (2026-10-26) reads TFDA's open-data platform feeds
-- (data.fda.gov.tw sets 104/105/106) instead of narrative press bulletins.
-- The data_sources row still described the old, lower-fidelity method.
-- Metadata only; no schema change. Safe to re-run.

UPDATE data_sources
SET source_url         = 'https://dsms.fda.gov.tw/',
    api_endpoint       = 'https://data.fda.gov.tw/data/opendata/export/104/json',
    reliability_weight = 0.90,
    notes              = 'Taiwan FDA Drug Supply Information Platform (西藥供應資訊平台) via open data: '
                         'set 104 (shortages with a recommended alternative), 105 (no alternative), '
                         '106 (resolved). Products are tied to active ingredients through the TFDA '
                         'licence register (set 36). TFDA publishes no shortage start date: start dates '
                         'are the earliest notice-update date. Cited alternatives → alternative_evidence '
                         '(source_code tfda_supply_platform).'
WHERE id = '10000000-0000-0000-0000-000000000116';
