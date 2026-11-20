"""
catalogue_relink_mislinks.py — re-check EXISTING drug_catalogue.drug_id links
with the strict INN resolver and repair the ones that point at the wrong
molecule.

WHY: the old linkers (scripts/link_catalogue_*.py, catalogue_import_tga.py)
fell back to a first-word index built with setdefault, so the first drug whose
name starts with "sandoz", "insulin", "penicillin"… became the link target for
every product starting with that word. The 2026-11-06 linkage audit counted
2,175 register rows on a different molecule (Humalog/Lyumjev on Insulin
glargine; 209 unrelated Sandoz products on one Sandoz losartan row). Those rows
show the wrong medicine on a drug page and the wrong shortage status beside it.
catalogue_inn_backfill only ever fills NULL links, so it never revisits these.

DECISION per linked row (product text = generic_name + brand_name):
  1. Is the current link SUPPORTED by the product text? — a distinctive word
     of the linked drug's name or resolved INN (not a salt, form, company or
     class word like "insulin"/"sandoz") appears in it, or one of its
     brand_names does. Unsupported = the link came from a shared first word.
  2. Strict resolver (catalogue_inn_backfill phrase index, whole-phrase
     longest match) lists the INNs named in the product text.
  • supported, and a SECOND different INN is named, and the linked drug is
    single-ingredient → set NULL (combination filed under one ingredient)
  • supported otherwise → keep (salt/spelling/brand variants stay put)
  • unsupported, exactly one INN named, a different molecule that has a
    resolved INN → relink to it (following canonical_drug_id)
  • unsupported, two or more INNs named → set NULL
  • unsupported, no INN named (brand-only, e.g. CA "HUMALOG") → keep; can't
    verify from the name
"Same molecule" = same id, same inn_risk_scores group, same resolved_inn, or
identical names once salt/hydrate words are removed. NULL is honest; a row on
the wrong molecule shows the wrong medicine and shortage status.

SAFETY:
  • dry-run by default; --execute writes
  • every PATCH is guarded with drug_id=eq.<old link>, so a row changed since
    the scan is left alone and re-runs are idempotent
  • writes a revert manifest (catalogue_id, old, new) before writing

Usage:
  python3 -m backend.importers.catalogue_relink_mislinks            # dry-run
  python3 -m backend.importers.catalogue_relink_mislinks --execute
"""
import csv
import json
import re
import os
import random
import sys
from collections import Counter, defaultdict

from backend.importers.catalogue_inn_backfill import (
    SALTS, TOKEN, _get_all, _req, _combo_signal, build_index, make_resolver,
)

EXECUTE = "--execute" in sys.argv


# Words that never identify a molecule on their own.
STOP = SALTS | {
    "insulin", "vitamin", "human", "biosynthetic", "recombinant", "tablet", "tablets", "tab", "tabs",
    "capsule", "capsules", "cap", "caps", "injection", "inj", "infusion", "cream", "ointment", "gel",
    "lotion", "solution", "suspension", "oral", "syrup", "drops", "spray", "nasal", "eye", "ear",
    "film", "coated", "modified", "release", "extended", "delayed", "chewable", "powder", "for",
    "usp", "bp", "ph", "eur", "and", "with", "the", "of", "in", "or", "mg", "ml", "mcg", "units",
    "pack", "blister", "bottle", "vial", "ampoule", "pen", "prefilled", "syringe", "kit", "forte",
    "plus", "relief", "allergy", "cold", "flu", "day", "night", "adult", "children", "kids", "max",
    "maximum", "strength", "extra", "regular", "original", "generic", "acid", "concentrate",
    # companies / retailers that prefix product names
    "sandoz", "teva", "apo", "jamp", "mylan", "pms", "auro", "mint", "ach", "act", "sanis", "sivem",
    "accord", "viatris", "pfizer", "novartis", "blooms", "chemist", "priceline", "pharmacy", "health",
    "good", "sense", "equate", "pharmachoice", "chemists", "own", "terry", "white", "amcal", "apotex",
    "arrow", "generichealth", "noumed", "lupin", "cipla", "sun", "aurobindo", "pharmacor", "medis",
    "taro", "riva", "ranbaxy", "nora", "marcan", "pro", "doc", "nat", "van", "dom", "ag", "nra",
}
COMPANY_HEAD = re.compile(
    r"^(sandoz|teva|apo|jamp|mylan|pms|auro|mint|sanis|sivem|accord|viatris|blooms|priceline|"
    r"pharmacy|chemists?|terry white|amcal|good sense|equate|kirkland|walgreens|cvs|rite aid|"
    r"healthy living|healthy haniel)\b", re.I)
# Counter-ions left over when salt words are stripped ("Calcium Chloride
# Dihydrate" → "chloride"); never a molecule on their own.
IONS = {"chloride", "bromide", "nitrate", "iodide", "carbonate", "oxide", "bicarbonate", "ion",
        "bicarbonate ion", "hydroxide", "sulfide", "fluoride", "chlorohydrate"}
DILUENTS = {"sodium chloride", "glucose", "dextrose", "water for injection", "sterile water",
            "propylene glycol", "aloe", "aloe vera", "lanolin", "simethicone"}
WORD = re.compile(r"[a-z]+")
CLASS = STOP - SALTS     # form / company / class words: never a molecule alone


def combo(name: str) -> bool:
    """_combo_signal is case-sensitive (" and " misses "PIPERACILLIN AND …")."""
    return _combo_signal((name or "").lower())


def strip_salts(name: str) -> str:
    return " ".join(t for t in TOKEN.findall((name or "").lower()) if t not in SALTS)


def words(text: str) -> set:
    # hyphens split: "JAMP-IRBESARTAN" names irbesartan
    return {t for t in WORD.findall((text or "").lower()) if len(t) >= 3 and t not in STOP}


def make_inn_lister(phrase_index, max_words):
    """All distinct single-ingredient drugs named in the text (whole-phrase,
    longest match), skipping salt words, denied rows and diluents."""
    from backend.importers.catalogue_inn_backfill import DENY

    def inns(text):
        out = {}
        low = (text or "").lower()
        for variant in (low, low.replace("-", " ")):
            out.update(_scan(TOKEN.findall(variant)))
        return list(out.values())

    def _scan(toks):
        out, i = {}, 0
        while i < len(toks):
            hit = None
            for n in range(min(max_words, len(toks) - i), 0, -1):
                gram = " ".join(toks[i:i + n])
                d = phrase_index.get(tuple(toks[i:i + n]))
                # a bare class word ("insulin", "vitamin") names no molecule
                class_only = all(t in CLASS for t in WORD.findall(gram))
                if (d and len(gram) >= 4 and not class_only and gram not in DENY and gram not in SALTS
                        and gram not in DILUENTS and gram not in IONS):
                    hit = (d, n)
                    break
            if hit:
                out[hit[0]["id"]] = hit[0]
                i += hit[1]
            else:
                i += 1
        return out
    return inns


def main():
    mode = "EXECUTE (writing)" if EXECUTE else "DRY-RUN (no writes)"
    print(f"=== catalogue_relink_mislinks — {mode} ===")
    phrase_index, max_words = build_index()
    # also index each target without its salt words, so "SANDOZ OXYCODONE CR"
    # finds the "Oxycodone Hydrochloride" row
    for key, d in list(phrase_index.items()):
        bare = tuple(t for t in key if t not in SALTS)
        if bare and bare != key and " ".join(bare) not in IONS:
            phrase_index.setdefault(bare, d)
    inns_in = make_inn_lister(phrase_index, max_words)

    drugs = {d["id"]: d for d in _get_all(
        "drugs?select=id,generic_name,brand_names,resolved_inn,canonical_drug_id&order=id")}
    group = {}
    for p in _get_all("inn_risk_scores?select=inn,drug_ids&order=inn"):
        for did in p.get("drug_ids") or []:
            group[did] = p["inn"]

    def mol(did):
        m = strip_salts(drugs.get(did, {}).get("resolved_inn") or "")
        return m if m and m not in IONS else None

    def same_molecule(a: str, b: str) -> bool:
        if a == b:
            return True
        if group.get(a) and group.get(a) == group.get(b):
            return True
        ma, mb = mol(a), mol(b)
        if ma and mb and (set(ma.split()) <= set(mb.split()) or set(mb.split()) <= set(ma.split())):
            return True
        na = strip_salts(drugs.get(a, {}).get("generic_name", ""))
        nb = strip_salts(drugs.get(b, {}).get("generic_name", ""))
        return bool(na) and na == nb

    # The row that IS the molecule: generic name (salts removed) equals its
    # resolved INN. canonical_drug_id is not used — it is contaminated
    # (Hydrochlorothiazide → "Exforge Hct").
    mol_row = {}
    for did in sorted(drugs):
        m = mol(did)
        if m and strip_salts(drugs[did].get("generic_name")) == m:
            if m not in mol_row or (group.get(did) and not group.get(mol_row[m])):
                mol_row[m] = did

    def molecules(found):
        """Distinct molecules named, keyed by resolved INN; rows without one
        (brand fragments, excipients, junk) don't count."""
        out = {}
        for d in found:
            m = mol(d["id"])
            # only rows whose own name carries the molecule: brand rows'
            # resolved_inn is sometimes wrong ("Apo-Go" → glucose oxidase)
            if m and words(d.get("generic_name")) & words(m):
                out.setdefault(m, d)
        # "olmesartan" and "olmesartan medoxomil" are one molecule
        keys = sorted(out, key=len)
        for k in list(keys):
            if any(k != o and set(k.split()) <= set(o.split()) for o in keys if o in out):
                out.pop(k, None)
        return out

    def same_as_cur(m, cur):
        mc = mol(cur) or strip_salts(drugs.get(cur, {}).get("generic_name", ""))
        if not mc:
            return False
        a, b = set(m.split()), set(mc.split())
        return a <= b or b <= a

    def supported(text: str, cur: str) -> bool:
        d = drugs.get(cur, {})
        tw = words(text)
        if words(d.get("generic_name")) & tw or words(d.get("resolved_inn")) & tw:
            return True
        low = " " + " ".join(TOKEN.findall(text.lower())) + " "
        for b in d.get("brand_names") or []:
            bn = " ".join(TOKEN.findall((b or "").lower()))
            if len(bn) >= 4 and f" {bn} " in low:
                return True
        return False

    rows = _get_all(
        "drug_catalogue?select=id,generic_name,brand_name,source_country,registration_number,drug_id"
        "&drug_id=not.is.null&order=id"
    )
    print(f"  linked catalogue rows: {len(rows)}")

    actions = []           # (row, action, new_drug_id or None, reason)
    decision = {}          # catalogue id -> tally key (for review dumps)
    tally = Counter()
    for r in rows:
        cur = r["drug_id"]
        cur_name = drugs.get(cur, {}).get("generic_name") or ""
        text = " ".join(n for n in (r.get("generic_name"), r.get("brand_name")) if n)
        mols = molecules(inns_in(text))
        others = {m: d for m, d in mols.items() if not same_as_cur(m, cur)}
        cur_single = not combo(cur_name)
        # a single-ingredient product under a company- or combination-named row
        cur_hub = bool(COMPANY_HEAD.match(cur_name)) or (combo(cur_name) and not combo(text))
        # Molecule evidence beats a shared word: "CARTIA aspirin" shares
        # "cartia" with "Cartia XT (diltiazem)" but names only aspirin.
        if (len(mols) == 1 and others and mol(cur) and not combo(text) and not combo(cur_name)
                and supported(text, cur) and not (words(mol(cur)) & words(text))):
            m = next(iter(others))
            tgt = mol_row.get(m)
            if tgt and not same_molecule(tgt, cur):
                actions.append((r, "relink", tgt, f"{cur_name} → {drugs[tgt]['generic_name']} (names only {m})"))
                tally["RELINK: names one other molecule"] += 1
                continue
        if supported(text, cur):
            if others and cur_single and len(mols) > len(others):
                actions.append((r, "unlink", None, f"combination ({' + '.join(mols)}) filed under {cur_name}"))
                tally["UNLINK: combination under one ingredient"] += 1
            else:
                tally["keep: link supported by name"] += 1
                decision[r["id"]] = "keep: supported"
            continue
        if len(others) >= 2:
            actions.append((r, "unlink", None, f"unsupported link to {cur_name}; names {' + '.join(others)}"))
            tally["UNLINK: unsupported, combination"] += 1
            continue
        if len(others) == 1 and len(mols) == 1 and not combo(text):
            m = next(iter(others))
            tgt = mol_row.get(m)
            if tgt and not same_molecule(tgt, cur):
                actions.append((r, "relink", tgt, f"{cur_name} → {drugs[tgt]['generic_name']}"))
                tally["RELINK: unsupported link, one other molecule"] += 1
            else:
                tally["keep: no molecule-named row to move to"] += 1
            continue
        if cur_hub:
            # linked to a company- or combination-named row by a shared first
            # word, and the name gives no ingredient to move it to
            actions.append((r, "unlink", None, f"unsupported link to hub row {cur_name}"))
            tally["UNLINK: unsupported, hub row"] += 1
            continue
        tally["keep: unsupported but no INN named (can't verify)"] += 1
        decision[r["id"]] = "keep: unsupported but no INN named"

    print("\n  RESULT:")
    for k, v in sorted(tally.items()):
        print(f"    {k:44s} {v:7d}")

    by_country = Counter((r["source_country"], a) for r, a, _, _ in actions)
    print("\n  actions by country:", dict(by_country))
    old_hubs = Counter(r["drug_id"] for r, _, _, _ in actions)
    print("\n  drugs losing the most rows (hubs):")
    for did, n in old_hubs.most_common(15):
        print(f"    {n:5d}  {drugs.get(did, {}).get('generic_name')}")
    random.seed(11)
    print("\n  RANDOM 40 actions (eyeball):")
    for r, a, new, why in random.sample(actions, min(40, len(actions))):
        print(f"    {a:7s} {r['source_country']} {(r.get('brand_name') or '')[:48]:48s} | {why}")

    if os.environ.get("RELINK_DUMP_KEEPS"):
        with open("catalogue_relink_keeps.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["catalogue_id", "country", "reg_no", "brand_name", "generic_name", "drug", "decision"])
            for r in rows:
                if r["id"] in decision:
                    w.writerow([r["id"], r["source_country"], r.get("registration_number"), r.get("brand_name"),
                                r.get("generic_name"), drugs.get(r["drug_id"], {}).get("generic_name"), decision[r["id"]]])
    out = os.path.join(os.getcwd(), "catalogue_relink_actions.csv")
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["catalogue_id", "country", "reg_no", "brand_name", "generic_name",
                    "action", "old_drug_id", "old_drug", "new_drug_id", "new_drug", "reason"])
        for r, a, new, why in actions:
            w.writerow([r["id"], r["source_country"], r.get("registration_number"), r.get("brand_name"),
                        r.get("generic_name"), a, r["drug_id"], drugs.get(r["drug_id"], {}).get("generic_name"),
                        new or "", drugs.get(new, {}).get("generic_name", "") if new else "", why])
    print(f"\n  full action list: {out} ({len(actions)} rows)")

    if not EXECUTE:
        print("  DRY-RUN: nothing written. Re-run with --execute to apply.")
        return

    mpath = os.path.join(os.getcwd(), "catalogue_relink_manifest.json")
    with open(mpath, "w") as f:
        json.dump([{"catalogue_id": r["id"], "old": r["drug_id"], "new": new} for r, _, new, _ in actions], f)
    print(f"  revert manifest: {mpath}")

    # Group writes by (old, new) so each PATCH is one guarded statement.
    batches = defaultdict(list)
    for r, _, new, _ in actions:
        batches[(r["drug_id"], new)].append(r["id"])
    written = 0
    for (old, new), ids in batches.items():
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            _req("PATCH", f"drug_catalogue?id=in.({','.join(chunk)})&drug_id=eq.{old}",
                 body={"drug_id": new}, extra={"Prefer": "return=minimal"})
            written += len(chunk)
    print(f"  DONE: {written} rows written.")


if __name__ == "__main__":
    main()
