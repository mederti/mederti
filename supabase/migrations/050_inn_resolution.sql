-- 050_inn_resolution.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Robust INN resolution: molecule rollup + low-confidence review queue.
--
-- Problem this solves
-- -------------------
-- `drugs` accumulates a separate row per scraper spelling of the same molecule:
--   "Atorvastatin", "Atorvastatin Calcium Tablets", "Atorvastatina Viatris",
--   "Atorvastatin-Calcium-Trihydrate", "Gazyva" (brand) … all distinct rows,
--   each holding a slice of the shortage history. Brand→generic and
--   salt→base rollups silently fail, so a drug page shows a fraction of the
--   real shortage picture.
--
-- The fix is a *molecule identity* keyed on the FDA UNII (substance identifier).
-- Every `drugs` row is resolved (via RxNorm/RxNav → base ingredient → UNII) to
-- an INN + rxcui + unii + atc. Variant rows point `canonical_drug_id` at the
-- single canonical INN row so the application layer can aggregate across them.
--
-- The rxcui / unii / atc_code columns already exist (migration 024). This
-- migration adds the rollup pointer, the resolved-INN cache, the crosswalk
-- indexes, and the human review queue for matches we are NOT confident enough
-- to auto-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Molecule rollup on `drugs` ────────────────────────────────────────────

ALTER TABLE drugs
    -- Self-FK to the canonical INN row for this molecule. NULL ⇒ this row IS the
    -- canonical head (or is not yet resolved). Salt/form/language/brand variants
    -- point here so shortages can be summed across the molecule.
    ADD COLUMN IF NOT EXISTS canonical_drug_id UUID REFERENCES drugs(id),
    -- The resolved International Nonproprietary Name (lowercased base substance),
    -- distinct from the messy regulator-supplied `generic_name`. Populated by the
    -- INN-resolution importer; authoritative key for molecule identity alongside `unii`.
    ADD COLUMN IF NOT EXISTS resolved_inn TEXT,
    -- How `unii`/`resolved_inn`/`canonical_drug_id` were set, for auditability:
    --   'rxnav_base_ingredient' | 'openfda' | 'manual' | 'review_approved'
    ADD COLUMN IF NOT EXISTS inn_resolution_method TEXT,
    -- 0.0–1.0 confidence of the resolution. Auto-applied rows are ≥ the importer's
    -- high-confidence threshold; lower scores go to drug_resolution_review instead.
    ADD COLUMN IF NOT EXISTS inn_resolution_confidence NUMERIC(3,2),
    ADD COLUMN IF NOT EXISTS inn_resolved_at TIMESTAMPTZ;

-- Crosswalk indexes: let non-US identifiers (DIN/PBS/ATC/PZN-bearing rows) and
-- future scrapes find the same molecule by UNII / RxCUI in O(log n).
CREATE INDEX IF NOT EXISTS idx_drugs_unii              ON drugs (unii)              WHERE unii IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drugs_canonical_drug_id ON drugs (canonical_drug_id) WHERE canonical_drug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drugs_resolved_inn      ON drugs (resolved_inn)      WHERE resolved_inn IS NOT NULL;

COMMENT ON COLUMN drugs.canonical_drug_id IS
    'Self-FK to the canonical INN row for this molecule (UNII-keyed). NULL = this row is canonical or unresolved. Set by backend/importers/inn_resolution.py.';
COMMENT ON COLUMN drugs.resolved_inn IS
    'Lowercased base substance (INN) resolved via RxNorm/RxNav base-ingredient + UNII. Authoritative molecule key; differs from the regulator-supplied generic_name.';

-- ── 2. Low-confidence review queue ───────────────────────────────────────────
-- We auto-apply only high-confidence resolutions. Anything ambiguous (combo
-- products, no RxCUI, INN text mismatch, multiple candidate heads) is logged
-- here for a human to approve/reject rather than guessed at.

CREATE TABLE IF NOT EXISTS drug_resolution_review (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What we tried to resolve
    drug_id           UUID REFERENCES drugs(id) ON DELETE CASCADE,  -- the existing row, if any
    raw_name          TEXT NOT NULL,        -- original ingredient/generic string
    source            TEXT,                 -- scraper / country / 'inn_resolution_backfill'
    cleaned_name      TEXT,                 -- after salt/dosage stripping
    removed_salts     TEXT[],               -- counter-ions/hydrates stripped, for audit

    -- Best candidate the resolver produced (may be partial)
    candidate_inn         TEXT,
    candidate_rxcui       TEXT,
    candidate_unii        TEXT,
    candidate_atc         TEXT,
    candidate_drug_id     UUID REFERENCES drugs(id),  -- proposed canonical head, if found
    confidence            NUMERIC(3,2),
    method                TEXT,
    reason                TEXT,             -- why it wasn't auto-applied (e.g. 'combo', 'no-rxcui', 'inn-text-mismatch')

    -- Review workflow
    status            TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    reviewer          TEXT,
    review_notes      TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ,

    CONSTRAINT drug_resolution_review_status_chk
        CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- One open review per (raw_name, source) so re-runs are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_drug_resolution_review_key
    ON drug_resolution_review (raw_name, COALESCE(source, ''));
CREATE INDEX IF NOT EXISTS idx_drug_resolution_review_status
    ON drug_resolution_review (status) WHERE status = 'pending';

COMMENT ON TABLE drug_resolution_review IS
    'Queue of INN resolutions too uncertain to auto-apply. Populated by backend/importers/inn_resolution.py; a human approves/rejects rather than the pipeline guessing.';

-- RLS: lock it down like the other ops tables (migration 029 pattern). Only the
-- service role (scrapers/importers) and admins touch it; no anon/auth access.
ALTER TABLE drug_resolution_review ENABLE ROW LEVEL SECURITY;

-- ── 3. Molecule rollup view ──────────────────────────────────────────────────
-- Maps every drug to its molecule head and rolls active-shortage counts up to
-- the molecule. The application layer reads this to render a drug page that
-- shows the *whole* molecule's shortage picture rather than one fragment's.

CREATE OR REPLACE VIEW molecule_rollup
    WITH (security_invoker = true) AS
SELECT
    d.id                                   AS drug_id,
    COALESCE(d.canonical_drug_id, d.id)    AS molecule_id,
    h.generic_name                         AS molecule_name,
    COALESCE(h.resolved_inn, d.resolved_inn) AS molecule_inn,
    COALESCE(h.unii, d.unii)               AS molecule_unii,
    COALESCE(h.atc_code, d.atc_code)       AS molecule_atc,
    d.generic_name                         AS variant_name,
    (SELECT COUNT(*) FROM shortage_events se
       WHERE se.drug_id = d.id AND se.status = 'active') AS variant_active_shortages
FROM drugs d
LEFT JOIN drugs h ON h.id = COALESCE(d.canonical_drug_id, d.id);

COMMENT ON VIEW molecule_rollup IS
    'Each drug row mapped to its molecule head (canonical_drug_id) with per-variant active shortage counts. Aggregate by molecule_id to get the full molecule picture.';
