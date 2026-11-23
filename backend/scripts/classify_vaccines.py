"""
Set drugs.is_vaccine (migration 080) from the evidence on each drug record.
──────────────────────────────────────────────────────────────────────────────
Only 2 of ~155 vaccine records carry an ATC J07 code (2026-11-23), so the ATC
code alone finds almost nothing. A record is a vaccine when ANY of:

  atc_j07       atc_code / atc_code_full starts with J07
  who_eml_19_3  WHO EML section 19.3 (Immunologicals > Vaccines)
  name          a "vaccine" word in one of the languages our sources publish in
                (generic name, drug class, therapeutic category)
  brand         a curated vaccine brand in the generic or brand names

and NONE of the exclusions match. The exclusions are the look-alikes the audit
found: intravesical BCG for bladder cancer (OncoTICE / TICE / BCG-medac, ATC
L03AX03), RSV/other monoclonal antibodies (nirsevimab, palivizumab — ATC J06),
immunoglobulins and antitoxins, and homeopathic "vaccinotoxinum" products.
An explicit non-J07 ATC in L03 or J06 also vetoes a name/brand match.

The flag is recomputed for every drug, so the script both sets new vaccines
and clears records a rule change no longer counts. Run nightly after the
scrapers so auto-created drug records get classified.

Usage:
    python3 -m backend.scripts.classify_vaccines              # dry run + manifest
    python3 -m backend.scripts.classify_vaccines --execute    # apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# "vaccine" in the languages our sources publish in. Stems, matched anywhere
# in the text, so declensions match (vaccino, vacunas, vakcína, cepivo...).
_VACCINE_WORDS = [
    r"vaccin",            # en/fr/nl/it/ro/da/sv (vaccine, vaccin, vaccino)
    r"vacun",             # es
    r"vacin",             # pt (vacina)
    r"impfstoff",         # de
    r"vakzin",            # de (Vakzine)
    r"vakc",              # cs/sk/hu/lt/lv (vakcína, vakcina)
    r"vaksin",            # no/tr/id (vaksine, vaksin)
    r"cepiv",             # sl (cepivo), hr (cjepivo)
    r"rokote",            # fi
    r"olt[óo]anyag",      # hu
    r"szczepion",         # pl
    r"b[óo]luefni",       # is
    r"εμβ[όο]λι",         # el
    r"疫苗", r"ワクチン", r"백신",
    r"\btoxoid", r"toxo[iï]de", r"toksoid", r"tossoid",  # tetanus/diphtheria toxoid
]
_NAME_RE = re.compile("|".join(_VACCINE_WORDS), re.I)

# Brands whose records often carry no vaccine word at all (e.g. a generic name
# of "Pertactin" with brand "Boostrix"). Word-bounded, lowercase.
_BRANDS = [
    "boostrix", "infanrix", "pediarix", "pentacel", "vaxelis", "hexyon", "hexaxim",
    "hexacima", "tetraxim", "repevax", "revaxis", "adacel", "daptacel", "quadracel",
    "kinrix", "tdvax", "tenivac", "gardasil", "cervarix", "prevenar", "prevnar",
    "pneumovax", "vaxneuvance", "synflorix", "capvaxive", "apexxnar", "fluarix",
    "fluad", "vaxigrip", "vaxigriptetra", "influvac", "flucelvax", "fluenz", "flumist",
    "efluelda", "fluzone", "supemtek", "flublok", "afluria", "engerix", "twinrix",
    "havrix", "vaqta", "avaxim", "epaxal", "heplisav", "fendrix", "hbvaxpro",
    "recombivax", "prehevbri", "alpharix", "priorix", "m-m-rvaxpro", "m-m-r", "mmrvaxpro", "proquad",
    "varivax", "varilrix", "zostavax", "shingrix", "bexsero", "trumenba", "menveo",
    "nimenrix", "menquadfi", "menactra", "penbraya", "rotarix", "rotateq",
    "imovax", "rabipur", "verorab", "rabavert", "stamaril", "yf-vax", "typhim",
    "vivotif", "typherix", "dukoral", "vaxchora", "ixiaro", "qdenga", "dengvaxia",
    "comirnaty", "spikevax", "nuvaxovid", "vaxzevria", "jcovden", "vidprevtyn",
    "bimervax", "abrysvo", "arexvy", "mresvia", "encepur", "fsme-immun", "ticovac",
    "ixchiq", "vimkunya", "jynneos", "imvanex", "imvamune", "zabdeno", "mvabea",
    "ervebo", "q-vax", "procomvax", "comvax", "act-hib", "hiberix", "pedvaxhib",
    "menitorix", "polio sabin", "ipol", "bcg vaccine",
]
_BRAND_RE = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(b) for b in _BRANDS) + r")(?![a-z0-9])", re.I)

# Look-alikes that match the rules above but are not vaccines.
_EXCLUDE_RE = re.compile(
    r"oncotice|\btice\b|bcg[- ]?medac|intravesi|blase|bladder|"     # BCG immunotherapy
    r"nirsevim|beyfortus|palivizum|synagis|clesrovim|enflonsia|"   # RSV antibodies
    r"immunglobulin|immunoglobulin|antitoxin|"
    r"vaccinotox|vaccininum|vaccinoclenz|vaccinium",               # homeopathic, bilberry/cranberry
    re.I,
)


def classify(drug: dict) -> str | None:
    """The rule that makes this drug record a vaccine, or None."""
    atc = (drug.get("atc_code") or drug.get("atc_code_full") or "").strip().upper()
    names = " ".join(str(drug.get(k) or "") for k in ("generic_name", "brand_names_text"))
    context = " ".join(str(drug.get(k) or "") for k in ("drug_class", "therapeutic_category"))

    if atc.startswith("J07"):
        return "atc_j07"
    if _EXCLUDE_RE.search(names):
        return None
    if atc.startswith(("L03", "J06")):
        return None
    if str(drug.get("who_eml_section") or "").startswith("19.3"):
        return "who_eml_19_3"
    if _NAME_RE.search(names) or _NAME_RE.search(context):
        return "name"
    if _BRAND_RE.search(names):
        return "brand"
    return None


def _all_drugs(db) -> list[dict]:
    cols = ("id, generic_name, brand_names_text, atc_code, atc_code_full, drug_class, "
            "therapeutic_category, who_eml_section, is_vaccine, vaccine_signal")
    try:
        db.table("drugs").select("is_vaccine").limit(1).execute()
    except Exception:
        # Migration 080 not applied yet: a dry run still works (all start false).
        print("NOTE: drugs.is_vaccine missing (migration 080 not applied) — dry run only")
        cols = cols.replace(", is_vaccine, vaccine_signal", "")
    out, start = [], 0
    while True:
        page = db.table("drugs").select(cols).order("id").range(start, start + 999).execute().data
        out += page
        if len(page) < 1000:
            return out
        start += 1000


def main() -> None:
    from dotenv import load_dotenv
    from supabase import create_client

    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--manifest-dir", default=".", help="where to write the change manifest")
    args = ap.parse_args()

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    drugs = _all_drugs(db)

    changes = []
    for d in drugs:
        signal = classify(d)
        want = signal is not None
        if bool(d.get("is_vaccine")) != want or (d.get("vaccine_signal") or None) != signal:
            changes.append({"id": d["id"], "generic_name": d["generic_name"],
                            "brand_names_text": (d.get("brand_names_text") or "")[:120],
                            "atc_code": d.get("atc_code"),
                            "from": {"is_vaccine": bool(d.get("is_vaccine")), "vaccine_signal": d.get("vaccine_signal")},
                            "to": {"is_vaccine": want, "vaccine_signal": signal}})

    total = sum(1 for d in drugs if classify(d))
    print(f"drugs scanned:      {len(drugs)}")
    print(f"classified vaccine: {total}  by rule: {dict(Counter(classify(d) for d in drugs if classify(d)))}")
    print(f"changes:            {len(changes)}  "
          f"(set {sum(c['to']['is_vaccine'] and not c['from']['is_vaccine'] for c in changes)}, "
          f"clear {sum(c['from']['is_vaccine'] and not c['to']['is_vaccine'] for c in changes)})")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    manifest = Path(args.manifest_dir) / f"vaccine_classification_manifest_{stamp}.json"
    manifest.write_text(json.dumps(changes, indent=2, ensure_ascii=False))
    print(f"manifest:           {manifest}")

    if not args.execute:
        print("dry run — nothing written (pass --execute to apply)")
        return

    by_value: dict[tuple, list[str]] = {}
    for c in changes:
        by_value.setdefault((c["to"]["is_vaccine"], c["to"]["vaccine_signal"]), []).append(c["id"])
    written = 0
    for (flag, signal), ids in by_value.items():
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            db.table("drugs").update({"is_vaccine": flag, "vaccine_signal": signal}).in_("id", chunk).execute()
            written += len(chunk)
    print(f"written:            {written}")


if __name__ == "__main__":
    main()
