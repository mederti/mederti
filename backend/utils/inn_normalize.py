"""
INN normalisation — strip salt / hydrate / ester qualifiers, dosage forms and
strength noise from a raw ingredient string to get a clean substance query.

This is the *local* half of INN resolution. It produces:
  • a RxNav query string (salts KEPT — RxNorm resolves "atorvastatin calcium"
    to the base ingredient "atorvastatin" natively, so we keep the salt to help
    it disambiguate), and
  • a salt-stripped base candidate used to exact-match an existing canonical
    `drugs.generic_name_normalised` row without a network round-trip.

The authoritative salt→base resolution is done by RxNorm/RxNav
(`backend/importers/rxnorm_client.get_base_ingredient`); this module just gets
the string clean enough to query and supplies the "a salt qualifier was present"
signal used for confidence scoring and the review-queue audit trail.

The SALT_TOKENS set is shared with backend/importers/catalogue_inn_backfill.py,
which historically owned the only copy.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Salt / hydrate / ester / solvate descriptors — counter-ions, NOT actives. ──
# Deliberately excludes words that are themselves real actives (chloride,
# nitrate, bromide, zinc, hydrochlorothiazide). Kept in sync with the set that
# used to live in catalogue_inn_backfill.py.
SALT_TOKENS: frozenset[str] = frozenset({
    "calcium", "sodium", "potassium", "magnesium", "lithium", "aluminium",
    "aluminum", "meglumine", "diolamine", "olamine", "trometamol", "tromethamine",
    "hydrochloride", "dihydrochloride", "hydrobromide", "hydroiodide",
    "sulfate", "sulphate", "bisulfate", "hemisulfate", "phosphate", "diphosphate",
    "acetate", "diacetate", "citrate", "dicitrate", "tartrate", "bitartrate",
    "maleate", "malate", "fumarate", "hemifumarate", "succinate", "oxalate",
    "mesylate", "mesilate", "besylate", "besilate", "tosylate", "esylate",
    "gluconate", "lactate", "gluceptate", "stearate", "palmitate", "propionate",
    "dipropionate", "valerate", "butyrate", "furoate", "xinafoate", "embonate",
    "pamoate", "decanoate", "enantate", "enanthate", "undecanoate", "cypionate",
    "hydrate", "monohydrate", "dihydrate", "trihydrate", "hemihydrate",
    "sesquihydrate", "anhydrous", "hydroxide", "base", "as",
    # German / Nordic / Romance spellings seen in EU regulator feeds
    "natrium", "kalium", "calcii", "natrii", "kalii", "trihydrat", "dihydrat",
    "monohydrat", "wasserfrei",
})

# Dosage-form / pharmacopoeia / packaging words to drop. Multilingual because
# EU regulator feeds mix English, German, Spanish, French, Nordic spellings.
_FORM_WORDS: frozenset[str] = frozenset({
    "tablet", "tablets", "tab", "tabs", "caplet", "caplets",
    "capsule", "capsules", "cap", "caps",
    "injection", "injectable", "inj", "infusion", "solution", "soln",
    "suspension", "syrup", "elixir", "drops", "drop", "spray", "aerosol",
    "cream", "ointment", "gel", "lotion", "patch", "patches", "film",
    "coated", "film-coated", "filmcoated", "modified", "release", "extended",
    "prolonged", "sustained", "delayed", "enteric", "effervescent", "chewable",
    "dispersible", "orodispersible", "powder", "granules", "sachet", "vial",
    "ampoule", "ampoules", "ampule", "pen", "cartridge", "prefilled",
    "pre-filled", "concentrate", "suppository", "pessary", "implant",
    "oral", "intravenous", "intramuscular", "subcutaneous", "topical",
    "ophthalmic", "otic", "nasal", "inhalation", "inhaler", "nebuliser",
    "usp", "bp", "ep", "ph", "eur", "jp", "ph.eur", "rx", "only",
    # German / Spanish / French / Nordic
    "filmtabletten", "tabletten", "filmtablette", "hartkapseln", "weichkapseln",
    "comprimidos", "recubiertos", "pelicula", "comprimido", "capsulas",
    "comprime", "comprimes", "pellicule", "poudre", "solucion", "inyectable",
    "tablett", "tabletter", "kapsel", "filmdrasjert", "blisterpakning",
    "drasjert", "depottablett",
})

# Generic-maker / marketing tokens that ride along on regulator product names
# ("Atorvastatin Viatris", "Atorvastatina Alter Genericos"). Stripping the
# best-known ones recovers the INN; conservative list to avoid eating real words.
_STOP_WORDS: frozenset[str] = frozenset({
    "viatris", "basics", "alter", "genericos", "generics", "generic", "efg",
    "sandoz", "teva", "mylan", "accord", "stada", "ratiopharm", "hexal", "krka",
    "zentiva", "aurobindo", "apotex", "pharma", "pharmaceuticals", "labs",
    "laboratories", "healthcare", "actavis", "glenmark", "cipla", "sun",
})

# Strength: "80 mg", "10 mg/10 mg", "1,000mg", "50iu/5ml", "0.9%", "2 units/ml"
_STRENGTH = re.compile(
    r"\b\d[\d.,]*\s*"
    r"(?:mg|mcg|µg|ug|g|kg|ml|l|iu|u|units?|%|mmol|meq)"
    r"(?:\s*/\s*\d*\s*(?:mg|mcg|µg|ug|g|kg|ml|l|iu|u|units?|%))?\b",
    re.IGNORECASE,
)
_PARENS = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_AS_QUALIFIER = re.compile(r"\b(?:as|aks)\s+[a-z\- ]+?(?=$|[,/;(])", re.IGNORECASE)
_PURE_NUM = re.compile(r"\b[\d.,/]+\b")
_TOKEN = re.compile(r"[a-z][a-z\-]*", re.IGNORECASE)
_COMBO = re.compile(r"[/;+]|\b and \b|\bwith\b|,", re.IGNORECASE)


@dataclass
class NormalisedName:
    raw: str
    query: str               # salts KEPT, dosage/strength stripped — for RxNav
    base_candidate: str      # salts ALSO stripped — for local exact-match
    removed_salts: list[str] = field(default_factory=list)
    is_combination: bool = False


def normalise(raw: str) -> NormalisedName:
    """
    Clean a raw ingredient / generic-name string.

    >>> normalise("Atorvastatin 80 Mg Film-Coated Tablets (Atorvastatin Calcium Trihydrate)")
    query='atorvastatin'  base_candidate='atorvastatin'  removed_salts=[]
    >>> normalise("atorvastatin (as calcium trihydrate)")
    query='atorvastatin'  base_candidate='atorvastatin'  removed_salts=['calcium','trihydrate']
    >>> normalise("Heparin Sodium Injection USP")
    query='heparin sodium'  base_candidate='heparin'  removed_salts=['sodium']
    """
    s = (raw or "").strip()
    if not s:
        return NormalisedName(raw=raw or "", query="", base_candidate="")

    lower = s.lower()

    # "(as calcium trihydrate)" — capture the salt words before we delete parens.
    paren_salts: list[str] = []
    for m in _PARENS.finditer(lower):
        for tok in _TOKEN.findall(m.group(0)):
            if tok in SALT_TOKENS and tok != "as":
                paren_salts.append(tok)
    # Likewise unparenthesised "as calcium trihydrate".
    for m in _AS_QUALIFIER.finditer(lower):
        for tok in _TOKEN.findall(m.group(0)):
            if tok in SALT_TOKENS and tok != "as":
                paren_salts.append(tok)

    # Strip parentheticals, "as <salt>", strength patterns, then stray numbers.
    cleaned = _PARENS.sub(" ", lower)
    cleaned = _AS_QUALIFIER.sub(" ", cleaned)
    cleaned = _STRENGTH.sub(" ", cleaned)
    cleaned = _PURE_NUM.sub(" ", cleaned)

    # Detect combinations only AFTER strength/number removal, so the comma in a
    # strength like "1,000 mg" is not mistaken for an "ingredient A, ingredient B"
    # separator. A real combo ("atorvastatin, ezetimibe") still trips it.
    is_combo = bool(_COMBO.search(cleaned))

    # Split hyphenated compounds so "atorvastatin-calcium-trihydrate" exposes its
    # salt tokens.
    cleaned = cleaned.replace("-", " ")

    tokens = _TOKEN.findall(cleaned)

    query_tokens: list[str] = []
    base_tokens: list[str] = []
    removed: list[str] = list(paren_salts)

    for tok in tokens:
        if tok in _FORM_WORDS or tok in _STOP_WORDS:
            continue
        if tok in SALT_TOKENS:
            # Salt: keep it in the RxNav query (helps disambiguation) but drop
            # it from the local base candidate and record it for the audit trail.
            if tok != "as":
                removed.append(tok)
                query_tokens.append(tok)
            continue
        query_tokens.append(tok)
        base_tokens.append(tok)

    query = " ".join(query_tokens).strip()
    base = " ".join(base_tokens).strip()

    # If form/strength stripping nuked everything (e.g. the name was *only* a
    # parenthetical INN), fall back to the parenthetical contents.
    if not base:
        inside = " ".join(
            t for m in _PARENS.finditer(lower)
            for t in _TOKEN.findall(m.group(0))
            if t not in _FORM_WORDS and t not in SALT_TOKENS and t != "as"
        ).strip()
        if inside:
            query = base = inside

    return NormalisedName(
        raw=s,
        query=query,
        base_candidate=base,
        removed_salts=list(dict.fromkeys(removed)),  # dedupe, keep order
        is_combination=is_combo,
    )
