"""
RxNorm Backfill (Path A — 2/3)
──────────────────────────────
For every drug in Mederti's `drugs` table, resolve the canonical US
RxNorm identifier (RxCUI) and store it in the new `drug_rxnorm` table.

Why this matters
────────────────
RxNorm is the US National Library of Medicine's standardised nomenclature
for clinical drugs. RxCUIs are the de-facto universal IDs that US
hospitals, EHRs and drug-decision-support vendors all speak. Once linked:
  • Mederti can cross-walk between regulator-supplied generic names and
    the canonical clinical entity (resolving paracetamol↔acetaminophen,
    salbutamol↔albuterol, etc. without hand-curated synonyms).
  • Brand-name and ingredient lookups become free downstream queries.
  • We can compare our regulator-sourced ATC code with the RxNorm-derived
    ATC code — a built-in data-quality check.

Source
──────
NIH RxNav REST API (https://rxnav.nlm.nih.gov/REST). Free, no key.
Soft rate-limit ~10 req/s — our existing rxnorm_client wraps this.

Usage
─────
    python3 -m backend.importers.rxnorm_backfill              # full backfill
    python3 -m backend.importers.rxnorm_backfill --limit 200  # smoke test
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.rxnorm_backfill

Cadence
───────
One-shot for the initial backfill. Future re-runs are incremental —
only drugs without an existing drug_rxnorm row are processed.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

# Sibling imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client                       # noqa: E402
from backend.importers.rxnorm_client import (                          # noqa: E402
    get_rxcui,
    get_atc_code,
    get_related_ingredients,
)

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"

PAGE_SIZE = 1000   # how many drugs we pull per Supabase page


def fetch_drugs_missing_rxnorm(supabase: Any, limit: int | None = None) -> list[dict[str, Any]]:
    """
    Return drugs that do not yet have a drug_rxnorm row.

    Strategy: pull all (drug_id, generic_name) pairs, pull all known
    drug_rxnorm.drug_id values, return the set difference.
    """
    print("[RxNorm backfill] Loading drug list…", flush=True)
    drugs: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = (
            supabase.table("drugs")
            .select("id, generic_name, brand_names, atc_code")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data or []
        )
        drugs.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"[RxNorm backfill] {len(drugs)} drugs in catalogue", flush=True)

    done_offset = 0
    done_ids: set[str] = set()
    while True:
        page = (
            supabase.table("drug_rxnorm")
            .select("drug_id")
            .range(done_offset, done_offset + PAGE_SIZE - 1)
            .execute()
            .data or []
        )
        for row in page:
            done_ids.add(row["drug_id"])
        if len(page) < PAGE_SIZE:
            break
        done_offset += PAGE_SIZE

    pending = [d for d in drugs if d["id"] not in done_ids]
    print(f"[RxNorm backfill] {len(pending)} drugs need RxNorm linking "
          f"({len(done_ids)} already done)", flush=True)

    if limit:
        pending = pending[:limit]
        print(f"[RxNorm backfill] --limit {limit} → processing {len(pending)}", flush=True)
    return pending


def resolve_drug(drug: dict[str, Any]) -> dict[str, Any] | None:
    """
    Resolve a Mederti drug → RxNorm record.

    Tries the generic name first; if that fails, tries each brand name
    until one resolves to an RxCUI. Returns None if nothing matches.
    """
    candidates: list[str] = []
    if drug.get("generic_name"):
        candidates.append(str(drug["generic_name"]).strip())
    for b in (drug.get("brand_names") or []):
        if isinstance(b, str) and b.strip():
            candidates.append(b.strip())

    for name in candidates:
        try:
            rxcui = get_rxcui(name)
        except Exception as e:
            print(f"  ! get_rxcui failed for {name!r}: {e}", flush=True)
            continue
        if not rxcui:
            continue

        # Found a match — gather supplementary fields. Errors here are
        # non-fatal; an RxCUI alone is still valuable.
        atc_from_rxnorm: str | None = None
        ingredient_rxcuis: list[str] = []
        try:
            atc_from_rxnorm = get_atc_code(rxcui)
        except Exception:
            pass
        try:
            ing = get_related_ingredients(rxcui)
            ingredient_rxcuis = [str(x) for x in ing] if ing else []
        except Exception:
            pass

        return {
            "drug_id": drug["id"],
            "rxcui": rxcui,
            "rxnorm_name": name,
            "ingredient_rxcuis": ingredient_rxcuis,
            "atc_from_rxnorm": atc_from_rxnorm,
        }

    return None


def upsert_batch(supabase: Any, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    if DRY_RUN:
        print(f"  [DRY RUN] would upsert {len(rows)} rxnorm rows; first: {rows[0]}", flush=True)
        return len(rows)
    res = supabase.table("drug_rxnorm").upsert(rows, on_conflict="drug_id,rxcui").execute()
    return len(res.data or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="Only process N drugs (smoke testing)")
    ap.add_argument("--flush-every", type=int, default=100, help="Upsert in batches of this size")
    args = ap.parse_args()

    supabase = get_supabase_client()
    pending = fetch_drugs_missing_rxnorm(supabase, limit=args.limit)

    if not pending:
        print("[RxNorm backfill] Nothing to do ✓", flush=True)
        return 0

    matched = 0
    unresolved = 0
    buffer: list[dict[str, Any]] = []

    for i, drug in enumerate(pending, start=1):
        rec = resolve_drug(drug)
        if rec is None:
            unresolved += 1
        else:
            matched += 1
            buffer.append(rec)
            if len(buffer) >= args.flush_every:
                upsert_batch(supabase, buffer)
                buffer.clear()

        if i % 25 == 0:
            print(f"  …{i}/{len(pending)}  matched={matched}  unresolved={unresolved}", flush=True)

    if buffer:
        upsert_batch(supabase, buffer)

    print(f"[RxNorm backfill] Done ✓  matched={matched}  unresolved={unresolved}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
