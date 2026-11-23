"""
Set drugs.is_vaccine (migration 080) and drugs.vaccine_type (081) from the evidence on each drug record.
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


def target(drug: dict) -> dict:
    """The vaccine columns this drug record should carry."""
    from backend.utils.vaccine_types import TYPE_NAMES, vaccine_type

    signal = classify(drug)
    vtype = vaccine_type(drug.get("generic_name"), drug.get("brand_names_text")) if signal else None
    return {"is_vaccine": signal is not None, "vaccine_signal": signal,
            "vaccine_type": vtype, "vaccine_type_name": TYPE_NAMES.get(vtype) if vtype else None}


def _has_column(db, col: str) -> bool:
    try:
        db.table("drugs").select(col).limit(1).execute()
        return True
    except Exception:
        return False


def _all_drugs(db, fields: list[str]) -> list[dict]:
    cols = ("id, generic_name, brand_names_text, atc_code, atc_code_full, drug_class, "
            "therapeutic_category, who_eml_section" + "".join(f", {f}" for f in fields))
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

    # Only manage the columns that exist (migrations 080 / 081 may lag).
    fields = []
    if _has_column(db, "is_vaccine"):
        fields += ["is_vaccine", "vaccine_signal"]
    else:
        print("NOTE: drugs.is_vaccine missing (migration 080 not applied) — dry run only")
    if _has_column(db, "vaccine_type"):
        fields += ["vaccine_type", "vaccine_type_name"]
    else:
        print("NOTE: drugs.vaccine_type missing (migration 081 not applied) — types not written")
    managed = fields or ["is_vaccine", "vaccine_signal", "vaccine_type", "vaccine_type_name"]
    drugs = _all_drugs(db, fields)

    changes = []
    targets = {}
    for d in drugs:
        want = {k: v for k, v in target(d).items() if k in managed}
        targets[d["id"]] = want
        have = {k: (bool(d.get(k)) if k == "is_vaccine" else (d.get(k) or None)) for k in managed}
        if have != want:
            changes.append({"id": d["id"], "generic_name": d["generic_name"],
                            "brand_names_text": (d.get("brand_names_text") or "")[:120],
                            "atc_code": d.get("atc_code"), "from": have, "to": want})

    vaccines = [t for t in targets.values() if t.get("is_vaccine")]
    print(f"drugs scanned:      {len(drugs)}")
    print(f"classified vaccine: {len(vaccines)}  by rule: {dict(Counter(t['vaccine_signal'] for t in vaccines))}")
    if "vaccine_type" in managed:
        typed = [t["vaccine_type"] for t in vaccines if t.get("vaccine_type")]
        print(f"vaccine types:      {len(set(typed))} types over {len(typed)} records ({len(vaccines) - len(typed)} untyped)")
    print(f"changes:            {len(changes)}  "
          f"(set {sum(c['to'].get('is_vaccine', False) and not c['from'].get('is_vaccine', False) for c in changes)}, "
          f"clear {sum(c['from'].get('is_vaccine', False) and not c['to'].get('is_vaccine', False) for c in changes)})")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    manifest = Path(args.manifest_dir) / f"vaccine_classification_manifest_{stamp}.json"
    manifest.write_text(json.dumps(changes, indent=2, ensure_ascii=False))
    print(f"manifest:           {manifest}")

    if not args.execute or not fields:
        print("dry run — nothing written (pass --execute to apply)")
        if fields and _has_event_column(db):
            type_events(db, [d for d, t in targets.items() if t.get("is_vaccine")], args)
        return

    by_value: dict[tuple, list[str]] = {}
    for c in changes:
        by_value.setdefault(tuple(sorted(c["to"].items())), []).append(c["id"])
    written = 0
    for values, ids in by_value.items():
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            db.table("drugs").update(dict(values)).in_("id", chunk).execute()
            written += len(chunk)
    print(f"written:            {written}")

    if _has_event_column(db):
        type_events(db, [d for d, t in targets.items() if t.get("is_vaccine")], args)
    else:
        print("NOTE: shortage_events.vaccine_type missing (migration 082 not applied) — events not typed")


def _has_event_column(db) -> bool:
    try:
        db.table("shortage_events").select("vaccine_type").limit(1).execute()
        return True
    except Exception:
        return False


def type_events(db, vaccine_drug_ids: list[str], args) -> None:
    """Set shortage_events.vaccine_type (migration 082) on every notice filed
    on a vaccine record, from the notice's own raw_data — the record it is
    filed on is unreliable (see backend/utils/vaccine_types.py)."""
    from backend.utils.vaccine_types import event_vaccine_type

    rows: list[dict] = []
    for i in range(0, len(vaccine_drug_ids), 40):
        chunk = vaccine_drug_ids[i:i + 40]
        start = 0
        while True:
            page = (db.table("shortage_events").select("id, raw_data, vaccine_type")
                    .in_("drug_id", chunk).order("id").range(start, start + 999).execute().data)
            rows += page
            if len(page) < 1000:
                break
            start += 1000

    by_value: dict[str | None, list[str]] = {}
    for r in rows:
        want = event_vaccine_type(r.get("raw_data"))
        if (r.get("vaccine_type") or None) != want:
            by_value.setdefault(want, []).append(r["id"])
    n = sum(len(v) for v in by_value.values())
    print(f"events on vaccine records: {len(rows)}  event-type changes: {n}  "
          f"{dict((k, len(v)) for k, v in sorted(by_value.items(), key=lambda kv: -len(kv[1]))[:8])}")
    if not args.execute:
        return
    written = 0
    for value, ids in by_value.items():
        for i in range(0, len(ids), 100):
            db.table("shortage_events").update({"vaccine_type": value}).in_("id", ids[i:i + 100]).execute()
            written += len(ids[i:i + 100])
    print(f"events written:     {written}")


if __name__ == "__main__":
    main()
