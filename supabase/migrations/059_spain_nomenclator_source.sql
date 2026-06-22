-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 059 — Seed the Spain Nomenclátor de facturación data_source
--
-- Spain connector (backend/scrapers/pricing/spain_nomenclator_scraper.py)
-- writes the public retail price (PVP con IVA) per Código Nacional from the
-- Ministerio de Sanidad Nomenclátor de facturación to drug_pricing_history.
-- Pricing-source UUID block 100+ (NADAC=…100, BDPM=…101, AIFA=…102).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight, is_active, notes
) VALUES (
    '10000000-0000-0000-0000-000000000103',
    'Spain Nomenclátor de facturación (SNS)',
    'NOMEN-ES',
    'Spain', 'ES', 'Europe',
    'https://www.sanidad.gob.es/profesionales/nomenclator.do',
    'https://www.sanidad.gob.es/profesionales/nomenclator.do',
    168,  -- weekly (Sanidad refreshes monthly, ~25th)
    0.92,
    TRUE,
    'Official ES billing nomenclator (Ministerio de Sanidad). Public retail price (PVP con IVA) + reference price per Código Nacional, with principio activo (INN). Medicines only (devices filtered). Session-primed displaytag CSV export. price_type=retail_public.'
)
ON CONFLICT (id) DO NOTHING;
