"""
Offline INN resolver — resolve ``drugs`` rows to molecule identity (UNII + INN)
using the bulk FDA UNII reference, with **zero per-row network calls**.

Why offline: the prior pipeline (``inn_resolution.py``) resolved each row via
4-6 throttled RxNav round-trips (~8-12 h for 10 k rows, killed by laptop sleep).
This resolver loads the UNII reference once (``unii_reference.load``) and matches
every row locally in seconds — deterministic, reproducible, re-runnable nightly.

Resolution ladder (first hit wins), highest precision first:

  1. exact        — normalised full name is a known synonym/INN
  2. desalt       — strip multilingual salt/hydrate tokens (incl. German/Nordic
                    agglutinated suffixes) then exact
  3. paren        — active ingredient in trailing ``(…)`` exact-matches
  4. combo        — ≥2 components across a separator each resolve → combination
  5. morphology   — Romance→English suffix substitution (tobramicina→tobramycin)
                    then exact (still exact-match, so high precision)
  6. leading      — longest leading token-run that exact- or fuzzy-matches an INN
                    (drops trailing maker/salt junk: "Vancomicina Normon")

Anything that matches nothing is classified:
  * quarantine — Finnish VNR codes, CJK (PMDA, needs transliteration), and
    homeopathic/supplement/cosmetic junk → flagged ``non_drug`` (never given a
    false INN); CJK is flagged ``defer:cjk`` (real drugs, just not yet handled).
  * review     — looked like a drug but resolved to nothing → human queue.

Confidence gates writes: ≥ AUTO_APPLY auto-writes resolved_inn/unii/canonical;
combos and low-confidence go to review; nothing below the bar is silently
applied. Dry-run by default; ``--execute`` writes + dumps a revert manifest.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.getcwd())
from rapidfuzz import fuzz, process

from backend.importers import unii_reference
from backend.utils.db import get_supabase_client

_norm = unii_reference._norm

AUTO_APPLY = 0.82           # confidence at/above which we write resolved_inn
FUZZY_CUTOFF = 91           # rapidfuzz ratio floor for a leading fuzzy match

# ── salt / hydrate vocabulary (multilingual), stripped as whole tokens ──
SALT_WORDS = set("""
calcium sodium potassium magnesium lithium aluminium aluminum sodica sodico sodique
sodica calcica potasico potassica magnesica cloridrato cloruro clorhidrato bromidrato
bromuro bromhidrato sulfato sulfaat fosfato fosfaat phosphat acetato citrato tartrato
maleato fumarato succinato mesilato mesilate besilato besylate tosilato hidrato
monohidrato dihidrato trihidrato hemihidrato emiidrato anidro anhidro anhydrous base
gluconato lactato estearato palmitato propionato valerato furoato decanoato pamoato
embonato hydrochloride dihydrochloride hydrobromide sulfate sulphate phosphate acetate
citrate tartrate maleate fumarate succinate mesylate besylate tosylate gluconate lactate
stearate palmitate hydrate monohydrate dihydrate trihydrate hemihydrate meglumine
meglumin sodium acido acid hemifumarate bitartrate dipropionate hemisuccinate
""".split())

# ── German/Nordic agglutinated salt suffixes (no separating space) ──
GER_SALT = sorted([
    "dihydrochlorid", "hydrochlorid", "hydroklorid", "hydrobromid", "hydrogensulfat",
    "hemitartrat", "bitartrat", "hemifumarat", "dihydrogenfosfat", "hemihydrat",
    "monohydrat", "monohydraat", "dihydrat", "trihydrat", "hydraat", "sulfat", "sulphat",
    "fosfat", "phosphat", "acetat", "citrat", "tartrat", "maleat", "mesilat", "mesylat",
    "besilat", "besylat", "fumarat", "succinat", "embonat", "pamoat", "natrium", "kalium",
    "klorid", "bromid", "nitrat", "laktat", "glukonat", "stearat", "palmitat", "propionat",
    "valerat", "furoat", "decanoat", "meglumin", "glycinat", "dinatrium",
], key=len, reverse=True)
GER_RE = re.compile(r"(" + "|".join(GER_SALT) + r")$")

# ── Romance→English INN suffix substitutions (applied to leading token, then
#    *exact*-matched — so a wrong guess simply fails to match, never mis-resolves) ──
MORPH = [
    ("micina", "mycin"), ("icina", "icin"), ("oxacino", "oxacin"), ("oxacina", "oxacin"),
    ("azolo", "azole"), ("azol", "azole"), ("idina", "idine"), ("adina", "adine"),
    ("olo", "ole"), ("ico", "ic"), ("ato", "ate"), ("ido", "ide"), ("ona", "one"),
    ("eno", "ene"), ("ese", "ese"), ("ina", "ine"), ("ano", "an"), ("ide", "ide"),
    ("ile", "il"), ("olo", "ol"),
]

CJK = re.compile(r"[　-鿿＀-￯]")
VNR = re.compile(r"\bfi[- ]?vnr\b", re.I)
JUNK = re.compile(
    r"homeopath|dietary suppl|weight (loss|advanced|release|management|control)|"
    r"fat burner|\bslim\b|appetite|detox|tiger king|safecare|dr\.? king|herbicide|"
    r"kissable|buckley|lightning rod|diamond pill|once more|male enhancement|"
    r"hand sanitizer|sunscreen|multivitamin|\bgummies\b|cough drop|moisturizing|"
    r"polishes|silver bullet|bzk swab|net remedies|\benhancement\b|thermogenic|"
    r"sexual (pill|enhanc)|libido|\bdetox\b|antiseptic wipe|\bspf ?\d|sunscreen|"
    r"banana boat|\bfl oz\b|tanning|after sun|lip balm",
    re.I,
)
COMBO_SEP = re.compile(r"[/;+]|\band\b|\bwith\b|\bet\b|,")

# Dosage quantities ("20 units/ml", "2 mg per ml", "5%") and pharmaceutical form
# words — stripped before combo-splitting so a dosage like "Units/Ml" can't be
# mistaken for an ingredient separator, and so form noise doesn't block an exact
# INN match.
_DOSE = re.compile(
    r"\b\d[\d.,]*\s*(?:mg|mcg|microgram(?:os|mes|s)?|micrograms?|g|kg|ml|l|"
    r"units?|unidades|iu|ie|%|mmol)\b(?:\s*/\s*(?:ml|l|dose|hr|h|kg))?",
    re.I,
)
_FORM = re.compile(
    r"\b(?:injection|inj|vial|tablet?s?|tab|capsule?s?|caps?|solution|soln|powder|"
    r"infusion|oral|ophthalmic|opth|ophth|cream|gel|drops?|suspension|syrup|spray|"
    r"patch|sachet|ampoule|ampule|pre[- ]?filled|syringe|film[- ]?coated|"
    r"gastro[- ]?resistant|prolonged[- ]?release|extended[- ]?release|"
    r"modified[- ]?release|hard|soft|suppository|lyophil[iy]s?ed|concentrate|"
    r"sterile|usp|bp|ph\.?\s*eur|per\s+ml|inhalation|nebuli[sz]er|intravenous|"
    r"subcutaneous|granules|effervescent|lozenge|pessary|implant|mups|"
    r"solvent|prolong|coated)\b",
    re.I,
)


def _strip_form(s: str) -> str:
    s = _DOSE.sub(" ", s or "")
    s = _FORM.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;/-")
    return s

# Common English/brand words that must NEVER seed a lone-token match — they
# collide with obscure substances/proteins ("Net"→NE transporter, "Edge"→a
# herbicide, "Kit"→KIT receptor). Blocked for ALL match types when they are the
# only token (a multi-word candidate containing them is still fine).
FUZZY_STOPWORDS = {
    "net", "edge", "once", "remedies", "complete", "max", "plus", "original",
    "advanced", "release", "formula", "daily", "kids", "adult", "gold", "extra",
    "care", "the", "store", "energy", "power", "force", "pure", "natural",
    "active", "ultra", "super", "mega", "pro", "rapid", "fast", "new", "best",
    "kit", "gas", "air", "control", "balance", "relief", "support", "boost",
    "clear", "calm", "focus", "sport", "shield", "guard", "first", "aid",
}

# Stereochemistry / registry descriptors to strip from the stored INN string
# (keep the UNII intact — only the human-readable resolved_inn is cleaned).
_INN_TAIL = re.compile(r",\s*\(?[0-9rstRSstZE+/.\-]+\)?-?\s*$")


# Generic-house names that commonly *prefix* an INN ("Jamp Atorvastatin",
# "Apo Quetiapine"). Unambiguous companies — safe to strip from the front so the
# INN behind them is exposed. (Trailing makers are already handled by _leading.)
PREFIX_MAKERS = {
    "jamp", "apo", "teva", "sandoz", "mylan", "pms", "ratio", "novo", "auro",
    "riva", "sanis", "taro", "sivem", "mar", "van", "ran", "accel", "act", "ag",
    "bio", "pro", "co", "ipg", "natco", "sun", "pharma", "generic", "generics",
}


def _strip_prefix_makers(name: str) -> str:
    toks = name.split()
    while len(toks) >= 2 and toks[0] in PREFIX_MAKERS:
        toks = toks[1:]
    return " ".join(toks)


def _desalt(name: str) -> str:
    toks = [t for t in name.split() if t not in SALT_WORDS]
    out = " ".join(toks)
    prev = None
    while out and out != prev:          # peel agglutinated suffixes repeatedly
        prev = out
        out = GER_RE.sub("", out).strip()
    return out


def _morph_variants(tok: str) -> list[str]:
    out = []
    for a, b in MORPH:
        if tok.endswith(a) and len(tok) - len(a) >= 3:
            out.append(tok[: -len(a)] + b)
    return out


class Resolver:
    def __init__(self, idx: unii_reference.UniiIndex):
        self.idx = idx
        self.syn = idx.syn
        self.inn_keys = idx.inn_keys
        self.inn_display = idx.inn_display

    def _fuzzy_inn(self, term: str) -> str | None:
        if term and len(term) >= 5:
            m = process.extractOne(term, self.inn_keys, scorer=fuzz.ratio,
                                   score_cutoff=FUZZY_CUTOFF)
            if m:
                return self.inn_display[m[0]], round(m[1])
        return None

    def _leading(self, base: str):
        """Longest leading token-run that resolves to an INN; drops maker tails."""
        toks = base.split()
        for k in range(len(toks), 0, -1):
            cand = " ".join(toks[:k])
            # A lone common-word token must never seed ANY match ("Kit"→KIT
            # receptor, "Net"→NE transporter). Multi-word candidates are fine.
            if " " not in cand and cand in FUZZY_STOPWORDS:
                continue
            if cand in self.syn:
                return self.syn[cand], "leading", 0.90
            for v in _morph_variants(cand):
                if v in self.syn:
                    return self.syn[v], "leading_morph", 0.88
            # fuzzy is the loosest tier.
            if " " in cand or cand not in FUZZY_STOPWORDS:
                fz = self._fuzzy_inn(cand)
                if fz:
                    unii, score = fz
                    conf = 0.86 if score >= 95 else 0.76
                    return unii, f"leading_fuzzy@{score}", conf
        return None

    def resolve(self, raw: str) -> dict:
        """Return {status, unii?, method, confidence?, components?, reason?}."""
        # 0. classify obviously-unresolvable rows FIRST (on the *raw* string, so
        #    CJK/VNR rows aren't lost to the empty-after-normalise check below and
        #    a junk row can never fall through to a loose fuzzy match).
        if VNR.search(raw):
            return {"status": "quarantine", "reason": "vnr_code"}
        if CJK.search(raw):
            return {"status": "defer", "reason": "cjk"}
        if JUNK.search(raw):
            return {"status": "quarantine", "reason": "non_drug"}

        # Strip dosage + form noise so "Units/Ml" can't masquerade as a combo
        # separator and form words don't block an exact INN match.
        clean = _strip_form(raw)
        full = _norm(clean)
        if not full:
            return {"status": "quarantine", "reason": "empty"}

        # Combination FIRST — a multi-ingredient string must never be collapsed
        # to a single INN (e.g. "Neomycin / Polymyxin / Dexamethasone" → neomycin
        # is a clinical-safety error). Resolve each component through the full
        # single-ingredient ladder; if ≥2 resolve it's a combination, and if the
        # string clearly held ≥2 ingredient-like parts but we couldn't resolve
        # them all, we REFUSE (→ review) rather than collapse.
        parts = [p.strip() for p in COMBO_SEP.split(clean) if p.strip()]
        ingredient_parts = [p for p in parts if len(_norm(p)) >= 4]
        if len(ingredient_parts) >= 2:
            comps, seen = [], set()
            for part in ingredient_parts:
                hit = self._resolve_single(part)
                if hit and hit[0] not in seen:
                    seen.add(hit[0]); comps.append(hit[0])
            if len(comps) >= 2:
                return {"status": "combination", "components": comps,
                        "method": "combo", "confidence": 0.80}
            return {"status": "review", "reason": "combo_unresolved"}

        # Single ingredient — exact / desalt / paren / morph / leading.
        single = self._resolve_single(clean)
        if single:
            unii, method, conf = single
            return self._hit(unii, method, conf)
        return {"status": "review", "reason": "unmatched"}

    def _resolve_single(self, raw: str):
        """Resolve a single-ingredient string to (unii, method, conf) or None.
        Base-preferring: the salt-free form is tried before the salt-inclusive one
        in every tier, so "Quetiapine Fumarate" and "Quetiapine" roll up to the
        SAME molecule (the base UNII) rather than splitting into two heads. No
        combination logic, no quarantine — used directly and per-component."""
        full = _norm(raw)
        if not full:
            return None
        full = _strip_prefix_makers(full)        # "Jamp Atorvastatin" → "atorvastatin"
        base = _desalt(full)                       # "quetiapine fumarate" → "quetiapine"
        salted = base != full

        def _ok(c):  # reject a lone common-word token from matching at all
            return c and not (" " not in c and c in FUZZY_STOPWORDS)

        # 1. exact — prefer the base (salt-free) molecule.
        if _ok(base) and base in self.syn:
            return self.syn[base], ("desalt" if salted else "exact"), (0.95 if salted else 0.98)
        if _ok(full) and full in self.syn:
            return self.syn[full], "exact", 0.98
        # 2. parenthetical active — again prefer the desalted component.
        for par in re.findall(r"\(([^)]+)\)", raw):
            p = _norm(par)
            pb = _desalt(_strip_prefix_makers(p))
            for cand, conf in ((pb, 0.92), (p, 0.90)):
                if _ok(cand) and cand in self.syn:
                    return self.syn[cand], "paren", conf
        # 3. Romance morphology (exact-match only → high precision).
        for src in (base, full):
            for v in _morph_variants(src):
                if v in self.syn:
                    return self.syn[v], "morph", 0.90
        # 4. longest leading token-run (drops trailing maker/salt junk).
        for src in (base, full):
            lead = self._leading(src)
            if lead:
                return lead
        return None

    def _hit(self, unii: str, method: str, conf: float) -> dict:
        disp = (self.idx.display_of.get(unii) or "").strip()
        inn = _INN_TAIL.sub("", disp).strip().lower()      # drop ", (S)-" etc.
        return {
            "status": "resolved",
            "unii": unii,
            "inn": inn or disp.lower(),
            "rxcui": self.idx.rxcui_of.get(unii),
            "method": f"unii_bulk:{method}",
            "confidence": conf,
        }


# ──────────────────────────────────────────────────────────────────────────────


def _unresolved_shortage_drugs(sb, include_all: bool):
    """Drug rows lacking resolved_inn. Default: only those with a shortage event."""
    if include_all:
        rows, off = [], 0
        while True:
            r = (sb.table("drugs").select("id,generic_name,resolved_inn")
                 .is_("resolved_inn", "null").range(off, off + 999).execute())
            if not r.data:
                break
            rows.extend(r.data); off += 1000
        return rows

    ev, off = set(), 0
    while True:
        r = (sb.table("shortage_events").select("drug_id")
             .not_.is_("drug_id", "null").range(off, off + 999).execute())
        if not r.data:
            break
        for x in r.data:
            if x.get("drug_id"):
                ev.add(x["drug_id"])
        off += 1000
    idl = list(ev); rows = []
    for i in range(0, len(idl), 200):
        r = (sb.table("drugs").select("id,generic_name,resolved_inn")
             .in_("id", idl[i:i + 200]).execute())
        rows.extend(d for d in r.data if not d.get("resolved_inn"))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="resolve every unresolved drug, not just shortage-bearing")
    ap.add_argument("--execute", action="store_true", help="write to DB (default: dry-run)")
    ap.add_argument("--rebuild-index", action="store_true", help="re-parse UNII files")
    ap.add_argument("--limit", type=int, default=0, help="cap rows (debug)")
    ap.add_argument("--only", default="", help="restrict to rows whose name ILIKE %X% (scoped verification)")
    ap.add_argument("--manifest", default="logs/inn_bulk_manifest.json")
    args = ap.parse_args()

    print("loading UNII reference …", flush=True)
    idx = unii_reference.load(rebuild=args.rebuild_index)
    print(f"  synonyms={len(idx.syn):,}  INN-set={len(idx.inn_display):,}", flush=True)
    rv = Resolver(idx)

    sb = get_supabase_client()
    rows = _unresolved_shortage_drugs(sb, args.all)
    if args.only:
        needle = args.only.lower()
        rows = [d for d in rows if needle in (d["generic_name"] or "").lower()]
    if args.limit:
        rows = rows[: args.limit]
    print(f"unresolved target rows: {len(rows):,}  (execute={args.execute})", flush=True)

    buckets = defaultdict(list)
    for d in rows:
        res = rv.resolve(d["generic_name"] or "")
        res["id"] = d["id"]; res["name"] = d["generic_name"]
        buckets[res["status"]].append(res)

    resolved = buckets["resolved"]
    auto = [r for r in resolved if r["confidence"] >= AUTO_APPLY]
    held = [r for r in resolved if r["confidence"] < AUTO_APPLY]
    tot = len(rows)

    def pct(n):
        return f"{n:5d} ({100 * n / tot:.1f}%)" if tot else "0"

    print("\n=== resolution summary ===")
    print(f"  resolved (auto ≥{AUTO_APPLY}) : {pct(len(auto))}")
    print(f"  resolved (held < bar)    : {pct(len(held))}  -> review")
    print(f"  combination              : {pct(len(buckets['combination']))}  -> review")
    print(f"  defer (cjk)              : {pct(len(buckets['defer']))}")
    print(f"  quarantine (non-drug)    : {pct(len(buckets['quarantine']))}")
    print(f"  review (unmatched)       : {pct(len(buckets['review']))}")

    # distinct molecules among auto-resolved
    mols = {r["unii"] for r in auto}
    print(f"\n  auto-resolved rows roll up to {len(mols):,} distinct molecules")

    # precision sample — random-ish (every Nth) across methods for eyeballing
    sample = auto[:: max(1, len(auto) // 40)][:40]
    print("\n=== precision sample (auto-resolved) — verify name→INN by eye ===")
    for r in sample:
        print(f"  [{r['confidence']:.2f} {r['method'].split(':')[1]:14s}] "
              f"{(r['name'] or '')[:42]:42s} -> {r['inn']}")

    os.makedirs(os.path.dirname(args.manifest), exist_ok=True)
    with open(args.manifest, "w") as fh:
        json.dump({"auto": auto, "held": held,
                   "combination": buckets["combination"],
                   "quarantine": buckets["quarantine"],
                   "defer": buckets["defer"],
                   "review": buckets["review"]}, fh, indent=1, default=str)
    print(f"\nmanifest -> {args.manifest}")

    if not args.execute:
        print("\nDRY-RUN — no writes. Re-run with --execute to apply.")
        return

    # write path implemented in apply_resolution(); guarded separately
    from backend.importers.inn_bulk_apply import apply
    apply(sb, idx, auto, buckets["quarantine"])


if __name__ == "__main__":
    main()
