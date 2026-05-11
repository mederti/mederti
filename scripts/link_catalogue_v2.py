#!/usr/bin/env python3
"""
Linker v2 — Cross-border drug_catalogue → drugs matcher
========================================================
Improvements over the v1 linker:

  • Synonym-aware: paracetamol↔acetaminophen, salbutamol↔albuterol,
    etc. resolved through drug_synonyms (seeded from CURATED_SYNONYMS
    if the table is empty).
  • Composite-key normalisation: parses strength ("500mg" / "0.5 g" /
    "100 mcg/ml") into (value, unit) and dosage form ("Tablet,
    film-coated" / "tab" / "TAB FC") into a canonical word.
  • Better salt-stripping (also handles "calcium 600 mg" suffix style).
  • Better brand-prefix stripping for HC DPD names.
  • Persists the normalised values to drug_catalogue so future joins
    can use indexed composite-key matching.

Usage:
  python scripts/link_catalogue_v2.py --dry-run
  python scripts/link_catalogue_v2.py
  python scripts/link_catalogue_v2.py --refresh   # also re-process linked rows

Prerequisites:
  - Migration 026 applied (drug_synonyms table + normalised columns)
"""
from __future__ import annotations

import os
import re
import sys
import logging
from collections import defaultdict
from typing import Optional

from supabase import create_client


SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DRY_RUN = "--dry-run" in sys.argv
REFRESH = "--refresh" in sys.argv

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


# ─── 1. Curated INN synonyms (the high-value cross-border ones) ──────────────
# Format: canonical name → list of synonyms used in other markets.
# Add to this list as new false-negatives surface in the cohort dashboard.
CURATED_SYNONYMS: dict[str, list[str]] = {
    # Analgesics / antipyretics
    "paracetamol":      ["acetaminophen", "apap", "n-acetyl-p-aminophenol"],
    "metamizole":       ["dipyrone", "metamizol", "novaminsulfon"],
    # Respiratory
    "salbutamol":       ["albuterol", "salbutamol sulfate", "albuterol sulfate"],
    "ipratropium bromide": ["ipratropium"],
    "beclometasone":    ["beclomethasone", "beclomethasone dipropionate"],
    # Cardiovascular
    "amlodipine":       ["amlodipine besylate", "amlodipine besilate", "amlodipine maleate"],
    "atenolol":         ["atenolol"],
    "atorvastatin":     ["atorvastatin calcium"],
    "simvastatin":      ["simvastatin"],
    "rosuvastatin":     ["rosuvastatin calcium"],
    "lisinopril":       ["lisinopril dihydrate"],
    "losartan":         ["losartan potassium"],
    "valsartan":        ["valsartan"],
    "ramipril":         ["ramipril"],
    "metoprolol":       ["metoprolol tartrate", "metoprolol succinate"],
    "warfarin":         ["warfarin sodium"],
    "clopidogrel":      ["clopidogrel bisulfate", "clopidogrel hydrogen sulfate"],
    # Diabetes
    "metformin":        ["metformin hydrochloride", "metformin hcl"],
    "gliclazide":       ["gliclazide"],
    "sitagliptin":      ["sitagliptin phosphate"],
    "insulin glargine": ["glargine"],
    # GI
    "omeprazole":       ["omeprazole magnesium", "omeprazole sodium"],
    "esomeprazole":     ["esomeprazole magnesium", "esomeprazole sodium"],
    "lansoprazole":     ["lansoprazole"],
    "pantoprazole":     ["pantoprazole sodium"],
    "ranitidine":       ["ranitidine hydrochloride", "ranitidine hcl"],
    "ondansetron":      ["ondansetron hydrochloride", "ondansetron hcl"],
    "metoclopramide":   ["metoclopramide hydrochloride", "metoclopramide hcl"],
    # CNS / mental health
    "diazepam":         ["diazepam"],
    "lorazepam":        ["lorazepam"],
    "fluoxetine":       ["fluoxetine hydrochloride", "fluoxetine hcl"],
    "sertraline":       ["sertraline hydrochloride", "sertraline hcl"],
    "citalopram":       ["citalopram hydrobromide", "citalopram hbr"],
    "escitalopram":     ["escitalopram oxalate"],
    "olanzapine":       ["olanzapine"],
    "risperidone":      ["risperidone"],
    "quetiapine":       ["quetiapine fumarate"],
    "haloperidol":      ["haloperidol decanoate", "haloperidol lactate"],
    "lamotrigine":      ["lamotrigine"],
    "lacosamide":       ["lacosamide"],
    "levetiracetam":    ["levetiracetam"],
    "carbamazepine":    ["carbamazepine"],
    "phenytoin":        ["phenytoin sodium"],
    "valproic acid":    ["sodium valproate", "valproate sodium", "valproate semisodium"],
    "morphine":         ["morphine sulfate", "morphine hydrochloride", "morphine sulphate"],
    "oxycodone":        ["oxycodone hydrochloride", "oxycodone hcl"],
    "fentanyl":         ["fentanyl citrate"],
    "tramadol":         ["tramadol hydrochloride", "tramadol hcl"],
    # Anti-infectives
    "amoxicillin":      ["amoxicillin trihydrate", "amoxicillin sodium"],
    "amoxicillin and clavulanic acid": ["amoxicillin/clavulanate", "co-amoxiclav", "amoxicillin clavulanate"],
    "azithromycin":     ["azithromycin dihydrate", "azithromycin monohydrate"],
    "ciprofloxacin":    ["ciprofloxacin hydrochloride", "ciprofloxacin hcl", "ciprofloxacin lactate"],
    "doxycycline":      ["doxycycline hyclate", "doxycycline monohydrate"],
    "vancomycin":       ["vancomycin hydrochloride", "vancomycin hcl"],
    "ceftriaxone":      ["ceftriaxone sodium"],
    "cefalexin":        ["cephalexin", "cephalexin monohydrate", "cefalexin monohydrate"],
    "metronidazole":    ["metronidazole benzoate"],
    "fluconazole":      ["fluconazole"],
    "aciclovir":        ["acyclovir"],
    # Oncology
    "cisplatin":        ["cisplatin"],
    "carboplatin":      ["carboplatin"],
    "doxorubicin":      ["doxorubicin hydrochloride", "doxorubicin hcl"],
    "5-fluorouracil":   ["fluorouracil", "5-fu"],
    "methotrexate":     ["methotrexate sodium"],
    "tamoxifen":        ["tamoxifen citrate"],
    "imatinib":         ["imatinib mesylate", "imatinib mesilate"],
    "rituximab":        ["rituximab"],
    "trastuzumab":      ["trastuzumab"],
    "pemetrexed":       ["pemetrexed disodium", "pemetrexed sodium"],
    # Hormones / endo
    "levothyroxine":    ["levothyroxine sodium", "l-thyroxine"],
    "hydrocortisone":   ["hydrocortisone sodium succinate", "hydrocortisone acetate"],
    "dexamethasone":    ["dexamethasone sodium phosphate", "dexamethasone acetate"],
    "prednisolone":     ["prednisolone sodium phosphate", "prednisolone acetate"],
    "prednisone":       ["prednisone"],
    "estradiol":        ["oestradiol", "estradiol valerate", "estradiol hemihydrate"],
    "progesterone":     ["progesterone"],
    # Anaesthesia
    "propofol":         ["propofol"],
    "ketamine":         ["ketamine hydrochloride", "ketamine hcl"],
    "lidocaine":        ["lignocaine", "lidocaine hydrochloride", "lignocaine hydrochloride"],
    "bupivacaine":      ["bupivacaine hydrochloride", "bupivacaine hcl"],
    "midazolam":        ["midazolam hydrochloride", "midazolam hcl", "midazolam maleate"],
    "rocuronium":       ["rocuronium bromide"],
    "atracurium":       ["atracurium besilate", "atracurium besylate"],
    # Vitamins / minerals
    "ergocalciferol":   ["vitamin d2", "vitamin d 2"],
    "colecalciferol":   ["cholecalciferol", "vitamin d3", "vitamin d 3"],
    "cyanocobalamin":   ["vitamin b12", "vitamin b 12"],
    "thiamine":         ["vitamin b1", "thiamine hydrochloride", "thiamine hcl"],
    "folic acid":       ["folate", "vitamin b9"],
    "ferrous sulfate":  ["ferrous sulphate", "iron sulfate", "iron sulphate"],
    # Other
    "naloxone":         ["naloxone hydrochloride", "naloxone hcl"],
    "epinephrine":      ["adrenaline", "adrenalin"],
    "norepinephrine":   ["noradrenaline"],
    "salmeterol":       ["salmeterol xinafoate"],
    "budesonide":       ["budesonide"],
    "tiotropium":       ["tiotropium bromide"],
}


# ─── 2. Stripping dictionaries ──────────────────────────────────────────────
SALT_SUFFIXES = [
    "hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium",
    "sulfate", "sulphate", "phosphate", "acetate", "citrate", "tartrate",
    "maleate", "fumarate", "succinate", "gluconate", "chloride", "bromide",
    "iodide", "nitrate", "carbonate", "bicarbonate", "oxide", "hydroxide",
    "mesylate", "mesilate", "tosylate", "besylate", "besilate", "esylate",
    "malate", "lactate",
    "decanoate", "enanthate", "valerate", "palmitate", "stearate", "propionate",
    "monohydrate", "dihydrate", "trihydrate", "hemihydrate", "anhydrous",
    "hydrate", "trihydrate",
    "monosodium", "disodium", "trisodium", "dipotassium",
    "tromethamine", "meglumine", "pamoate",
    "hydrobromide", "hbr",
    "hyclate", "xinafoate",
    "bisulfate", "hydrogen sulfate",
]

HC_BRAND_PREFIXES = [
    "apo", "ratio", "mylan", "sandoz", "teva", "pms", "novo", "gen",
    "dom", "jamp", "mint", "pro", "ran", "riva", "zym", "bio", "nat",
    "mar", "act", "auro", "sivem", "sanis", "atlas", "pharmel",
    "medicament", "medisca", "nu", "co", "gd", "med", "ntp", "van",
    "ach", "ag",
]

# Form synonyms — many variants → one canonical word
FORM_MAP: dict[str, str] = {}
for canon, variants in {
    "tablet":     ["tab", "tablet", "tablets", "tabs", "tabfc", "tabec",
                   "tabuc", "film-coated", "film coated", "fc tab", "ec tab",
                   "enteric coated", "compressed"],
    "capsule":    ["cap", "capsule", "capsules", "caps", "caphrd", "soft cap",
                   "hard cap", "softgel", "soft gelatin"],
    "injection":  ["inj", "injection", "injectable", "soln inj", "powder for inj",
                   "ampoule", "ampule", "amp", "vial"],
    "solution":   ["soln", "solution", "liquid", "liq"],
    "suspension": ["susp", "suspension", "oral suspension"],
    "cream":      ["cream", "creme"],
    "ointment":   ["ont", "ointment", "ointmnt"],
    "gel":        ["gel"],
    "patch":      ["patch", "transdermal patch", "transdermal system"],
    "syrup":      ["syr", "syrup"],
    "powder":     ["pwd", "powder"],
    "spray":      ["spray", "nasal spray"],
    "drops":      ["drops", "eye drops", "ear drops"],
    "suppository":["supp", "suppository", "suppositories"],
    "lotion":     ["lotion"],
    "inhaler":    ["inhaler", "inh", "metered dose inhaler", "mdi"],
    "infusion":   ["infusion", "iv infusion"],
    "lozenge":    ["lozenge", "lozenges"],
    "shampoo":    ["shampoo"],
}.items():
    for v in variants:
        FORM_MAP[v.lower()] = canon


# ─── 3. Helper functions ────────────────────────────────────────────────────
def normalise(s: str) -> str:
    return (s or "").strip().lower()


def strip_salts(name: str) -> str:
    """Remove trailing salt/ester/hydrate suffixes."""
    n = normalise(name)
    for _ in range(3):  # iterate to catch chained suffixes
        original = n
        for suffix in SALT_SUFFIXES:
            n = re.sub(r'\s+' + re.escape(suffix) + r'$', '', n).strip()
            n = re.sub(r'\s+' + re.escape(suffix) + r'\s', ' ', n).strip()
        if n == original:
            break
    return n


def strip_brand_prefix(name: str) -> str:
    n = normalise(name)
    for prefix in HC_BRAND_PREFIXES:
        if n.startswith(prefix + "-") or n.startswith(prefix + " "):
            return n[len(prefix):].lstrip("- ").strip()
    return n


def parse_strength(s: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    """
    Parse strings like '500mg', '500 mg', '0.5g', '100mcg/ml', '5 MG'
    into (value, canonical_unit).
    Returns (None, None) if it can't parse cleanly.
    """
    if not s:
        return None, None
    raw = s.strip().lower().replace(",", ".")

    # Match leading number + unit, ignore trailing complexity
    m = re.match(r'^([\d.]+)\s*(mcg|microgram|μg|ug|mg|g|kg|ml|l|iu|units?|%)\b', raw)
    if not m:
        return None, None
    try:
        value = float(m.group(1))
    except ValueError:
        return None, None

    unit = m.group(2)
    # Canonicalise units
    unit_map = {
        "mcg": "mg", "microgram": "mg", "μg": "mg", "ug": "mg",
        # All micrograms re-expressed as mg (1 mcg = 0.001 mg)
    }
    if unit in unit_map:
        value = value / 1000.0
        unit = unit_map[unit]
    elif unit == "g":
        value = value * 1000.0
        unit = "mg"
    elif unit == "kg":
        value = value * 1_000_000.0
        unit = "mg"
    elif unit == "l":
        value = value * 1000.0
        unit = "ml"
    elif unit in ("units", "unit"):
        unit = "iu"

    # Round to 6 decimals to avoid floating-point artefacts
    return round(value, 6), unit


def normalise_form(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    raw = s.strip().lower()
    # Try exact match
    if raw in FORM_MAP:
        return FORM_MAP[raw]
    # Try first word
    first = raw.split(",")[0].split()[0] if raw else ""
    if first in FORM_MAP:
        return FORM_MAP[first]
    # Try removing punctuation
    cleaned = re.sub(r"[^a-z\s]", "", raw).strip()
    if cleaned in FORM_MAP:
        return FORM_MAP[cleaned]
    cleaned_first = cleaned.split()[0] if cleaned else ""
    if cleaned_first in FORM_MAP:
        return FORM_MAP[cleaned_first]
    return None


# ─── 4. Drug index builder ──────────────────────────────────────────────────
def fetch_all(supabase, table: str, select: str, **filters):
    """Fetch all rows handling Supabase pagination."""
    all_rows = []
    offset = 0
    BATCH = 1000
    while True:
        q = supabase.table(table).select(select)
        for k, v in filters.items():
            if v is None:
                q = q.is_(k, "null")
            else:
                q = q.eq(k, v)
        res = q.range(offset, offset + BATCH - 1).execute()
        all_rows.extend(res.data)
        if len(res.data) < BATCH:
            break
        offset += BATCH
    return all_rows


def build_drug_index(supabase) -> tuple[dict[str, str], dict[str, str]]:
    """
    Returns (name_index, name_normalised_index) where:
      - name_index: lower-trimmed name -> drug_id
      - the index includes generic_name, salt-stripped, first word, brand_names,
        and any drug_synonyms entries.
    """
    drugs = fetch_all(supabase, "drugs", "id, generic_name, brand_names")
    log.info(f"  loaded {len(drugs)} drugs")

    # Pull existing synonyms
    synonyms = fetch_all(supabase, "drug_synonyms", "drug_id, synonym_normalised")
    log.info(f"  loaded {len(synonyms)} synonyms")

    idx: dict[str, str] = {}

    for d in drugs:
        gn = normalise(d.get("generic_name") or "")
        if not gn:
            continue
        did = d["id"]

        idx.setdefault(gn, did)
        stripped = strip_salts(gn)
        if stripped != gn:
            idx.setdefault(stripped, did)

        # First word (only if long enough — avoids "iron", "zinc" false positives)
        first = stripped.split()[0] if stripped else ""
        if len(first) > 5:
            idx.setdefault(first, did)

        # Brand names
        for b in (d.get("brand_names") or []):
            bl = normalise(b)
            if bl:
                idx.setdefault(bl, did)

    # Layer synonyms on top
    for s in synonyms:
        if s.get("synonym_normalised"):
            idx.setdefault(s["synonym_normalised"], s["drug_id"])

    return idx, {}


# ─── 5. Synonym seeding ─────────────────────────────────────────────────────
def seed_curated_synonyms(supabase, dry_run: bool) -> int:
    """
    For each curated canonical drug name, find the matching drugs.id and
    insert any new synonyms into drug_synonyms.
    """
    inserted = 0
    skipped_unknown = 0

    for canonical, syns in CURATED_SYNONYMS.items():
        canon_norm = canonical.lower().strip()
        # Find the drug
        r = supabase.table("drugs").select("id").ilike("generic_name", canon_norm).limit(1).execute()
        if not r.data:
            # Try strict equality on normalised name
            r2 = supabase.table("drugs").select("id, generic_name").ilike("generic_name", f"%{canon_norm}%").limit(5).execute()
            match = next((x for x in (r2.data or []) if normalise(x.get("generic_name")) == canon_norm), None)
            if not match:
                skipped_unknown += 1
                continue
            drug_id = match["id"]
        else:
            drug_id = r.data[0]["id"]

        for syn in syns:
            norm = syn.lower().strip()
            if norm == canon_norm:
                continue
            payload = {
                "drug_id": drug_id,
                "synonym": syn,
                "synonym_normalised": norm,
                "source": "curated",
            }
            if dry_run:
                inserted += 1
                continue
            try:
                # Use upsert against the unique index
                supabase.table("drug_synonyms").upsert(payload, on_conflict="drug_id,synonym_normalised").execute()
                inserted += 1
            except Exception as e:
                log.warning(f"  synonym insert failed for {canonical}/{syn}: {str(e)[:80]}")

    log.info(f"  seeded {inserted} curated synonyms ({skipped_unknown} canonical names not in drugs table)")
    return inserted


# ─── 6. Main linker logic ───────────────────────────────────────────────────
def candidate_names(name: str, source: str) -> list[str]:
    """Return a cascade of candidate names to try matching, most specific first."""
    if not name:
        return []
    cands: list[str] = []
    n = normalise(name)
    cands.append(n)

    stripped = strip_salts(n)
    if stripped != n:
        cands.append(stripped)

    if source and "HC DPD" in source:
        # Brand prefix strip
        no_prefix = strip_brand_prefix(n)
        if no_prefix != n:
            cands.append(no_prefix)
            cands.append(strip_salts(no_prefix))

    # First long word as last-ditch
    first = stripped.split()[0] if stripped else ""
    if len(first) > 5:
        cands.append(first)

    # Dedupe preserving order
    seen: set[str] = set()
    out = []
    for c in cands:
        if c and len(c) > 3 and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Step A — seed synonyms
    log.info("STEP A: Seeding curated INN synonyms…")
    seed_curated_synonyms(supabase, DRY_RUN)

    # Step B — build the drug index
    log.info("STEP B: Building drug index (incl. synonyms)…")
    idx, _ = build_drug_index(supabase)
    log.info(f"  drug index: {len(idx)} entries")

    # Step C — fetch catalogue rows to (re-)process
    log.info(f"STEP C: Fetching catalogue rows ({'all (refresh)' if REFRESH else 'unlinked only'})…")
    # Pull the full row. We re-send the fields the user didn't touch
    # back through the PostgREST upsert, which keeps every NOT NULL
    # column satisfied on the INSERT-fallback branch of the upsert.
    select_cols = "*"
    if REFRESH:
        catalogue = fetch_all(supabase, "drug_catalogue", select_cols)
    else:
        catalogue = fetch_all(supabase, "drug_catalogue", select_cols, drug_id=None)
    log.info(f"  {len(catalogue)} rows to process")

    # Step D — match + normalise
    log.info("STEP D: Matching + normalising…")
    updates: list[dict] = []
    stats: dict[str, int] = defaultdict(int)
    sample_unmatched: list[dict] = []

    for entry in catalogue:
        name = entry.get("generic_name") or ""
        brand = entry.get("brand_name") or ""
        source = entry.get("source_name") or ""

        cands = candidate_names(name, source)
        # Add brand candidates
        if brand:
            bl = normalise(brand)
            cands.append(bl)
            cands.append(strip_salts(bl))
            if "HC DPD" in source:
                cands.append(strip_brand_prefix(bl))

        drug_id = None
        for c in cands:
            if c in idx:
                drug_id = idx[c]
                break

        # Always normalise strength + form even if no drug match
        strength_value, strength_unit = parse_strength(entry.get("strength"))
        form_norm = normalise_form(entry.get("dosage_form"))
        gen_norm = strip_salts(normalise(name)) if name else None

        # Carry every column from the fetched row through the upsert
        # payload. PostgREST's upsert (used in STEP E) does
        # INSERT...ON CONFLICT DO UPDATE, so the INSERT branch needs
        # all NOT NULL columns. By echoing the whole row back, every
        # NOT NULL is satisfied. We then overlay the changed fields.
        # We drop server-managed columns that would create conflicts.
        DROP_COLS = {"search_vector", "created_at", "updated_at"}
        update_row: dict = {
            k: v for k, v in entry.items() if k not in DROP_COLS
        }
        changed = False

        # Linkage: only set if currently unlinked OR refresh mode
        if drug_id and (REFRESH or not entry.get("drug_id")):
            update_row["drug_id"] = drug_id
            changed = True
            stats["matched"] += 1
        elif not drug_id:
            stats["unmatched"] += 1
            if len(sample_unmatched) < 20:
                sample_unmatched.append({
                    "name": name, "brand": brand, "source": source,
                    "tried": cands[:4],
                })

        if strength_value is not None:
            update_row["strength_value"] = strength_value
            update_row["strength_unit"] = strength_unit
            changed = True
        if form_norm:
            update_row["form_normalised"] = form_norm
            changed = True
        if gen_norm:
            update_row["generic_normalised"] = gen_norm
            changed = True

        if changed:
            updates.append(update_row)

    log.info("")
    log.info("=== MATCH RESULTS ===")
    log.info(f"Catalogue rows processed: {len(catalogue)}")
    log.info(f"Newly matched:            {stats['matched']}")
    log.info(f"Still unmatched:          {stats['unmatched']}")
    if catalogue:
        match_pct = stats['matched'] * 100 / len(catalogue)
        log.info(f"Match rate this pass:     {match_pct:.1f}%")
    log.info("")
    log.info("Sample unmatched (first 20):")
    for u in sample_unmatched:
        log.info(f"  {u['source'][:12]:12} '{u['name'][:50]:50}' tried={u['tried'][:3]}")

    if DRY_RUN:
        log.info("")
        log.info("DRY RUN — no updates written.")
        return

    log.info("")
    log.info(f"STEP E: Writing {len(updates)} updates via batch upsert…")
    # Batch upserts: PostgREST accepts an array body on conflict=id.
    # ~100-1000x faster than per-row UPDATEs over HTTP.
    BATCH = 500
    written = 0
    failed = 0
    for i in range(0, len(updates), BATCH):
        chunk = updates[i:i + BATCH]
        try:
            supabase.table("drug_catalogue").upsert(chunk, on_conflict="id").execute()
            written += len(chunk)
        except Exception as e:
            # Fall back to row-by-row on chunk failure so one bad row
            # doesn't lose the rest of the batch.
            log.warning(f"  batch {i}-{i+len(chunk)} failed ({str(e)[:80]}) — falling back to per-row")
            for u in chunk:
                row_id = u.get("id")
                update_fields = {k: v for k, v in u.items() if k != "id"}
                try:
                    supabase.table("drug_catalogue").update(update_fields).eq("id", row_id).execute()
                    written += 1
                except Exception as e2:
                    failed += 1
                    if failed <= 5:
                        log.warning(f"    row {row_id} failed: {str(e2)[:80]}")
        if (i // BATCH) % 4 == 0 or i + BATCH >= len(updates):
            log.info(f"  {min(i + BATCH, len(updates))}/{len(updates)} (written={written}, failed={failed})")

    log.info(f"✅ Linker v2 complete. Wrote {written}, failed {failed}.")


if __name__ == "__main__":
    main()
