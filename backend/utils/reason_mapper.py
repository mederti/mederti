"""
Centralized reason_category mapper for Mederti shortage scrapers.
─────────────────────────────────────────────────────────────────

Maps free-text reason strings (in English, French, Italian, Spanish,
German, Arabic/SFDA labels) to the canonical reason_category enum
used in shortage_events.

Valid categories:
    manufacturing_issue, supply_chain, demand_surge, regulatory_action,
    discontinuation, raw_material, distribution, other, unknown

Usage:
    from backend.utils.reason_mapper import map_reason_category

    category = map_reason_category("Manufacturing delays")
    # Returns: "manufacturing_issue"

    category = map_reason_category("Problèmes de fabrication")
    # Returns: "manufacturing_issue"

Note:
    Scrapers with source-specific code mappings (e.g. AEMPS integer
    tipoProblemaSuministro) may keep their own _REASON_MAP dicts.
    This mapper covers the general free-text case.
"""

from __future__ import annotations

import unicodedata

VALID_CATEGORIES = frozenset({
    "manufacturing_issue",
    "supply_chain",
    "demand_surge",
    "regulatory_action",
    "discontinuation",
    "raw_material",
    "distribution",
    "other",
    "unknown",
})

# Ordered list: more specific patterns first.
# (keyword_substring, reason_category)
_KEYWORD_MAP: list[tuple[str, str]] = [
    # ── English ──────────────────────────────────────────────────────────────
    ("manufacturing delay",        "manufacturing_issue"),
    ("manufacturing capacity",     "manufacturing_issue"),
    ("manufacturing issue",        "manufacturing_issue"),
    ("quality issue",              "manufacturing_issue"),
    ("quality problem",            "manufacturing_issue"),
    ("gmp",                        "manufacturing_issue"),
    ("contamination",              "manufacturing_issue"),
    ("sterility",                  "manufacturing_issue"),
    ("raw material",               "raw_material"),
    ("active ingredient supply",   "raw_material"),
    ("active pharmaceutical",      "raw_material"),
    ("api supply",                 "raw_material"),
    ("ingredient shortage",        "raw_material"),
    ("demand increase",            "demand_surge"),
    ("increased demand",           "demand_surge"),
    ("demand surge",               "demand_surge"),
    ("high demand",                "demand_surge"),
    ("supply chain",               "supply_chain"),
    ("logistics",                  "supply_chain"),
    ("global shortage",            "supply_chain"),
    ("shipping",                   "distribution"),
    ("distribution",               "distribution"),
    ("import",                     "distribution"),
    ("export",                     "distribution"),
    ("discontinu",                 "discontinuation"),
    ("business decision",          "discontinuation"),
    ("market withdrawal",          "discontinuation"),
    ("withdrawn",                  "discontinuation"),
    ("regulatory",                 "regulatory_action"),
    ("inspection",                 "regulatory_action"),
    ("approval delay",             "regulatory_action"),
    # ── French ───────────────────────────────────────────────────────────────
    ("fabrication",                "manufacturing_issue"),
    ("production",                 "manufacturing_issue"),
    ("qualite",                    "manufacturing_issue"),
    ("matiere premiere",           "raw_material"),
    ("matiere prime",              "raw_material"),
    ("forte demande",              "demand_surge"),
    ("demande",                    "demand_surge"),
    ("approvisionnement",          "supply_chain"),
    ("arret de commercialisation", "discontinuation"),
    ("arret",                      "discontinuation"),
    ("reglementaire",              "regulatory_action"),
    # ── Italian ──────────────────────────────────────────────────────────────
    ("problemi produttivi",        "manufacturing_issue"),
    ("problema produttivo",        "manufacturing_issue"),
    ("difetto qualita",            "manufacturing_issue"),
    ("carenza materie prime",      "raw_material"),
    ("elevata richiesta",          "demand_surge"),
    ("cessata commercializzazione", "discontinuation"),
    ("ritiro dal commercio",       "discontinuation"),
    ("provvedimento autorizzativo", "regulatory_action"),
    ("problemi di distribuzione",  "supply_chain"),
    # ── Spanish ──────────────────────────────────────────────────────────────
    ("fabricacion",                "manufacturing_issue"),
    ("produccion",                 "manufacturing_issue"),
    ("calidad",                    "manufacturing_issue"),
    ("materia prima",              "raw_material"),
    ("materias primas",            "raw_material"),
    ("demanda",                    "demand_surge"),
    ("distribucion",               "supply_chain"),
    ("retirada",                   "discontinuation"),
    ("regulatorio",                "regulatory_action"),
    ("autorizacion",               "regulatory_action"),
    # ── German ───────────────────────────────────────────────────────────────
    ("herstellung",                "manufacturing_issue"),
    ("qualitaetsmangel",           "manufacturing_issue"),
    ("qualitat",                   "manufacturing_issue"),
    ("rohstoff",                   "raw_material"),
    ("nachfrage",                  "demand_surge"),
    ("lieferkette",                "supply_chain"),
    ("einstellung",                "discontinuation"),
    # ── SFDA (English labels) ────────────────────────────────────────────────
    ("commercial/manufacturing",   "manufacturing_issue"),
    ("commercial issue",           "manufacturing_issue"),
    ("mah/agent changed",          "supply_chain"),
    ("mah changed",                "supply_chain"),
    ("agent changed",              "supply_chain"),
    ("regulations related",        "regulatory_action"),
    # ── Portuguese ──────────────────────────────────────────────────────────
    ("fabricacao",                 "manufacturing_issue"),
    ("problema de qualidade",     "manufacturing_issue"),
    ("materia-prima",             "raw_material"),
    ("aumento de procura",        "demand_surge"),
    ("descontinuacao temporaria", "discontinuation"),
    ("descontinuacao definitiva", "discontinuation"),
    ("descontinuacao",            "discontinuation"),
    ("ruptura",                   "supply_chain"),
    ("importacao",                "distribution"),
    # ── Polish ──────────────────────────────────────────────────────────────
    ("brak dostepnosci",          "supply_chain"),
    ("produkcja",                 "manufacturing_issue"),
    ("jakosc",                    "manufacturing_issue"),
    ("surowiec",                  "raw_material"),
    ("zapotrzebowanie",           "demand_surge"),
    ("wycofanie",                 "discontinuation"),
    # ── Greek ───────────────────────────────────────────────────────────────
    ("elleipsi",                  "supply_chain"),
    ("paragogi",                  "manufacturing_issue"),
    ("poiotita",                  "manufacturing_issue"),
    ("anakleisi",                 "discontinuation"),
    ("anastoli",                  "regulatory_action"),
    # ── Turkish ─────────────────────────────────────────────────────────────
    ("tedarik",                   "supply_chain"),
    ("uretim",                    "manufacturing_issue"),
    ("kalite",                    "manufacturing_issue"),
    ("hammadde",                  "raw_material"),
    ("talep artisi",              "demand_surge"),
    ("geri cekme",                "discontinuation"),
    ("piyasadan cekilme",         "discontinuation"),
    # ── Malay ───────────────────────────────────────────────────────────────
    ("pembuatan",                 "manufacturing_issue"),
    ("bekalan",                   "supply_chain"),
    ("penarikan",                 "discontinuation"),
    # ── Arabic (transliterated) ─────────────────────────────────────────────
    ("naqs",                      "supply_chain"),
    ("tasni",                     "manufacturing_issue"),
]


def _normalize_text(text: str) -> str:
    """Strip accents and lowercase for matching."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def map_reason_category(raw_reason: str | None) -> str:
    """
    Map a free-text reason string to a canonical reason_category.

    Parameters
    ----------
    raw_reason : str or None
        Raw reason text in any supported language.

    Returns
    -------
    str
        One of the 9 valid reason_category values.
    """
    if not raw_reason or not str(raw_reason).strip():
        return "unknown"
    normalized = _normalize_text(str(raw_reason))
    for keyword, category in _KEYWORD_MAP:
        if keyword in normalized:
            return category
    return "unknown"
