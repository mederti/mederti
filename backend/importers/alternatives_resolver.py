"""
Exact name → drug resolution for alternative_evidence importers.

Every step is an EXACT lookup; there is no fuzzy or similarity matching. A name
that doesn't resolve stays unresolved (NULL id) rather than being guessed.

Order:
  1. drugs.generic_name_normalised == name                         ('exact_name')
  2. explicit INN → USAN spelling alias, then step 1                ('inn_usan_alias')
  3. salt form: a row whose generic_name_normalised is exactly
     "<name> <salt>" for a known salt word, AND whose resolved_inn
     (UNII desalting, migration 050) == name                        ('salt_form')

Steps 1-2 must hit exactly one row, and step 3 exactly one row; anything else
is ambiguous and left unresolved.

The id returned is the MATCHED row itself, never its canonical_drug_id head:
spot checks (2026-10-17) found contaminated heads, e.g. the chlortalidone
group headed by an atenolol+chlortalidone combination product, so following
the rollup pointer can land on a different medicine. resolved_inn alone is
not trusted for the same reason (it mapped "Co Fluvoxamine (2013" and the
combo product above).

Names describing a class or an unspecified group ("insulin (analogue,
long-acting)", "erythropoiesis-stimulating agents") never resolve to a single
drug, by design.
"""
from __future__ import annotations

# WHO uses International Nonproprietary Names; many of our rows carry US
# (USAN) spellings. Only official, unambiguous INN ↔ USAN pairs for the same
# substance belong here — one entry per pair, INN on the left.
INN_TO_USAN: dict[str, str] = {
    "beclometasone": "beclomethasone",
    "chlortalidone": "chlorthalidone",
    "ergometrine": "ergonovine",
    "leuprorelin": "leuprolide",
    "meticillin": "methicillin",
    "norethisterone": "norethindrone",
    "salbutamol": "albuterol",
    "paracetamol": "acetaminophen",
    "glibenclamide": "glyburide",
    "adrenaline": "epinephrine",
    "noradrenaline": "norepinephrine",
}

# Salt / ester words that may follow the base name in a row's generic name.
SALT_WORDS = {
    "sodium", "potassium", "calcium", "magnesium", "hydrochloride", "hcl", "dihydrochloride",
    "hydrobromide", "bromide", "chloride", "mesylate", "mesilate", "besylate", "besilate",
    "maleate", "fumarate", "succinate", "tartrate", "bitartrate", "citrate", "acetate",
    "sulfate", "sulphate", "phosphate", "nitrate", "lactate", "tosylate", "trihydrate",
    "monohydrate", "dihydrate", "disodium", "dipotassium",
}


class DrugResolver:
    def __init__(self, supabase) -> None:
        self.by_name: dict[str, set[str]] = {}
        self.salt_rows: dict[str, set[str]] = {}
        page, size = 0, 1000
        while True:
            res = (
                supabase.table("drugs")
                .select("id, generic_name, generic_name_normalised, resolved_inn")
                .range(page * size, page * size + size - 1)
                .execute()
            )
            rows = res.data or []
            for r in rows:
                norm = (r.get("generic_name_normalised") or r.get("generic_name") or "").strip().lower()
                if not norm:
                    continue
                self.by_name.setdefault(norm, set()).add(r["id"])
                inn = (r.get("resolved_inn") or "").strip().lower()
                if inn and norm.startswith(inn + " "):
                    rest = norm[len(inn) + 1:].split()
                    if rest and all(w in SALT_WORDS for w in rest):
                        self.salt_rows.setdefault(inn, set()).add(r["id"])
            if len(rows) < size:
                break
            page += 1

    @staticmethod
    def _one(ids: set[str] | None) -> str | None:
        return next(iter(ids)) if ids and len(ids) == 1 else None

    def resolve(self, raw: str | None) -> tuple[str | None, str | None]:
        """Return (drug id, method) or (None, None)."""
        name = (raw or "").strip().lower()
        if not name:
            return None, None
        if (hit := self._one(self.by_name.get(name))):
            return hit, "exact_name"
        alias = INN_TO_USAN.get(name)
        if alias and (hit := self._one(self.by_name.get(alias))):
            return hit, "inn_usan_alias"
        if (hit := self._one(self.salt_rows.get(name))):
            return hit, "salt_form"
        return None, None
