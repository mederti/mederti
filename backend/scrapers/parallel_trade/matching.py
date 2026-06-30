"""
Confidence scoring for parallel-trade-licence ⇄ Mederti-drug matches.

The brief defines this ladder:
    1.00  brand + INN + strength + form + pack + MA number
    0.90  brand + INN + strength + form
    0.80  INN + strength + form + pack
    0.65  INN + strength + form
    0.50  INN only
    < 0.65 ⇒ manual review

Honesty note (the important bit):
We can only *credit* a field when BOTH sides corroborate it. INN is the
resolution key, so it is always credited when a match exists. brand / strength /
form are corroborated against the drug's brand_names[] / strengths[] /
dosage_forms[] arrays. We currently have NO source for pack size or reference
MA number on the Mederti side, so those two are never corroborated today — which
means the 1.00 and 0.80 tiers (both require pack) effectively never auto-fire,
and the realistic ceiling is 0.90 (brand+INN+strength+form). The full ladder is
implemented anyway so the higher tiers light up automatically if pack/MA
corroboration is added later (e.g. drug_catalogue pack data, drug_external_ids).

score_match() is a pure function — unit-tested in tests/test_parallel_trade_matching.py.
"""

from __future__ import annotations

import re

REVIEW_THRESHOLD = 0.65


def _norm(s: str | None) -> str:
    """Lowercase, collapse whitespace, drop punctuation noise. For comparing
    short tokens (strength '20 mg' vs '20mg', form 'Film-coated tablet')."""
    if not s:
        return ""
    s = s.lower().strip()
    s = re.sub(r"[\s\-_/.,()]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _norm_strength(s: str | None) -> str:
    """Normalise a strength so '20 mg', '20mg', '20MG' compare equal."""
    n = _norm(s)
    return n.replace(" mg", "mg").replace(" mcg", "mcg").replace(" ml", "ml").replace(" g", "g")


def _any_match(value: str | None, candidates: list[str] | None, normaliser=_norm) -> bool:
    """True if `value` corroborates against any of `candidates` (substring-
    tolerant either direction, e.g. licence '20mg' vs drug strength '20mg/ml')."""
    if not value or not candidates:
        return False
    v = normaliser(value)
    if not v:
        return False
    for c in candidates:
        cn = normaliser(c)
        if not cn:
            continue
        if v == cn or v in cn or cn in v:
            return True
    return False


def score_match(licence: dict, drug_facts: dict) -> tuple[float, list[str]]:
    """
    Score a single licence against a resolved drug.

    Call this ONLY for a licence the resolver has already linked to `drug`
    (i.e. drug_id is set). That molecule link IS the INN corroboration, so INN
    is always credited (0.50 floor) — whether the link came from an explicit
    active_substance string or from a brand/product-name resolution.

    licence: a normalised licence dict (the connector's normalize() output) —
        reads brand_name, strength, dosage_form, pack_size, reference_ma_number.
    drug_facts: {"generic_name", "brand_names": [...], "strengths": [...],
        "dosage_forms": [...], "ma_numbers": [...]} — what we know on our side.
        Arrays may be empty; missing keys are treated as empty.

    Returns (confidence, basis) where basis lists the corroborated fields.
    """
    # INN is the resolution key — always credited for a resolved licence.
    basis: list[str] = ["inn"]

    brand_ok = _any_match(licence.get("brand_name"), drug_facts.get("brand_names"))
    strength_ok = _any_match(licence.get("strength"), drug_facts.get("strengths"), _norm_strength)
    form_ok = _any_match(licence.get("dosage_form"), drug_facts.get("dosage_forms"))
    # No corroboration source on the Mederti side yet — see module docstring.
    pack_ok = _any_match(licence.get("pack_size"), drug_facts.get("pack_sizes"))
    ma_ok = _any_match(licence.get("reference_ma_number"), drug_facts.get("ma_numbers"))

    if brand_ok:
        basis.append("brand")
    if strength_ok:
        basis.append("strength")
    if form_ok:
        basis.append("dosage_form")
    if pack_ok:
        basis.append("pack_size")
    if ma_ok:
        basis.append("ma_number")

    # Evaluate the ladder top-down; first satisfied tier wins.
    if brand_ok and strength_ok and form_ok and pack_ok and ma_ok:
        return 1.00, basis
    if brand_ok and strength_ok and form_ok:
        return 0.90, basis
    if strength_ok and form_ok and pack_ok:
        return 0.80, basis
    if strength_ok and form_ok:
        return 0.65, basis
    return 0.50, basis
