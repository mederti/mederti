#!/usr/bin/env python3
"""
Link drug_catalogue entries to drugs table using fuzzy name matching.

Handles:
- FDA NDC: "Tizanidine Hydrochloride" → strip salt → "Tizanidine"
- HC DPD: "APO SULFAMETHOXAZOLE TAB 500MG" → strip brand/form/strength → "Sulfamethoxazole"

Usage:
    python scripts/link_catalogue_to_drugs.py --dry-run
    python scripts/link_catalogue_to_drugs.py
"""
from __future__ import annotations

import os
import re
import sys
import logging
from collections import defaultdict

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DRY_RUN = "--dry-run" in sys.argv

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Salt/ester suffixes to strip (FDA NDC pattern) ──────────────
SALT_SUFFIXES = [
    "hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium",
    "sulfate", "sulphate", "phosphate", "acetate", "citrate", "tartrate",
    "maleate", "fumarate", "succinate", "gluconate", "chloride", "bromide",
    "iodide", "nitrate", "carbonate", "bicarbonate", "oxide", "hydroxide",
    "mesylate", "mesilate", "tosylate", "besylate", "besilate", "esylate",
    "malate", "lactate",
    "decanoate", "enanthate", "valerate", "palmitate", "stearate", "propionate",
    "monohydrate", "dihydrate", "trihydrate", "hemihydrate", "anhydrous",
    "hydrate",
    "monosodium", "disodium", "trisodium", "dipotassium",
    "tromethamine", "meglumine", "pamoate",
]

# ── HC brand prefixes to strip ──────────────────────────────────
HC_BRAND_PREFIXES = [
    "apo", "ratio", "mylan", "sandoz", "teva", "pms", "novo", "gen",
    "dom", "jamp", "mint", "pro", "ran", "riva", "zym", "bio", "nat",
    "mar", "act", "auro", "sivem", "sanis", "atlas", "pharmel",
    "medicament", "medisca", "nu", "co", "gd", "med", "ntp", "van",
    "ach", "ag",
]

# ── Dosage form keywords to strip ───────────────────────────────
FORM_KEYWORDS = {
    "tab", "tablet", "tablets", "cap", "capsule", "capsules", "inj",
    "injection", "solution", "suspension", "cream", "ointment", "gel",
    "patch", "syrup", "liquid", "powder", "spray", "drops", "supp",
    "suppository", "lotion", "film", "sr", "er", "xr", "ir", "dr",
    "oral", "topical", "swab", "swabs", "vial", "vials", "amp",
    "ampoule", "inhaler", "inhalation", "syr", "soln", "susp", "liq",
    "pwd", "ect", "ont",
}


def strip_salt(name: str) -> str:
    """Strip salt/ester suffixes from FDA NDC generic names."""
    name = name.lower().strip()
    changed = True
    while changed:
        changed = False
        for suffix in SALT_SUFFIXES:
            pattern = r'\s+' + re.escape(suffix) + r'$'
            new_name = re.sub(pattern, '', name).strip()
            if new_name != name:
                name = new_name
                changed = True
    return name


def extract_hc_ingredient(name: str) -> str:
    """Extract active ingredient from HC DPD product names."""
    name = name.lower().strip()

    # Strip brand prefix (APO-METFORMIN → metformin)
    for prefix in HC_BRAND_PREFIXES:
        if name.startswith(prefix + "-") or name.startswith(prefix + " "):
            name = name[len(prefix):].strip().lstrip("-").strip()
            break

    # Strip dosage form and strength from end
    parts = name.split()
    clean_parts = []
    for part in parts:
        if part in FORM_KEYWORDS:
            break
        if re.match(r'^\d+(\.\d+)?(mg|mcg|ml|g|iu|%|mg/ml|mcg/ml)?$', part):
            break
        # Skip percentage patterns
        if re.match(r'^\d+(\.\d+)?%$', part):
            break
        clean_parts.append(part)

    result = " ".join(clean_parts).strip()
    return result if result else name


def normalise_name(name: str, source: str) -> list[str]:
    """
    Return a list of candidate names to try matching, most specific first.
    """
    if not name:
        return []

    candidates = []
    clean = name.lower().strip()

    if "HC DPD" in source:
        extracted = extract_hc_ingredient(clean)
        candidates.append(extracted)
        # Also try salt-stripped version
        stripped = strip_salt(extracted)
        if stripped != extracted:
            candidates.append(stripped)
        # First word as fallback
        first = extracted.split()[0] if extracted else ""
        if first:
            candidates.append(first)
    else:
        # FDA NDC and others
        candidates.append(clean)
        stripped = strip_salt(clean)
        if stripped != clean:
            candidates.append(stripped)
        # First word as fallback
        first = stripped.split()[0] if stripped else clean.split()[0]
        if first:
            candidates.append(first)

    # Deduplicate while preserving order, skip short names
    seen: set[str] = set()
    result: list[str] = []
    for c in candidates:
        if c and len(c) > 3 and c not in seen:
            seen.add(c)
            result.append(c)
    return result


def fetch_all(supabase, table, select, **filters):
    """Fetch all rows handling Supabase pagination (1000 row limit)."""
    all_rows: list[dict] = []
    offset = 0
    batch_size = 1000
    while True:
        q = supabase.table(table).select(select)
        for k, v in filters.items():
            if v is None:
                q = q.is_(k, "null")
            else:
                q = q.eq(k, v)
        result = q.range(offset, offset + batch_size - 1).execute()
        all_rows.extend(result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size
    return all_rows


def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # ── Fetch drugs and build index ──────────────────────────────
    log.info("Fetching drugs table...")
    all_drugs = fetch_all(supabase, "drugs", "id, generic_name, brand_names")
    log.info(f"  {len(all_drugs)} drugs loaded")

    # Build lookup: lowered name → drug_id
    drug_index: dict[str, str] = {}
    for d in all_drugs:
        gn = (d.get("generic_name") or "").lower().strip()
        did = d["id"]
        if not gn:
            continue

        # Exact name
        drug_index.setdefault(gn, did)

        # Salt-stripped version
        stripped = strip_salt(gn)
        if stripped != gn:
            drug_index.setdefault(stripped, did)

        # First word (only if > 5 chars to avoid false positives like "iron")
        first = stripped.split()[0] if stripped else gn.split()[0]
        if len(first) > 5:
            drug_index.setdefault(first, did)

        # Brand names
        for b in (d.get("brand_names") or []):
            bl = b.lower().strip()
            if bl:
                drug_index.setdefault(bl, did)

    log.info(f"  Drug index: {len(drug_index)} entries")

    # ── Fetch unlinked catalogue entries ─────────────────────────
    log.info("Fetching unlinked catalogue entries...")
    unlinked = fetch_all(supabase, "drug_catalogue",
                         "id, generic_name, brand_name, source_name, source_country",
                         drug_id=None)
    log.info(f"  {len(unlinked)} unlinked entries")

    # ── Match ────────────────────────────────────────────────────
    matched: list[dict] = []
    stats: dict[str, int] = defaultdict(int)
    unmatched_sample: list[dict] = []

    for entry in unlinked:
        name = entry.get("generic_name") or ""
        brand = entry.get("brand_name") or ""
        source = entry.get("source_name") or ""

        # Get candidate names from generic_name
        candidates = normalise_name(name, source)

        # Also try brand_name as a candidate if present
        brand_candidates = []
        if brand:
            bl = brand.lower().strip()
            brand_candidates.append(bl)
            # For HC DPD, also extract from brand
            if "HC DPD" in source:
                extracted = extract_hc_ingredient(bl)
                if extracted and extracted != bl:
                    brand_candidates.append(extracted)

        drug_id = None
        matched_strategy = None

        # Try generic_name candidates first
        for i, candidate in enumerate(candidates):
            if candidate in drug_index:
                drug_id = drug_index[candidate]
                if i == 0:
                    matched_strategy = "exact" if "HC DPD" not in source else "hc_extract"
                elif i == 1:
                    matched_strategy = "salt_stripped" if "HC DPD" not in source else "hc_salt_stripped"
                else:
                    matched_strategy = "first_word" if "HC DPD" not in source else "hc_first_word"
                break

        # Try brand candidates
        if not drug_id:
            for bc in brand_candidates:
                if bc in drug_index:
                    drug_id = drug_index[bc]
                    matched_strategy = "brand"
                    break

        if drug_id:
            matched.append({"id": entry["id"], "drug_id": drug_id})
            stats[matched_strategy] += 1
        else:
            stats["unmatched"] += 1
            if len(unmatched_sample) < 20:
                unmatched_sample.append({
                    "name": name,
                    "brand": brand,
                    "source": source,
                    "tried": candidates + brand_candidates,
                })

    # ── Report ───────────────────────────────────────────────────
    total_matched = len(matched)
    pct = round(total_matched / len(unlinked) * 100, 1) if unlinked else 0

    log.info("")
    log.info("=== MATCH RESULTS ===")
    log.info(f"Total unlinked:  {len(unlinked)}")
    log.info(f"Total matched:   {total_matched} ({pct}%)")
    log.info(f"Still unmatched: {stats['unmatched']}")
    log.info("")
    log.info("By strategy:")
    for strat, count in sorted(stats.items(), key=lambda x: -x[1]):
        log.info(f"  {strat:20s}  {count:6d}")

    log.info("")
    log.info("Sample unmatched (first 20):")
    for u in unmatched_sample:
        log.info(f"  {u['source']:10s}  '{u['name'][:50]}'  brand='{u['brand'][:30]}'  tried={u['tried'][:3]}")

    if DRY_RUN:
        log.info("")
        log.info("DRY RUN — no updates written.")
        return

    # ── Apply updates ────────────────────────────────────────────
    log.info("")
    log.info(f"Applying {len(matched)} updates...")
    BATCH = 200
    for i in range(0, len(matched), BATCH):
        chunk = matched[i:i + BATCH]
        for u in chunk:
            supabase.table("drug_catalogue") \
                .update({"drug_id": u["drug_id"]}) \
                .eq("id", u["id"]) \
                .execute()
        done = min(i + BATCH, len(matched))
        if (i // BATCH) % 10 == 0 or done == len(matched):
            log.info(f"  {done}/{len(matched)}")

    log.info("Complete.")


if __name__ == "__main__":
    main()
