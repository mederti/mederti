-- Migration 031: WHO ATC/DDD index canonical table
--
-- Backfills the ATC (Anatomical Therapeutic Chemical) classification system
-- from the WHO Collaborating Centre for Drug Statistics Methodology
-- (https://www.whocc.no/atc_ddd_index/).
--
-- The ATC tree is 5 levels deep:
--   Level 1 — Anatomical main group  (e.g.  A    — Alimentary tract)
--   Level 2 — Therapeutic subgroup   (e.g.  A10  — Drugs used in diabetes)
--   Level 3 — Pharmacological        (e.g.  A10B — Blood glucose lowering)
--   Level 4 — Chemical subgroup      (e.g.  A10BA — Biguanides)
--   Level 5 — Chemical substance     (e.g.  A10BA02 — Metformin)
--
-- DDD (Defined Daily Dose) values are level-5 only and let us compute
-- normalised cost-per-day comparisons across markets.

CREATE TABLE IF NOT EXISTS atc_codes (
  code         TEXT PRIMARY KEY,
  level        SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 5),
  description  TEXT NOT NULL,
  parent_code  TEXT REFERENCES atc_codes(code) ON DELETE SET NULL,

  -- DDD fields populated only for level 5 substances
  ddd_value    NUMERIC(10,4),
  ddd_unit     TEXT,        -- e.g. 'g', 'mg', 'mcg', 'IU', 'U'
  ddd_route    TEXT,        -- e.g. 'O' (oral), 'P' (parenteral), 'R' (rectal)
  ddd_note     TEXT,

  source_url   TEXT,
  imported_at  TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atc_codes_level       ON atc_codes (level);
CREATE INDEX IF NOT EXISTS idx_atc_codes_parent      ON atc_codes (parent_code);
CREATE INDEX IF NOT EXISTS idx_atc_codes_description ON atc_codes USING gin (to_tsvector('english', description));

-- RLS: public read, service-role write (importers only)
ALTER TABLE atc_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atc_codes_public_read" ON atc_codes;
CREATE POLICY "atc_codes_public_read" ON atc_codes
  FOR SELECT USING (true);

-- View: pre-joins drug ATC codes to their canonical descriptions and chain.
-- Lets the frontend show e.g. "A10BA02 — Metformin  (Biguanides · Blood glucose lowering · Drugs in diabetes)"
-- with one query.
CREATE OR REPLACE VIEW v_drug_atc_enriched AS
SELECT
  d.id          AS drug_id,
  d.generic_name,
  d.atc_code,
  c5.description AS atc_substance,
  c4.description AS atc_chemical_subgroup,
  c3.description AS atc_pharmacological_subgroup,
  c2.description AS atc_therapeutic_subgroup,
  c1.description AS atc_anatomical_group,
  c5.ddd_value,
  c5.ddd_unit,
  c5.ddd_route
FROM drugs d
LEFT JOIN atc_codes c5 ON c5.code = d.atc_code AND c5.level = 5
LEFT JOIN atc_codes c4 ON c4.code = SUBSTRING(d.atc_code FROM 1 FOR 5)  AND c4.level = 4
LEFT JOIN atc_codes c3 ON c3.code = SUBSTRING(d.atc_code FROM 1 FOR 4)  AND c3.level = 3
LEFT JOIN atc_codes c2 ON c2.code = SUBSTRING(d.atc_code FROM 1 FOR 3)  AND c2.level = 2
LEFT JOIN atc_codes c1 ON c1.code = SUBSTRING(d.atc_code FROM 1 FOR 1)  AND c1.level = 1;

GRANT SELECT ON v_drug_atc_enriched TO anon, authenticated;
