"""
Drug Therapeutic Alternatives Importer
=======================================
Populates the drug_alternatives table using two complementary sources:

  1. ATC-code hierarchy matching (within our drugs table)
       - Level 5 match (same drug)           → therapeutic_equivalent      score=0.95 evidence=B
       - Level 4 match (pharmacol. subgroup)  → pharmacological_alternative score=0.80 evidence=C
       - Level 3 match (therapeutic subgroup) → therapeutic_class_alt       score=0.65 evidence=D
       - Level 2 match (pharmacol. main grp)  → therapeutic_class_alt       score=0.50 evidence=D

  2. RxNorm ATC enrichment
       For top-200 drugs lacking an ATC code: look up via RxNorm, update drugs
       table, then include in ATC matching above.

All pairs are inserted bidirectionally (A→B and B→A).
Records are marked is_approved=True with verified_by='rxnorm_atc_import'.

Run:
    python3 -m backend.importers.alternatives_importer
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.alternatives_importer

Requires migration 006 to be applied in Supabase first (adds similarity_score
etc. columns).  The script will abort with a clear message if it hasn't been.
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
from typing import Optional

from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger
from backend.importers import rxnorm_client as rxnorm

log = get_logger("mederti.importer.alternatives")

DRY_RUN: bool = os.getenv("MEDERTI_DRY_RUN", "0") == "1"

# ── ATC level metadata ────────────────────────────────────────────────────────

# Maps ATC match level → (relationship_type, evidence, similarity_score)
_ATC_META: dict[int, tuple[str, str, float]] = {
    5: ("therapeutic_equivalent",      "B", 0.95),
    4: ("pharmacological_alternative", "C", 0.80),
    3: ("therapeutic_class_alternative", "D", 0.65),
    2: ("therapeutic_class_alternative", "D", 0.50),
}

# ATC prefix lengths by level  (J01CA04 → level 5 = full 7 chars)
_ATC_CUT = {1: 1, 2: 3, 3: 4, 4: 5, 5: 7}

# ATC prefixes that indicate a biologic (override rel_type → biosimilar)
_BIOLOGIC_PREFIXES = ("L01F", "L04A", "L04B", "B03X", "B06A")


def _atc_prefix(code: str, level: int) -> str:
    return code[: _ATC_CUT.get(level, 7)]


def _is_biologic(atc_code: str) -> bool:
    return any(atc_code.startswith(p) for p in _BIOLOGIC_PREFIXES)


# ── Database helpers ──────────────────────────────────────────────────────────

def _check_migration(db) -> bool:
    """Verify migration 006 has been applied (similarity_score column exists)."""
    try:
        db.table("drug_alternatives").select("similarity_score").limit(1).execute()
        return True
    except Exception:
        return False


def get_top_drugs(db, limit: int = 200) -> list[dict]:
    """Return the top N drugs by active shortage event count."""
    log.info(f"Fetching top {limit} shortage-affected drugs …")

    # Paginate through all active/anticipated shortage_events
    batch, offset, all_rows = 1000, 0, []
    while True:
        r = (
            db.table("shortage_events")
            .select("drug_id")
            .in_("status", ["active", "anticipated"])
            .range(offset, offset + batch - 1)
            .execute()
        )
        rows = r.data or []
        all_rows.extend(rows)
        if len(rows) < batch:
            break
        offset += batch

    counts = Counter(row["drug_id"] for row in all_rows)
    top_ids = [did for did, _ in counts.most_common(limit)]

    if not top_ids:
        log.warning("No active shortage events found")
        return []

    # Fetch drug details in chunks of 100
    drugs: list[dict] = []
    for i in range(0, len(top_ids), 100):
        chunk = top_ids[i : i + 100]
        r = (
            db.table("drugs")
            .select("id,generic_name,generic_name_normalised,atc_code,drug_class,therapeutic_category")
            .in_("id", chunk)
            .execute()
        )
        drugs.extend(r.data or [])

    # Re-sort by shortage count
    order = {did: i for i, did in enumerate(top_ids)}
    drugs.sort(key=lambda d: order.get(d["id"], 9999))

    with_atc = sum(1 for d in drugs if d.get("atc_code"))
    log.info(f"  {len(drugs)} drugs fetched, {with_atc} already have ATC codes")
    return drugs


def get_all_drugs_with_atc(db) -> list[dict]:
    """Fetch every drug in the DB that has a non-null ATC code."""
    batch, offset, result = 1000, 0, []
    while True:
        r = (
            db.table("drugs")
            .select("id,generic_name,generic_name_normalised,atc_code,drug_class")
            .not_.is_("atc_code", "null")
            .range(offset, offset + batch - 1)
            .execute()
        )
        rows = r.data or []
        result.extend(rows)
        if len(rows) < batch:
            break
        offset += batch
    log.info(f"  {len(result)} drugs with ATC codes in DB")
    return result


def build_atc_index(drugs: list[dict]) -> dict[str, list[dict]]:
    """
    Build a prefix → [drug, …] index covering ATC levels 2–5.
    Used for O(1) lookup of all drugs sharing an ATC prefix.
    """
    index: dict[str, list[dict]] = defaultdict(list)
    for drug in drugs:
        code = drug.get("atc_code") or ""
        if not code:
            continue
        for level in (2, 3, 4, 5):
            prefix = _atc_prefix(code, level)
            if prefix:
                index[prefix].append(drug)
    return index


# ── RxNorm enrichment ─────────────────────────────────────────────────────────

def enrich_atc_from_rxnorm(db, drug: dict) -> Optional[str]:
    """
    For a drug without an ATC code: look it up via RxNorm, write the code back
    to the drugs table, and return it.  Returns None if lookup fails.
    """
    name = (drug.get("generic_name_normalised") or drug.get("generic_name") or "").strip()
    if not name:
        return None

    rxcui = rxnorm.get_rxcui(name)
    if not rxcui:
        return None

    atc = rxnorm.get_atc_code(rxcui)
    if not atc:
        return None

    log.debug(f"  RxNorm → {name!r}: ATC={atc} rxcui={rxcui}")
    if not DRY_RUN:
        db.table("drugs").update({"atc_code": atc}).eq("id", drug["id"]).execute()

    return atc


# ── ATC-based alternative matching ───────────────────────────────────────────

def find_atc_alternatives(drug: dict, atc_index: dict[str, list[dict]]) -> list[dict]:
    """
    Find alternatives for `drug` by walking down the ATC hierarchy.
    For each alternative found, keep the *most specific* (highest level) match.
    Returns list of record dicts ready for insertion into drug_alternatives.
    """
    atc = (drug.get("atc_code") or "").strip()
    if not atc:
        return []

    # best_level[alt_id] = highest ATC level at which this drug matched
    best_level: dict[str, int] = {}

    for level in (5, 4, 3, 2):
        prefix = _atc_prefix(atc, level)
        if not prefix:
            continue
        for alt in atc_index.get(prefix, []):
            if alt["id"] == drug["id"]:
                continue
            # Keep highest (most specific) level
            if alt["id"] not in best_level or level > best_level[alt["id"]]:
                best_level[alt["id"]] = level

    records: list[dict] = []
    for alt_id, level in best_level.items():
        rel_type, evidence, score = _ATC_META[level]

        # Override: biologics at level 4 are biosimilars, not just pharmacological alts
        if _is_biologic(atc) and level == 4:
            rel_type = "biosimilar"
            evidence = "A"
            score = 0.90

        alt_drug = next((d for d in atc_index.get(_atc_prefix(atc, level), []) if d["id"] == alt_id), None)
        alt_name = (alt_drug or {}).get("generic_name", "")

        records.append({
            "drug_id":               drug["id"],
            "alternative_drug_id":   alt_id,
            "relationship_type":     rel_type,
            "clinical_evidence_level": evidence,
            "similarity_score":      score,
            "atc_match_level":       level,
            "source":                "atc",
            "dose_conversion_notes": _dose_note(drug["generic_name"], alt_name, level),
            "is_approved":           True,
            "verified_by":           "rxnorm_atc_import",
        })

    return records


def _dose_note(drug_name: str, alt_name: str, atc_level: int) -> Optional[str]:
    """Generate a brief clinical guidance note based on ATC match level."""
    if atc_level == 5:
        return "Same pharmacological agent — dose conversion is 1:1."
    if atc_level == 4:
        return (
            f"Pharmacological alternative to {drug_name}. "
            "Verify equivalent dose with prescriber or clinical pharmacist before switching."
        )
    return (
        f"Therapeutic class alternative to {drug_name}. "
        "Dosing is not interchangeable — clinical reassessment and prescriber review required."
    )


# ── Availability notes ────────────────────────────────────────────────────────

def get_availability_note(db, drug_id: str) -> Optional[str]:
    """
    Check whether the alternative drug itself is currently in shortage.
    Returns a warning string, or None if no active shortages.
    """
    r = (
        db.table("shortage_events")
        .select("country_code,severity")
        .eq("drug_id", drug_id)
        .in_("status", ["active", "anticipated"])
        .limit(5)
        .execute()
    )
    rows = r.data or []
    if not rows:
        return None
    parts = ", ".join(
        f"{row['country_code']}({row.get('severity') or 'unknown'})" for row in rows
    )
    return f"⚠ Alternative also in shortage: {parts}"


# ── Insert ────────────────────────────────────────────────────────────────────

def upsert_alternatives(db, pairs: list[dict]) -> tuple[int, int]:
    """
    Batch-upsert records into drug_alternatives.
    On conflict (drug_id, alternative_drug_id), update mutable fields.
    Returns (inserted_count, error_count).
    """
    inserted = errors = 0

    for i in range(0, len(pairs), 100):
        batch = pairs[i : i + 100]

        if DRY_RUN:
            for p in batch:
                log.info(
                    f"  [DRY] {p['drug_id'][:8]}… → {p['alternative_drug_id'][:8]}… "
                    f"[{p['relationship_type']}] score={p.get('similarity_score'):.2f} "
                    f"atc_level={p.get('atc_match_level')}"
                )
            inserted += len(batch)
            continue

        try:
            db.table("drug_alternatives").upsert(
                batch,
                on_conflict="drug_id,alternative_drug_id",
            ).execute()
            inserted += len(batch)
        except Exception as e:
            log.warning(f"Batch upsert error (records {i}–{i+len(batch)}): {e}")
            errors += len(batch)

    return inserted, errors


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    db = get_supabase_client()

    log.info("=" * 60)
    log.info("Drug Alternatives Importer")
    if DRY_RUN:
        log.info("DRY RUN — no DB writes")
    log.info("=" * 60)

    # 0. Verify migration 006 has been applied
    if not _check_migration(db):
        log.error(
            "Migration 006 has not been applied. "
            "Run supabase/migrations/006_drug_alternatives_columns.sql "
            "in the Supabase SQL Editor first."
        )
        sys.exit(1)

    # 1. Get top 200 shortage-affected drugs
    top_drugs = get_top_drugs(db, limit=200)
    if not top_drugs:
        log.error("No shortage-affected drugs found — aborting")
        sys.exit(1)

    # 2. Load all drugs with ATC codes (the within-DB matching pool)
    all_atc_drugs = get_all_drugs_with_atc(db)
    atc_index = build_atc_index(all_atc_drugs)
    log.info(f"ATC index: {len(atc_index)} prefixes across {len(all_atc_drugs)} drugs")

    # 3. Enrich top-200 drugs that lack ATC codes via RxNorm
    need_enrichment = [d for d in top_drugs if not d.get("atc_code")]
    log.info(f"RxNorm ATC enrichment: {len(need_enrichment)} drugs to look up …")

    enriched = 0
    for drug in need_enrichment:
        atc = enrich_atc_from_rxnorm(db, drug)
        if atc:
            drug["atc_code"] = atc
            enriched += 1
            # Add newly-enriched drug to the index
            for level in (2, 3, 4, 5):
                prefix = _atc_prefix(atc, level)
                if prefix:
                    atc_index[prefix].append(drug)

    log.info(f"  Enriched {enriched}/{len(need_enrichment)} drugs with ATC codes from RxNorm")

    # 4. Generate ATC-based alternative pairs for all top-200 drugs
    all_pairs: list[dict] = []
    drugs_with_alternatives = 0

    for drug in top_drugs:
        pairs = find_atc_alternatives(drug, atc_index)
        if not pairs:
            continue
        drugs_with_alternatives += 1

        # Annotate alternatives that are themselves in shortage
        for p in pairs:
            note = get_availability_note(db, p["alternative_drug_id"])
            if note:
                p["availability_note"] = note
                p["requires_monitoring"] = True
                p["monitoring_notes"] = note

        all_pairs.extend(pairs)

    log.info(
        f"ATC matching: {drugs_with_alternatives}/{len(top_drugs)} drugs have alternatives, "
        f"{len(all_pairs)} forward pairs"
    )

    # 5. Add reverse direction (B→A for every A→B)
    reverse_pairs: list[dict] = []
    for p in all_pairs:
        reverse_pairs.append({
            **p,
            "drug_id":             p["alternative_drug_id"],
            "alternative_drug_id": p["drug_id"],
        })

    all_pairs.extend(reverse_pairs)

    # 6. Deduplicate: for each (drug_id, alternative_drug_id) keep highest atc_match_level
    best: dict[tuple[str, str], dict] = {}
    for p in all_pairs:
        key = (p["drug_id"], p["alternative_drug_id"])
        existing = best.get(key)
        if not existing or (p.get("atc_match_level") or 0) > (existing.get("atc_match_level") or 0):
            best[key] = p

    final_pairs = list(best.values())
    log.info(f"Final pairs after dedup (bidirectional): {len(final_pairs)}")

    # 7. Insert
    inserted, errors = upsert_alternatives(db, final_pairs)
    log.info(
        f"Done — inserted/updated: {inserted}, errors: {errors}"
    )

    if not DRY_RUN and inserted > 0:
        # Quick summary
        r = db.table("drug_alternatives").select("relationship_type", count="exact").execute()
        log.info(f"drug_alternatives total rows now: {r.count}")


if __name__ == "__main__":
    main()
