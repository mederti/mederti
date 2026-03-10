-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — New data sources (NZ, SG, FDA supply-side signals)
-- Run in Supabase SQL Editor after deploying new scrapers.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight,
    is_active, notes
)
VALUES
-- Pharmac New Zealand
(
    '10000000-0000-0000-0000-000000000021',
    'Pharmac — New Zealand Medicine Supply Disruptions',
    'Pharmac',
    'New Zealand', 'NZ', 'Asia-Pacific',
    'https://www.pharmac.govt.nz/medicine-funding-and-supply/medicine-notices/',
    'https://www.pharmac.govt.nz/api/medicineindex/data/7967',
    24, 0.90,
    true,
    'NZ pharmaceutical management agency. JSON API backed by Umbraco CMS. Covers Supply issues, Discontinuations, Recalls.'
),
-- Health Sciences Authority, Singapore (post-registration actions as supply signals)
(
    '10000000-0000-0000-0000-000000000022',
    'Health Sciences Authority — Singapore Post-Registration Actions',
    'HSA-SG',
    'Singapore', 'SG', 'Asia-Pacific',
    'https://www.hsa.gov.sg/therapeutic-products/listing-of-approvals-and-post-registration-actions/listing-of-post-registration-actions',
    null,
    24, 0.80,
    true,
    'Supply-side signal. Covers product cancellations (resolved) and MAH transfers (anticipated). Full shortage DHCPL letters are behind SingPass auth.'
),
-- FDA Drug Enforcement (foreign manufacturer supply-side signal)
(
    '10000000-0000-0000-0000-000000000024',
    'FDA Drug Enforcement — Foreign Manufacturer Recalls',
    'FDA-FE',
    'United States', 'US', 'Americas',
    'https://www.accessdata.fda.gov/scripts/ires/',
    'https://api.fda.gov/drug/enforcement.json',
    168, 0.85,
    true,
    'Supply-side signal. Class I/II ongoing drug recalls from non-US manufacturers. Leading indicator of foreign facility compliance issues.'
)
ON CONFLICT (id) DO UPDATE SET
    name               = EXCLUDED.name,
    abbreviation       = EXCLUDED.abbreviation,
    source_url         = EXCLUDED.source_url,
    api_endpoint       = EXCLUDED.api_endpoint,
    scrape_frequency_hours = EXCLUDED.scrape_frequency_hours,
    reliability_weight = EXCLUDED.reliability_weight,
    is_active          = EXCLUDED.is_active,
    notes              = EXCLUDED.notes;
