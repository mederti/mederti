-- 080_vaccine_flag_and_pei_source.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. drugs.is_vaccine — vaccines were covered only incidentally (2026-11-23
--    audit: ~155 vaccine records, 187 live shortage events in 22 countries)
--    but nothing identified them: only 2 of those records carry an ATC J07
--    code. The flag is set by backend/scripts/classify_vaccines.py (ATC J07,
--    WHO EML section 19.3, multilingual name terms, curated brand list, with
--    explicit exclusions for look-alikes such as intravesical BCG for bladder
--    cancer and the RSV antibody nirsevimab). vaccine_signal records which rule
--    fired so every flag can be audited.
--
-- 2. data_sources row for the Paul-Ehrlich-Institut (PEI), Germany's vaccine
--    regulator. Vaccine supply interruptions are reported to PEI, not to the
--    BfArM list we already scrape, so German vaccine shortages were invisible.
--
-- Numbering: 076 is taken by PR #201, 079 by PR #272.
-- Additive and idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE drugs ADD COLUMN IF NOT EXISTS is_vaccine boolean NOT NULL DEFAULT false;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS vaccine_signal text;

COMMENT ON COLUMN drugs.is_vaccine IS
  'True when the record is a vaccine (set by backend/scripts/classify_vaccines.py).';
COMMENT ON COLUMN drugs.vaccine_signal IS
  'Rule that set is_vaccine: atc_j07 | who_eml_19_3 | name | brand.';

CREATE INDEX IF NOT EXISTS idx_drugs_is_vaccine ON drugs (id) WHERE is_vaccine;

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight,
    is_active, notes
) VALUES (
    '10000000-0000-0000-0000-000000000119',
    'Paul-Ehrlich-Institut — Lieferengpässe Humanimpfstoffe',
    'PEI',
    'Germany', 'DE', 'Europe',
    'https://www.pei.de/DE/arzneimittel/impfstoffe/lieferengpaesse/lieferengpaesse-node.html',
    NULL,
    24, 0.92,
    true,
    'German federal vaccine regulator. Lists human-vaccine supply interruptions '
    'expected to last more than two weeks (current table + yearly archive with end '
    'dates). Per product: name, vaccine type, PZN, start date, expected availability, '
    'MAH, alternatives. No reason field. German language. Vaccines only — BfArM covers '
    'other medicines.'
)
ON CONFLICT (id) DO NOTHING;
