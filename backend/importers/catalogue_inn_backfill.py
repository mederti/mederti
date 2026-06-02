"""
catalogue_inn_backfill.py — resolve drug_catalogue products to their canonical
INN drug and backfill drug_catalogue.drug_id.

WHY: brand-only catalogue products (e.g. "LORSTAT 80 atorvastatin …", registered
in the ARTG but not present as a brand on any canonical `drugs` row) carry
drug_id = NULL, so search dead-ends on a raw product row showing "0 shortages"
instead of rolling up to Atorvastatin and its real shortage count. ~52% of the
catalogue (84k rows) is unlinked.

HOW (deterministic, no fuzzy matching):
  • match target = canonical single-ingredient `drugs` that have >=1 shortage
    event (the clinically meaningful vocabulary; excludes junk rows like
    "Calcium"/"Vitamin"/"Skin" that pollute the table)
  • token longest-match of canonical generic_name phrases inside the product name
  • salt/hydrate descriptors (calcium, sodium, sulfate, trihydrate, …) do NOT
    count as a second active ingredient — they don't trip the combo guard
  • REFUSE (leave NULL) when >=2 distinct real INNs match (combination product)
    or when no INN matches. A wrong mapping on a clinical tool is worse than NULL.

SAFETY:
  • dry-run by default; writes ONLY when invoked with --execute
  • PATCH is guarded with drug_id=is.null so it can never overwrite an existing
    link and is idempotent / safe to re-run as new catalogue rows arrive.

Usage:
  python3 -m backend.importers.catalogue_inn_backfill            # dry-run + sample
  python3 -m backend.importers.catalogue_inn_backfill --execute  # write
"""
import os
import re
import sys
import json
import urllib.request
import urllib.parse
from collections import Counter, defaultdict

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
EXECUTE = "--execute" in sys.argv

_H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _req(method, path, body=None, extra=None):
    headers = dict(_H)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if extra:
        headers.update(extra)
    req = urllib.request.Request(URL + "/rest/v1/" + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _get_all(path_no_paging, page=1000):
    """GET every row of a select, paginating on offset."""
    out, off = [], 0
    sep = "&" if "?" in path_no_paging else "?"
    while True:
        page_rows = _req("GET", f"{path_no_paging}{sep}limit={page}&offset={off}")
        if not page_rows:
            break
        out.extend(page_rows)
        off += page
        if len(page_rows) < page:
            break
    return out


# ── Salt / hydrate / ester descriptors — counter-ions & solvates, NOT actives.
# Deliberately excludes words that are themselves real actives (chloride,
# nitrate, bromide, zinc, hydrochlorothiazide).
SALTS = {
    "calcium", "sodium", "potassium", "magnesium", "lithium", "aluminium",
    "aluminum", "meglumine", "diolamine", "olamine", "trometamol",
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
}
COMBO = re.compile(r"[/;+,]| and ")
TOKEN = re.compile(r"[a-z][a-z\-]*")


def build_index():
    """Return (phrase_index, max_words). phrase_index: tuple(words) -> drug."""
    drugs = _get_all("drugs?select=id,generic_name&order=id")
    print(f"  canonical drugs loaded: {len(drugs)}")

    # Allowlist: canonical drugs that have >=1 shortage event.
    short_ids = set()
    for r in _get_all("shortage_events?select=drug_id"):
        if r.get("drug_id"):
            short_ids.add(r["drug_id"])
    print(f"  canonical drugs with >=1 shortage event: {len(short_ids)}")

    phrase_index, max_words = {}, 1
    for d in drugs:
        if d["id"] not in short_ids:
            continue
        gn = (d.get("generic_name") or "").strip()
        if not gn or COMBO.search(gn):
            continue
        norm = gn.lower()
        if len(norm) < 4:
            continue
        words = tuple(norm.split())
        phrase_index.setdefault(words, d)
        max_words = max(max_words, len(words))
    print(f"  single-ingredient match targets: {len(phrase_index)} (max {max_words} words)")
    return phrase_index, max_words


# Non-INN canonical rows that pollute `drugs` (excipients, cosmetics, vehicles,
# routes). They must never be a link target. Data-driven from observed bad
# mappings; extend as new ones surface.
# Vetted denylist of canonical `drugs` rows that are NOT prescription INNs and
# must never be a link target. Built by reviewing all 512 candidate targets.
DENY = {
    # excipients / routes / vehicles / cosmetic vocab
    "oral", "titanium", "sunscreen", "oxygen", "hand sanitizer", "sanitizer",
    "skin", "vitamin", "zinc oxide", "alcohol", "water", "glycerol", "glycerin",
    "petrolatum", "paraffin", "lanolin", "talc", "starch", "glucose", "dextrose",
    "sucrose", "lactose", "honey", "menthol", "camphor", "isopropyl alcohol",
    "alcohol antiseptic", "water for injection", "sterile water", "normal saline",
    "saline", "triclosan", "benzalkonium chloride",
    # bare elements / minerals — supplement-dominant; real pharma forms have
    # their own specific salt canonicals (Calcium Chloride, Magnesium Sulfate…)
    "calcium", "zinc", "iron", "magnesium", "iodine", "iodide",
    # manufacturers masquerading as drug rows
    "jamp", "teva", "mylan", "sandoz", "novo", "taro",
    # common words / cosmetic & non-drug brand fragments
    "control", "mint", "burn", "vitality", "premier", "bull", "maximum",
    "secret", "suave", "class", "direct", "old spice", "silver bullet",
    "black widow", "non pollen", "ultra violette", "similasan", "alka seltzer",
    "raging bull",
    # nutraceuticals / supplements
    "garcinia cambogia", "glutathione", "l-carnitine", "levocarnitine",
    "alpha lipoic acid", "glucosamine", "betaine", "glutamine", "gaba",
    "thyroid", "digestive enzymes", "retinol", "ghk-cu", "arnica", "urea",
    # product-name rows / niche diagnostics
    "honey lemon flavor cough drop", "menthol flavor cough drop",
    "cough drops menthol", "rose bengal", "methylene blue",
}
# Combination markers: a separator between two ingredient-like tokens means the
# product is a multi-active combination. If we can't positively resolve it to a
# single canonical combo entry, we REFUSE — collapsing a combo to one ingredient
# is a clinical-safety error (e.g. "ethynodiol AND ethinyl estradiol" -> Estradiol).
# Includes " - " which separates homeopathic mixture ingredient lists.
COMBO_NAME = re.compile(r"[,/;+]|\b and \b|\bwith\b|\s[-–]\s")


def make_resolver(phrase_index, max_words):
    def resolve(product_name):
        name = (product_name or "")
        toks = TOKEN.findall(name.lower())
        salt_only, real = [], []
        i = 0
        while i < len(toks):
            hit = None
            for n in range(min(max_words, len(toks) - i), 0, -1):
                gram = " ".join(toks[i:i + n])
                d = phrase_index.get(tuple(toks[i:i + n]))
                if d and gram not in DENY:          # never target a denied row
                    hit = (gram, d, n)
                    break
            if hit:
                (salt_only if hit[0] in SALTS else real).append(hit[1])
                i += hit[2]
            else:
                i += 1
        real_ids = {d["id"] for d in real}
        # Combination product whose ingredients we only partly recognise -> refuse.
        if COMBO_NAME.search(name) and len(real_ids) <= 1:
            return None, "combo-name"
        if len(real_ids) == 1:
            return real[0], "resolved"
        if len(real_ids) >= 2:
            return None, "ambiguous"
        salt_ids = {d["id"] for d in salt_only}
        if len(salt_ids) == 1 and not COMBO_NAME.search(name):
            return salt_only[0], "resolved-salt"
        return None, "no-inn"
    return resolve


def patch_chunk(catalogue_ids, drug_id):
    """Fill drug_id on the given catalogue rows; NEVER overwrites a non-null link."""
    id_list = ",".join(catalogue_ids)
    path = f"drug_catalogue?id=in.({id_list})&drug_id=is.null"
    _req("PATCH", path, body={"drug_id": drug_id},
         extra={"Prefer": "return=minimal"})


def main():
    mode = "EXECUTE (writing)" if EXECUTE else "DRY-RUN (no writes)"
    print(f"=== catalogue_inn_backfill — {mode} ===")
    phrase_index, max_words = build_index()
    resolve = make_resolver(phrase_index, max_words)

    print("  scanning unlinked catalogue rows (drug_id IS NULL) …")
    rows = _get_all("drug_catalogue?select=id,generic_name,brand_name,drug_id&drug_id=is.null&order=id")
    print(f"  unlinked rows: {len(rows)}")

    import random
    buckets = Counter()
    by_target = defaultdict(list)            # drug_id -> [catalogue_id]
    target_name = {}                          # drug_id -> generic_name
    resolved_pairs = []                       # (product_name, canonical) for ALL resolved
    target_example = {}                       # drug_id -> example product name
    for r in rows:
        nm = r.get("generic_name") or r.get("brand_name") or ""
        drug, reason = resolve(nm)
        buckets[reason] += 1
        if drug:
            by_target[drug["id"]].append(r["id"])
            target_name[drug["id"]] = drug["generic_name"]
            target_example.setdefault(drug["id"], nm[:55])
            resolved_pairs.append((nm[:60], drug["generic_name"]))

    tot = sum(buckets.values())
    print(f"\n  RESULT over {tot} unlinked rows:")
    for k, v in buckets.most_common():
        print(f"    {k:14s} {v:6d}  ({100*v/tot:.1f}%)")
    resolvable = sum(len(v) for v in by_target.values())
    print(f"  -> would link {resolvable} rows to {len(by_target)} distinct canonical drugs")

    print("\n  TOP 30 target drugs by row count (eyeball for junk):")
    top = sorted(by_target.items(), key=lambda kv: len(kv[1]), reverse=True)[:30]
    for did, ids in top:
        print(f"    {len(ids):5d}  {target_name[did]}")

    random.seed(42)
    print("\n  RANDOM 40 proposed links across the WHOLE set (product → canonical):")
    for nm, tgt in random.sample(resolved_pairs, min(40, len(resolved_pairs))):
        print(f"    {tgt:26s} <- {nm}")

    # Dump the full candidate-target list for human vetting.
    tpath = os.path.join(os.getcwd(), "catalogue_inn_targets.tsv")
    with open(tpath, "w") as f:
        f.write("count\tdrug_id\tgeneric_name\texample_product\n")
        for did, ids in sorted(by_target.items(), key=lambda kv: -len(kv[1])):
            f.write(f"{len(ids)}\t{did}\t{target_name[did]}\t{target_example.get(did,'')}\n")
    print(f"\n  full {len(by_target)}-target list written: {tpath}")

    if not EXECUTE:
        print("  DRY-RUN: nothing written. Re-run with --execute to apply.")
        return

    # Revert manifest: the exact rows we are about to touch. Lets us undo
    # precisely (our writes are otherwise indistinguishable from pre-existing
    # links once drug_id is no longer NULL).
    manifest = [{"catalogue_id": cid, "drug_id": did}
                for did, ids in by_target.items() for cid in ids]
    mpath = os.path.join(os.getcwd(), "catalogue_inn_backfill_manifest.json")
    with open(mpath, "w") as f:
        json.dump(manifest, f)
    print(f"\n  revert manifest written: {mpath} ({len(manifest)} rows)")

    print(f"  WRITING {resolvable} links in chunks …")
    written, done_targets = 0, 0
    for drug_id, cat_ids in by_target.items():
        for i in range(0, len(cat_ids), 100):
            chunk = cat_ids[i:i + 100]
            patch_chunk(chunk, drug_id)
            written += len(chunk)
        done_targets += 1
        if done_targets % 200 == 0:
            print(f"    … {done_targets}/{len(by_target)} drugs, {written} rows")
    print(f"  DONE: backfilled drug_id on {written} catalogue rows.")


if __name__ == "__main__":
    main()
