"""
Substance resolver — turn a raw ingredient / generic-name string into a
fully-identified molecule: INN + RxNorm CUI + UNII + ATC, with a confidence
score and method trail.

Pipeline
--------
    raw string
      → inn_normalize.normalise()        (strip salt/hydrate/dosage/strength)
      → RxNav get_rxcui(query)           (name → RxCUI, approximate match)
      → RxNav get_base_ingredient(rxcui) (salt/brand → base ingredient = INN)
      → RxNav get_unii(base_rxcui)       (UNII substance identifier)
      → RxNav get_atc_code(base_rxcui)   (ATC class)

Confidence
----------
  high   — RxCUI found, a single base ingredient resolved, and the resolved INN
           is textually consistent with the cleaned input. Safe to auto-apply.
  medium — RxCUI found but INN text doesn't overlap the input, OR a combination
           product. Needs review.
  low    — no RxCUI at all. Needs review.

This module performs NO database writes and is import-safe (no side effects at
import time). The caller (backend/importers/inn_resolution.py) decides what to
persist vs. queue for review.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

from backend.importers import rxnorm_client as rx
from backend.importers import unii_client
from backend.utils.inn_normalize import normalise
from backend.utils.logger import get_logger

log = get_logger("mederti.importer.substance_resolver")

HIGH = "high"
MEDIUM = "medium"
LOW = "low"

_CONFIDENCE_SCORE = {HIGH: 0.95, MEDIUM: 0.60, LOW: 0.25}


@dataclass
class Resolution:
    raw: str
    cleaned: str
    inn: Optional[str]            # resolved base substance (lowercased)
    rxcui: Optional[str]          # RxCUI of the *input* concept
    base_rxcui: Optional[str]     # RxCUI of the base ingredient
    unii: Optional[str]
    atc: Optional[str]
    confidence: str               # HIGH | MEDIUM | LOW
    score: float
    method: str                   # human-readable trail
    reason: Optional[str]         # why not high-confidence (for the review queue)
    removed_salts: list[str]
    is_combination: bool

    def as_dict(self) -> dict:
        return asdict(self)


def _inn_consistent(inn: str, cleaned_base: str) -> bool:
    """
    True if the resolved INN textually agrees with the cleaned input — guards
    against RxNav's approximate match silently resolving to the wrong drug.
    """
    if not inn or not cleaned_base:
        return False
    inn_l = inn.lower()
    base_l = cleaned_base.lower()
    if inn_l in base_l or base_l in inn_l:
        return True
    # Token overlap: any shared word ≥4 chars (handles "atorvastatin viatris").
    inn_toks = {t for t in inn_l.split() if len(t) >= 4}
    base_toks = {t for t in base_l.split() if len(t) >= 4}
    if inn_toks & base_toks:
        return True
    # Brand→generic: input was a brand (e.g. "gazyva") so it won't share tokens
    # with the INN. Accept when the input is a single short alpha token (a brand)
    # and RxNav gave us a clean single-word INN.
    return len(base_l.split()) == 1 and len(inn_l.split()) == 1 and base_l != inn_l


def resolve(raw: str) -> Resolution:
    """Resolve a raw ingredient/generic string to a fully-identified molecule."""
    norm = normalise(raw)
    cleaned = norm.query
    base_candidate = norm.base_candidate

    empty = Resolution(
        raw=raw, cleaned=cleaned, inn=None, rxcui=None, base_rxcui=None,
        unii=None, atc=None, confidence=LOW, score=_CONFIDENCE_SCORE[LOW],
        method="no-clean-string", reason="empty after normalisation",
        removed_salts=norm.removed_salts, is_combination=norm.is_combination,
    )
    if not cleaned:
        return empty

    # 1. name → RxCUI (try the salt-bearing query first, then the bare base).
    rxcui = rx.get_rxcui(cleaned) or (rx.get_rxcui(base_candidate) if base_candidate != cleaned else None)

    # 1b. Exact lookup failed → approximate match (bridges foreign brand spellings
    #     RxNorm's US dataset doesn't carry, e.g. EU "Gazyvaro" → "Gazyva"). An
    #     approximate hit is only trusted when an independent source (the UNII
    #     registry, queried on the raw name) confirms the same substance.
    approx_used = False
    if not rxcui and not norm.is_combination:
        cand = rx.get_rxcui_approx(cleaned) or rx.get_rxcui_approx(raw)
        if cand:
            rxcui = cand["rxcui"]
            approx_used = True

    if not rxcui:
        # 1c. Last resort: the UNII registry knows the substance by name even when
        #     RxNorm doesn't. Gives UNII (+ the name as INN) but no RxCUI/ATC.
        reg_unii = unii_client.get_unii_by_name(base_candidate) or unii_client.get_unii_by_name(cleaned)
        if reg_unii and not norm.is_combination:
            return Resolution(
                raw=raw, cleaned=cleaned, inn=base_candidate or cleaned, rxcui=None,
                base_rxcui=None, unii=reg_unii, atc=None, confidence=MEDIUM,
                score=_CONFIDENCE_SCORE[MEDIUM], method="unii_registry:name",
                reason="unii-registry-only", removed_salts=norm.removed_salts,
                is_combination=norm.is_combination,
            )
        return Resolution(
            raw=raw, cleaned=cleaned, inn=None, rxcui=None, base_rxcui=None,
            unii=None, atc=None, confidence=LOW, score=_CONFIDENCE_SCORE[LOW],
            method="rxnav:no-rxcui", reason="no-rxcui",
            removed_salts=norm.removed_salts, is_combination=norm.is_combination,
        )

    # 2. RxCUI → base ingredient (salt/brand → INN).
    base = rx.get_base_ingredient(rxcui)
    if base and base.get("tty") == "MULTI":
        # Multiple distinct base ingredients — a combination we won't collapse.
        return Resolution(
            raw=raw, cleaned=cleaned, inn=base.get("name"), rxcui=rxcui,
            base_rxcui=None, unii=None, atc=None, confidence=MEDIUM,
            score=_CONFIDENCE_SCORE[MEDIUM], method="rxnav:multi-ingredient",
            reason="combo", removed_salts=norm.removed_salts, is_combination=True,
        )

    base_rxcui = (base or {}).get("rxcui") or rxcui
    inn = ((base or {}).get("name") or "").strip().lower() or None

    # 3. base RxCUI → UNII + ATC. RxNorm lacks UNII for complex substances and
    #    biologics (heparin, many mAbs), so fall back to the UNII registry by INN.
    unii = rx.get_unii(base_rxcui) if base_rxcui else None
    unii_source = "rxnorm" if unii else None
    if not unii and inn:
        unii = unii_client.get_unii_by_name(inn)
        if unii:
            unii_source = "unii_registry"
    atc = rx.get_atc_code(base_rxcui) if base_rxcui else None
    if not atc and base_rxcui != rxcui:
        atc = rx.get_atc_code(rxcui)

    # 4. Confidence.
    consistent = _inn_consistent(inn or "", base_candidate or cleaned)
    if approx_used:
        # Trust an approximate (foreign-brand) match only when the UNII registry,
        # queried independently on the raw name, agrees on the substance.
        reg_unii = unii_client.get_unii_by_name(raw) or unii_client.get_unii_by_name(cleaned)
        if inn and unii and reg_unii and reg_unii == unii:
            conf, reason = HIGH, None
        elif inn and not unii and reg_unii:
            unii, unii_source = reg_unii, "unii_registry"
            conf, reason = HIGH, None
        else:
            conf, reason = MEDIUM, "approx-unconfirmed"
    elif inn and base_rxcui and consistent and not norm.is_combination:
        conf, reason = HIGH, None
    elif inn and norm.is_combination:
        conf, reason = MEDIUM, "combo"
    elif inn and not consistent:
        conf, reason = MEDIUM, "inn-text-mismatch"
    else:
        conf, reason = MEDIUM, "no-base-ingredient"

    method = f"rxnav:rxcui={rxcui};base={base_rxcui};unii={unii_source or 'none'}"
    return Resolution(
        raw=raw, cleaned=cleaned, inn=inn, rxcui=rxcui, base_rxcui=base_rxcui,
        unii=unii, atc=atc, confidence=conf, score=_CONFIDENCE_SCORE[conf],
        method=method, reason=reason, removed_salts=norm.removed_salts,
        is_combination=norm.is_combination,
    )


# Manual smoke test:  python3 -m backend.importers.substance_resolver atorvastatin "heparin sodium" gazyva
if __name__ == "__main__":
    import sys
    for name in sys.argv[1:] or ["atorvastatin (as calcium trihydrate)", "heparin sodium", "Gazyva", "Gazyvaro"]:
        r = resolve(name)
        print(f"\n{name!r}")
        print(f"  inn={r.inn} rxcui={r.rxcui} base={r.base_rxcui} unii={r.unii} atc={r.atc}")
        print(f"  confidence={r.confidence} ({r.score}) method={r.method} reason={r.reason}")
