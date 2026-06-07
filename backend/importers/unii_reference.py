"""
UNII reference loader — turns the two FDA UNII bulk files into fast in-memory
indexes for *offline* molecule identity resolution.

Source files (free, no auth) downloaded once into ``data/reference/``:

  * ``UNII_Records_<date>.txt``  — one row per substance:
        UNII | Display Name | RN(CAS) | … | RXCUI | … | INN_ID | … | INGREDIENT_TYPE
    The Display Name is the FDA preferred term (the INN where one exists);
    ``INN_ID`` is populated iff the substance has an official WHO INN.

  * ``UNII_Names_<date>.txt``  — every synonym / brand / systematic name:
        Name | TYPE | UNII | Display Name      (TYPE ∈ cn,sys,cd,of,bn,mn)

Together they give a 0.9 M-entry ``name -> UNII`` map plus, for the ~12.6 k
substances that carry an official INN, a ``display_name -> UNII`` map used as the
*only* target set for fuzzy matching (so a foreign spelling can never fuzzy-match
to an impurity or a metabolite — only to a real INN).

The indexes are pickled to ``data/reference/unii_index.pkl`` so repeat runs skip
the ~5 s parse of 1 M rows.
"""
from __future__ import annotations

import csv
import glob
import os
import pickle
import re
import unicodedata
from dataclasses import dataclass

REF_DIR = os.path.join("data", "reference")
CACHE = os.path.join(REF_DIR, "unii_index.pkl")

# Generous field size — some systematic names are very long.
csv.field_size_limit(10_000_000)


def _norm(s: str | None) -> str:
    """Lowercase, drop ``[USP IMPURITY]`` tags and ``(…)`` qualifiers, keep
    alphanumerics + single spaces. Shared by the loader and the resolver so both
    sides of a comparison are normalised identically."""
    s = (s or "").lower().strip()
    # Fold accents so "Paracétamol"/"Baclofène" map to their ASCII INN rather
    # than being shredded into "paracetamol"→"paracetamol" vs "baclof ne".
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\[.*?\]", "", s)        # [USP IMPURITY], [WHO-DD] …
    s = re.sub(r"\(.*?\)", "", s)         # bracketed qualifiers
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class UniiIndex:
    syn: dict[str, str]            # normalised name  -> UNII   (all synonyms)
    inn_display: dict[str, str]    # normalised INN display name -> UNII
    display_of: dict[str, str]     # UNII -> canonical Display Name (original case)
    rxcui_of: dict[str, str]       # UNII -> RXCUI (when present)
    cas_of: dict[str, str]         # UNII -> CAS RN (when present)
    is_inn: set[str]               # UNIIs carrying an official INN

    @property
    def inn_keys(self) -> list[str]:
        return list(self.inn_display.keys())


def _find(pattern: str) -> str:
    hits = sorted(glob.glob(os.path.join(REF_DIR, pattern)))
    if not hits:
        raise FileNotFoundError(
            f"UNII reference file matching {pattern!r} not found in {REF_DIR}. "
            f"Download UNII_Data.zip + UNIIs.zip from "
            f"https://precision.fda.gov/uniisearch/archive/latest/ and unzip into {REF_DIR}."
        )
    return hits[-1]


def load(rebuild: bool = False) -> UniiIndex:
    if not rebuild and os.path.exists(CACHE):
        with open(CACHE, "rb") as fh:
            return pickle.load(fh)

    records = _find("UNII_Records_*.txt")
    names = _find("UNII_Names_*.txt")

    syn: dict[str, str] = {}
    inn_display: dict[str, str] = {}
    display_of: dict[str, str] = {}
    rxcui_of: dict[str, str] = {}
    cas_of: dict[str, str] = {}
    is_inn: set[str] = set()

    with open(records, encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            unii = row.get("UNII")
            if not unii:
                continue
            disp = row.get("Display Name") or ""
            display_of.setdefault(unii, disp)
            if row.get("RXCUI"):
                rxcui_of[unii] = row["RXCUI"]
            if row.get("RN"):
                cas_of[unii] = row["RN"]
            nm = _norm(disp)
            if nm:
                syn.setdefault(nm, unii)
            if row.get("INN_ID"):
                is_inn.add(unii)
                if nm:
                    inn_display.setdefault(nm, unii)

    with open(names, encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            unii = row.get("UNII")
            nm = _norm(row.get("Name"))
            if unii and nm:
                syn.setdefault(nm, unii)

    idx = UniiIndex(syn, inn_display, display_of, rxcui_of, cas_of, is_inn)
    with open(CACHE, "wb") as fh:
        pickle.dump(idx, fh)
    return idx


if __name__ == "__main__":
    idx = load(rebuild=True)
    print(f"synonyms        : {len(idx.syn):,}")
    print(f"INN display set : {len(idx.inn_display):,}")
    print(f"UNIIs w/ INN    : {len(idx.is_inn):,}")
    print(f"UNIIs w/ RXCUI  : {len(idx.rxcui_of):,}")
