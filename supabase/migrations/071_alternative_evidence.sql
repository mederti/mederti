-- 071_alternative_evidence.sql
-- Source-backed, cross-verified drug alternatives.
--
-- Why: every drug_alternatives row (migration 001/006) is an automated WHO-ATC
-- prefix pairing whose evidence grade, similarity score and dose note are fixed
-- lookups, not evidence (see PR #183). This table stores one row per STATEMENT
-- an external source actually makes ("X may be used instead of Y"), verbatim
-- and cited, so an alternative is only presented as verified when independent
-- sources agree, or when a regulator authorises the substitution.
--
-- drug_alternatives is left in place as unreviewed same-class context.

CREATE TABLE IF NOT EXISTS alternative_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Directed pair: the statement says `alternative` can replace `drug`.
  -- Resolved ids may be null when a source names a medicine we can't match
  -- yet; the raw names are always kept so the row stays auditable.
  drug_id               UUID REFERENCES drugs(id) ON DELETE CASCADE,
  alternative_drug_id   UUID REFERENCES drugs(id) ON DELETE CASCADE,
  drug_name_raw         TEXT NOT NULL,
  alternative_name_raw  TEXT NOT NULL,

  -- same_molecule: different strength / form / brand / overseas-registered
  --                product of the same active ingredient.
  -- therapeutic:   a different active ingredient.
  kind                  TEXT NOT NULL CHECK (kind IN ('same_molecule', 'therapeutic')),

  -- Who said it. `publisher` is the independence key: two rows from the same
  -- publisher never count as two independent sources.
  source_code           TEXT NOT NULL,   -- e.g. who_eml, tga_sssi, uk_ssp, fda_orange_book
  publisher             TEXT NOT NULL,   -- e.g. WHO, TGA, DHSC, FDA
  authority_type        TEXT NOT NULL CHECK (authority_type IN (
                          'regulator_legal',      -- legally authorises the swap (SSSI, SSP, Orange Book AB)
                          'regulator_guidance',   -- regulator/health-dept clinical guidance
                          'clinical_reference'    -- expert body list (WHO EML square box, ASHP)
                        )),
  source_ref            TEXT NOT NULL,   -- stable id within the source (instrument no., recommendation id)
  source_url            TEXT NOT NULL,
  statement             TEXT NOT NULL,   -- verbatim excerpt from the source, <= ~500 chars
  indication            TEXT NOT NULL DEFAULT '',  -- scope the source gives (EML section, SSP condition), verbatim; '' = none stated (NOT NULL so the unique key dedupes)
  country_code          TEXT,            -- jurisdiction; NULL = global (e.g. WHO)
  -- Same-molecule rows name a specific product (often drug_id = alternative_drug_id):
  alternative_product   TEXT,            -- verbatim product line: brand / strength / form / pack
  product_ref           TEXT,            -- registry id when the source gives one: AUST R, NDC/appl no., PZN, SSP no.
  route                 TEXT,            -- verbatim from source when stated
  dosage_form           TEXT,
  dose_statement        TEXT,            -- ONLY when the source itself states a dose/conversion, verbatim
  valid_from            DATE,
  valid_until           DATE,            -- e.g. SSSI / SSP expiry
  licence               TEXT,            -- reuse terms of the source, e.g. 'CC BY-NC-SA 3.0 IGO'

  retrieved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash          TEXT NOT NULL,   -- md5 of statement+ids; idempotent upserts
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_code, source_ref, drug_name_raw, alternative_name_raw, indication)
);

CREATE INDEX IF NOT EXISTS idx_alt_evidence_drug ON alternative_evidence (drug_id);
CREATE INDEX IF NOT EXISTS idx_alt_evidence_alt  ON alternative_evidence (alternative_drug_id);

-- Per directed pair: what the sources collectively support. Only CURRENT
-- statements count: a row past its valid_until (lapsed SSSI, expired SSP,
-- resolved shortage) is history, not a statement that holds today.
--   regulator_authorised  a current regulator_legal statement exists
--   verified              >= 2 distinct publishers currently state it
--   single_source         exactly 1 publisher states it (shown with citation, never as "verified")
-- Rows with unresolved drug ids are excluded until resolved.
CREATE OR REPLACE VIEW verified_alternatives WITH (security_invoker = true) AS
SELECT
  e.drug_id,
  e.alternative_drug_id,
  e.kind,
  COUNT(DISTINCT e.publisher)                                   AS publisher_count,
  ARRAY_AGG(DISTINCT e.publisher ORDER BY e.publisher)          AS publishers,
  BOOL_OR(e.authority_type = 'regulator_legal')                 AS has_current_legal_authority,
  CASE
    WHEN BOOL_OR(e.authority_type = 'regulator_legal') THEN 'regulator_authorised'
    WHEN COUNT(DISTINCT e.publisher) >= 2               THEN 'verified'
    ELSE 'single_source'
  END                                                           AS verification_status,
  MAX(e.retrieved_at)                                           AS last_checked_at
FROM alternative_evidence e
WHERE e.drug_id IS NOT NULL
  AND e.alternative_drug_id IS NOT NULL
  AND (e.valid_until IS NULL OR e.valid_until >= CURRENT_DATE)
  AND (e.valid_from  IS NULL OR e.valid_from  <= CURRENT_DATE)
GROUP BY e.drug_id, e.alternative_drug_id, e.kind;

ALTER TABLE alternative_evidence ENABLE ROW LEVEL SECURITY;
-- Read for signed-in users (matches migration 047's posture); writes are
-- service-role only (importers). No anon access.
DROP POLICY IF EXISTS alt_evidence_read ON alternative_evidence;
CREATE POLICY alt_evidence_read ON alternative_evidence FOR SELECT TO authenticated USING (true);
GRANT SELECT ON alternative_evidence TO authenticated;
GRANT SELECT ON verified_alternatives TO authenticated;
REVOKE ALL ON alternative_evidence FROM anon;
REVOKE ALL ON verified_alternatives FROM anon;
