-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006 — Extend drug_alternatives with import metadata
-- Run in Supabase SQL Editor before running alternatives_importer.py
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.drug_alternatives
    ADD COLUMN IF NOT EXISTS similarity_score  NUMERIC(3,2)
        CHECK (similarity_score IS NULL OR similarity_score BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'atc', 'rxnorm', 'fda_orange_book')),
    ADD COLUMN IF NOT EXISTS atc_match_level   INTEGER
        CHECK (atc_match_level IS NULL OR atc_match_level BETWEEN 2 AND 5),
    ADD COLUMN IF NOT EXISTS availability_note TEXT;

COMMENT ON COLUMN public.drug_alternatives.similarity_score IS
    '0.0–1.0 substitutability score: 0.95=equivalent, 0.80=pharmacological alt, 0.65=class alt, 0.50=broader class';
COMMENT ON COLUMN public.drug_alternatives.source IS
    'How this mapping was created: manual=human, atc=ATC hierarchy match, rxnorm=RxNorm API, fda_orange_book=Orange Book';
COMMENT ON COLUMN public.drug_alternatives.atc_match_level IS
    'ATC hierarchy level that matched (5=same drug, 4=subgroup, 3=therapeutic, 2=pharmacological)';
COMMENT ON COLUMN public.drug_alternatives.availability_note IS
    'Snapshot of current shortage status for the alternative at time of import';
