-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 — Drug Recall Tracking
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates:
--   recalls                  — deduplicated recall events
--   recall_shortage_links    — intelligence links between recalls and shortages
-- Inserts data_sources rows for all recall data sources (US, CA, AU, EU, GB,
--   DE, FR, IT, ES, NZ, SG)
-- Also: ALTER alert_notifications to make shortage_event_id nullable
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. recalls ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recalls (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    recall_id         TEXT        NOT NULL UNIQUE,   -- MD5 dedup key
    drug_id           UUID        REFERENCES drugs(id) ON DELETE SET NULL,
    source_id         UUID        NOT NULL REFERENCES data_sources(id),
    country_code      CHAR(2)     NOT NULL,
    recall_class      TEXT        CHECK (recall_class IN ('I','II','III','Unclassified')),
    recall_type       TEXT        CHECK (recall_type IN ('batch','product_wide','market_withdrawal')),
    reason            TEXT,
    reason_category   TEXT        CHECK (reason_category IN (
                          'contamination','mislabelling','subpotency','packaging',
                          'sterility','foreign_matter','other')),
    lot_numbers       TEXT[]      NOT NULL DEFAULT '{}',
    manufacturer      TEXT,
    brand_name        TEXT,
    generic_name      TEXT        NOT NULL,
    announced_date    DATE        NOT NULL,
    completion_date   DATE,
    status            TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','ongoing')),
    press_release_url TEXT,
    confidence_score  INTEGER     NOT NULL DEFAULT 80 CHECK (confidence_score BETWEEN 0 AND 100),
    raw_data          JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_recalls_updated_at
    BEFORE UPDATE ON recalls
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_recalls_drug_id    ON recalls (drug_id) WHERE drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recalls_country    ON recalls (country_code);
CREATE INDEX IF NOT EXISTS idx_recalls_class      ON recalls (recall_class);
CREATE INDEX IF NOT EXISTS idx_recalls_status     ON recalls (status);
CREATE INDEX IF NOT EXISTS idx_recalls_announced  ON recalls (announced_date DESC);
CREATE INDEX IF NOT EXISTS idx_recalls_drug_class ON recalls (drug_id, recall_class, announced_date DESC)
    WHERE drug_id IS NOT NULL;

-- ── 2. recall_shortage_links ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recall_shortage_links (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recall_id    UUID NOT NULL REFERENCES recalls(id) ON DELETE CASCADE,
    shortage_id  UUID NOT NULL REFERENCES shortage_events(id) ON DELETE CASCADE,
    link_type    TEXT NOT NULL CHECK (link_type IN (
                     'recall_caused_shortage','shortage_preceded_recall','concurrent')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recall_shortage UNIQUE (recall_id, shortage_id)
);

CREATE INDEX IF NOT EXISTS idx_rsl_recall_id   ON recall_shortage_links (recall_id);
CREATE INDEX IF NOT EXISTS idx_rsl_shortage_id ON recall_shortage_links (shortage_id);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE recalls               ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_shortage_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recalls: public read"
    ON recalls FOR SELECT USING (true);

CREATE POLICY "recalls: service_role write"
    ON recalls FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "rsl: public read"
    ON recall_shortage_links FOR SELECT USING (true);

CREATE POLICY "rsl: service_role write"
    ON recall_shortage_links FOR ALL USING (auth.role() = 'service_role');

-- ── 4. Make alert_notifications.shortage_event_id nullable ───────────────────
-- Allows recall alerts to be recorded without a linked shortage_event

ALTER TABLE alert_notifications
    ALTER COLUMN shortage_event_id DROP NOT NULL;

-- ── 5. data_sources rows ─────────────────────────────────────────────────────

INSERT INTO data_sources (
    id, name, abbreviation, country, country_code, region,
    source_url, api_endpoint, reliability_weight, notes
) VALUES
-- FDA full recall DB (all classes, all manufacturers)
('10000000-0000-0000-0000-000000000025',
 'FDA Drug Enforcement — Full Recall Database', 'FDA-Recalls',
 'United States', 'US', 'Americas',
 'https://www.accessdata.fda.gov/scripts/ires/',
 'https://api.fda.gov/drug/enforcement.json',
 0.97,
 'Full FDA recall DB: Class I/II/III, all manufacturers.'),

-- Health Canada recalls open data
('10000000-0000-0000-0000-000000000026',
 'Health Canada — Recalls and Safety Alerts', 'HC-Recalls',
 'Canada', 'CA', 'Americas',
 'https://recalls-rappels.canada.ca/en/search/site',
 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json',
 0.93,
 'HC open data recall feed. Filter product_type=Drug.'),

-- TGA DRAC (existing SOURCE_ID confirmed in tga_recalls_scraper.py)
('10000000-0000-0000-0000-000000000027',
 'TGA — Product Recalls (Australia)', 'TGA-Recalls',
 'Australia', 'AU', 'Asia-Pacific',
 'https://apps.tga.gov.au/PROD/DRAC/arn-entry.aspx',
 NULL,
 0.93,
 'TGA DRAC recall database. Excel export only; Playwright required.'),

-- EMA withdrawals / referrals dataset
('10000000-0000-0000-0000-000000000028',
 'EMA — Withdrawn Medicines & Recalls', 'EMA-Recalls',
 'European Union', 'EU', 'Europe',
 'https://www.ema.europa.eu/en/medicines/download-medicine-data',
 'https://www.ema.europa.eu/sites/default/files/Medicines_output_withdrawn_authorisations.xlsx',
 0.95,
 'EMA EPAR withdrawn authorisations dataset + referrals.'),

-- MHRA GOV.UK drug/device alerts RSS
('10000000-0000-0000-0000-000000000029',
 'MHRA — Drug Alerts & Recalls (UK)', 'MHRA-Recalls',
 'United Kingdom', 'GB', 'Europe',
 'https://www.gov.uk/drug-device-alerts',
 'https://www.gov.uk/drug-device-alerts.atom',
 0.95,
 'GOV.UK Drug/Device Alerts Atom feed.'),

-- BfArM Germany — PharmNet.Bund
('10000000-0000-0000-0000-000000000030',
 'BfArM — Drug Recalls (Germany)', 'BfArM-Recalls',
 'Germany', 'DE', 'Europe',
 'https://www.pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html',
 NULL,
 0.90,
 'BfArM PharmNet.Bund recall list. HTML scraping required.'),

-- ANSM France
('10000000-0000-0000-0000-000000000031',
 'ANSM — Rappels de Lots (France)', 'ANSM-Recalls',
 'France', 'FR', 'Europe',
 'https://ansm.sante.fr/rappels-de-lots',
 NULL,
 0.90,
 'ANSM France lot recall notices. HTML scraping required.'),

-- AIFA Italy
('10000000-0000-0000-0000-000000000032',
 'AIFA — Drug Recalls (Italy)', 'AIFA-Recalls',
 'Italy', 'IT', 'Europe',
 'https://www.aifa.gov.it/richiami',
 NULL,
 0.88,
 'AIFA Italy recall notices + open data JSON where available.'),

-- AEMPS Spain — CIMA
('10000000-0000-0000-0000-000000000033',
 'AEMPS — Drug Recalls (Spain)', 'AEMPS-Recalls',
 'Spain', 'ES', 'Europe',
 'https://cima.aemps.es/cima/publico/lista.html',
 NULL,
 0.88,
 'AEMPS CIMA Spain recall notices. HTML scraping required.'),

-- Medsafe New Zealand
('10000000-0000-0000-0000-000000000034',
 'Medsafe — Product Recalls (New Zealand)', 'Medsafe-Recalls',
 'New Zealand', 'NZ', 'Asia-Pacific',
 'https://www.medsafe.govt.nz/safety/Recalls.asp',
 NULL,
 0.88,
 'Medsafe NZ recall notices. HTML scraping required.'),

-- HSA Singapore
('10000000-0000-0000-0000-000000000035',
 'HSA — Drug Recalls (Singapore)', 'HSA-Recalls',
 'Singapore', 'SG', 'Asia-Pacific',
 'https://www.hsa.gov.sg/announcements/safety-alerts-and-product-recalls',
 NULL,
 0.88,
 'HSA Singapore safety alerts and product recalls. HTML scraping required.')

ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    api_endpoint   = EXCLUDED.api_endpoint,
    notes          = EXCLUDED.notes;
