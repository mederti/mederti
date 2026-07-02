-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 064 — 14 new data_sources for the country-coverage expansion survey
--
-- See memory `project_country_coverage_expansion_survey` for the full research
-- trail (URLs, format, ease rating) behind each of these. UUID block 104-117
-- (100-103 already used by pricing sources; 200+ used by parallel-trade).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, scrape_frequency_hours, reliability_weight,
    is_active, notes
) VALUES
-- SI: Slovenia JAZMP
(
    '10000000-0000-0000-0000-000000000104',
    'JAZMP — Marketed Medicinal Products (Slovenia)',
    'JAZMP',
    'Slovenia', 'SI', 'Europe',
    'https://www.jazmp.si/en/human-medicines/data-on-medicinal-products/marketed-medicinal-products/',
    NULL,
    168, 0.85,
    true,
    'Slovenian medicines agency. PDF + Excel export of marketed/unavailable products. English page wrapper, Slovenian content.'
),
-- IS: Iceland Lyfjastofnun
(
    '10000000-0000-0000-0000-000000000105',
    'Lyfjastofnun — Tilkynntur lyfjaskortur (Iceland Medicines Agency)',
    'IMA',
    'Iceland', 'IS', 'Europe',
    'https://lyfjastofnun.is/lyf/lyfjaskortur/tilkynntur-lyfjaskortur/',
    NULL,
    24, 0.85,
    true,
    'Icelandic Medicines Agency reported-shortage searchable database. Icelandic language only, no login.'
),
-- BA: Bosnia & Herzegovina ALMBIH
(
    '10000000-0000-0000-0000-000000000106',
    'ALMBIH — Evidencija nestasice lijekova (Bosnia & Herzegovina)',
    'ALMBIH',
    'Bosnia and Herzegovina', 'BA', 'Europe',
    'https://lijekovi.almbih.gov.ba/EvidencijaNestasiceLijekova.aspx',
    NULL,
    24, 0.83,
    true,
    'Agency for Medicinal Products and Medical Devices of BiH. Sortable/paginated public HTML table with ATC/INN/dates/reasons, ~181 live entries. Bosnian language.'
),
-- TH: Thailand FDA (NDI)
(
    '10000000-0000-0000-0000-000000000107',
    'Thai FDA — National Drug Information shortage bulletin',
    'NDI-TH',
    'Thailand', 'TH', 'Asia Pacific',
    'https://ndi.fda.moph.go.th/ndi_news?category_id=17',
    NULL,
    24, 0.78,
    true,
    'Thai National Drug Information portal, drug-shortage news category. Monthly HTML bulletins categorizing drugs by shortage status. Thai language only.'
),
-- CO: Colombia INVIMA
(
    '10000000-0000-0000-0000-000000000108',
    'INVIMA — Desabastecimiento de medicamentos (Colombia)',
    'INVIMA',
    'Colombia', 'CO', 'Latin America',
    'https://www.invima.gov.co/productos-vigilados/medicamentos-y-productos-biologicos/desabastecimientos',
    NULL,
    168, 0.85,
    true,
    'Colombian medicines regulator. Structured monthly PDF list with explicit status taxonomy (desabastecido/riesgo/monitorización). Spanish language.'
),
-- HR: Croatia HALMED
(
    '10000000-0000-0000-0000-000000000109',
    'HALMED — Nestasica lijekova (Croatia)',
    'HALMED',
    'Croatia', 'HR', 'Europe',
    'https://halmed.hr/Lijekovi/Nestasica-lijekova/',
    NULL,
    168, 0.82,
    true,
    'Croatian medicines agency. PDF + Excel export, also mirrored as open data on data.gov.hr. Croatian language.'
),
-- LV: Latvia ZVA
(
    '10000000-0000-0000-0000-000000000110',
    'ZVA — Medicinal Product Availability Register (Latvia)',
    'ZVA',
    'Latvia', 'LV', 'Europe',
    'https://dati.zva.gov.lv/zr-med-availability/',
    NULL,
    24, 0.80,
    true,
    'Latvian State Agency of Medicines. Searchable AJAX-backed availability database, has an English toggle.'
),
-- RO: Romania ANMDMR
(
    '10000000-0000-0000-0000-000000000111',
    'ANMDMR — Notificari discontinuitate medicamente (Romania)',
    'ANMDMR',
    'Romania', 'RO', 'Europe',
    'https://www.anm.ro/',
    NULL,
    168, 0.65,
    true,
    'Romanian medicines agency. One-off PDF discontinuation-notice postings, site sparsely/irregularly maintained. Romanian language.'
),
-- LT: Lithuania VVKT
(
    '10000000-0000-0000-0000-000000000112',
    'VVKT — Vaistu tiekimo sutrikimai (Lithuania)',
    'VVKT',
    'Lithuania', 'LT', 'Europe',
    'https://vvkt.lrv.lt/',
    NULL,
    24, 0.75,
    true,
    'Lithuanian State Medicines Control Agency supply-disruption list. Real HTML list but blocks default bot user-agents (403) — scraper must send a browser-like User-Agent. Lithuanian language.'
),
-- EE: Estonia Ravimiamet
(
    '10000000-0000-0000-0000-000000000113',
    'Ravimiamet — Ravimiregister tarneraskused (Estonia)',
    'Ravimiamet',
    'Estonia', 'EE', 'Europe',
    'https://ravimiregister.ee/',
    NULL,
    24, 0.78,
    true,
    'Estonian State Agency of Medicines. Availability shown as colour-coded flags inside the general drug register rather than a standalone list. Has an English option.'
),
-- PE: Peru DIGEMID
(
    '10000000-0000-0000-0000-000000000114',
    'DIGEMID — Discontinuidad de Medicamentos (Peru)',
    'DIGEMID',
    'Peru', 'PE', 'Latin America',
    'https://serviciosweb-digemid.minsa.gob.pe/DiscontinuidadMedicamentos/Discontinuados',
    NULL,
    168, 0.75,
    true,
    'Peruvian medicines directorate discontinued-products database, plus separate monthly regional-availability reports. Framed as availability/discontinuation rather than shortage — requires schema mapping. Spanish language.'
),
-- SN: Senegal ARP
(
    '10000000-0000-0000-0000-000000000115',
    'ARP — Vigilances rupture d''approvisionnement (Senegal)',
    'ARP-SN',
    'Senegal', 'SN', 'Africa',
    'https://arp.sn/publications/',
    NULL,
    48, 0.70,
    true,
    'Agence senegalaise de Reglementation Pharmaceutique. Live-verified per-drug PDF/circular stock-rupture notices under the "Vigilances" section, no running index. French language.'
),
-- TW: Taiwan TFDA
(
    '10000000-0000-0000-0000-000000000116',
    'TFDA — Drug Supply Information Platform (Taiwan)',
    'TFDA',
    'Taiwan', 'TW', 'Asia Pacific',
    'https://www.fda.gov.tw/',
    'https://dsms.fda.gov.tw/',
    24, 0.65,
    true,
    'Taiwan FDA. Real per-drug data sits behind an interactive JS query tool (dsms.fda.gov.tw) needing headless-browser support; static fda.gov.tw bulletins are narrative case-count summaries only. Traditional Chinese.'
),
-- LK: Sri Lanka NMRA
(
    '10000000-0000-0000-0000-000000000117',
    'NMRA — Announcements (Sri Lanka)',
    'NMRA-LK',
    'Sri Lanka', 'LK', 'Asia Pacific',
    'https://www.nmra.gov.lk/announcements',
    NULL,
    24, 0.65,
    true,
    'Sri Lanka National Medicines Regulatory Authority. Live shortage notices confirmed but buried unstructured inside a general regulatory-announcements feed, no dedicated list. English, some Sinhala/Tamil.'
)
ON CONFLICT (id) DO UPDATE SET
    name               = EXCLUDED.name,
    abbreviation       = EXCLUDED.abbreviation,
    country            = EXCLUDED.country,
    country_code       = EXCLUDED.country_code,
    region             = EXCLUDED.region,
    source_url         = EXCLUDED.source_url,
    api_endpoint       = EXCLUDED.api_endpoint,
    scrape_frequency_hours = EXCLUDED.scrape_frequency_hours,
    reliability_weight = EXCLUDED.reliability_weight,
    is_active          = EXCLUDED.is_active,
    notes              = EXCLUDED.notes;
