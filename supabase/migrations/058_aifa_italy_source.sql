-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 058 — Seed the Italy AIFA pricing data_source
--
-- Italy connector (backend/scrapers/pricing/aifa_scraper.py) writes the public
-- retail price (Prezzo Pubblico) per AIC presentation from the AIFA Liste di
-- Trasparenza to drug_pricing_history. Needs its data_sources row for the
-- raw_scrapes FK. Pricing-source UUID block is 100+ (NADAC=…100, BDPM=…101).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, is_active, notes
) VALUES (
    '10000000-0000-0000-0000-000000000102',
    'Italy AIFA Liste di Trasparenza',
    'AIFA',
    'Italy', 'IT', 'Europe',
    'https://www.aifa.gov.it/liste-di-trasparenza',
    'https://www.aifa.gov.it/documents/20142/825643/Lista_farmaci_equivalenti.csv',
    168,  -- weekly (AIFA refreshes ~monthly)
    0.92,
    TRUE,
    'Official IT transparency lists (AIFA). Public retail price + SSN reference price per AIC, with principio attivo (INN) and ATC. price_type=retail_public. Stable-URL semicolon CSV.'
)
ON CONFLICT (id) DO NOTHING;
