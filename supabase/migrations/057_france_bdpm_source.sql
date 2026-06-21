-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 057 — Seed the France BDPM pricing data_source
--
-- France connector (backend/scrapers/pricing/france_bdpm_scraper.py) writes the
-- public retail price (prix public TTC) per CIP13 presentation to
-- drug_pricing_history. Needs its data_sources row for the raw_scrapes FK.
-- Pricing-source UUID block is 100+ (NADAC = …100).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, is_active, notes
) VALUES (
    '10000000-0000-0000-0000-000000000101',
    'France BDPM (Base de données publique des médicaments)',
    'BDPM',
    'France', 'FR', 'Europe',
    'https://base-donnees-publique.medicaments.gouv.fr/',
    'https://raw.githubusercontent.com/betagouv/api-medicaments/master/data/',
    168,  -- weekly
    0.92,
    TRUE,
    'Official FR public medicines DB (ANSM/HAS/UNCAM). Public retail price (TTC) + reimbursement rate per CIP13, joined from CIS_bdpm + CIS_CIP_bdpm. price_type=retail_public. Canonical ANSM telechargement endpoint is 404; sourced via the government betagouv/api-medicaments mirror.'
)
ON CONFLICT (id) DO NOTHING;
