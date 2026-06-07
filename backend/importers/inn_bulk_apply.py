"""
Write step for the offline INN resolver — applies auto-resolved molecule identity
to ``drugs`` and rolls variants up to a single canonical head per UNII.

Separated from the resolver so the (risky, mutating) write path is small and
auditable. Every touched row's prior state is captured to a revert manifest
BEFORE any write, so the whole batch is reversible.

Writes, per auto-resolved row:
  resolved_inn, unii, rxcui (only if currently empty), inn_resolution_method,
  inn_resolution_confidence, canonical_drug_id (→ the head row for that UNII; the
  head itself gets canonical_drug_id = NULL).

Quarantine rows are flagged ``inn_resolution_method='non_drug:<reason>'`` with no
resolved_inn — so they stop counting as "unresolved drugs" without being given a
false molecule identity.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict


def _existing_heads(sb) -> dict[str, str]:
    """UNII -> id of an already-resolved canonical head row."""
    heads: dict[str, str] = {}
    off = 0
    while True:
        r = (sb.table("drugs").select("id,unii")
             .not_.is_("resolved_inn", "null").is_("canonical_drug_id", "null")
             .not_.is_("unii", "null").range(off, off + 999).execute())
        if not r.data:
            break
        for d in r.data:
            heads.setdefault(d["unii"], d["id"])
        off += 1000
    return heads


def _capture_before(sb, ids: list[str]) -> dict[str, dict]:
    before: dict[str, dict] = {}
    cols = ("id,resolved_inn,unii,rxcui,inn_resolution_method,"
            "inn_resolution_confidence,canonical_drug_id")
    for i in range(0, len(ids), 200):
        r = sb.table("drugs").select(cols).in_("id", ids[i:i + 200]).execute()
        for d in r.data:
            before[d["id"]] = d
    return before


def apply(sb, idx, auto: list[dict], quarantine: list[dict],
          manifest_path: str = "logs/inn_bulk_revert.json"):
    # 1. resolve a head row per UNII (reuse existing heads; else elect one).
    heads = _existing_heads(sb)
    by_unii: dict[str, list[dict]] = defaultdict(list)
    for r in auto:
        by_unii[r["unii"]].append(r)
    for unii, rows in by_unii.items():
        if unii not in heads:
            # elect the row whose name is closest to the clean INN as the head.
            rows.sort(key=lambda r: len(r["name"] or ""))
            heads[unii] = rows[0]["id"]

    # 2. capture prior state for every row we will touch (reversible).
    touched = [r["id"] for r in auto] + [q["id"] for q in quarantine]
    before = _capture_before(sb, touched)
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, "w") as fh:
        json.dump(before, fh, indent=1, default=str)
    print(f"revert manifest ({len(before)} rows) -> {manifest_path}")

    # 3. write resolved identity + canonical rollup.
    n = 0
    for r in auto:
        head = heads[r["unii"]]
        patch = {
            "resolved_inn": r["inn"],
            "unii": r["unii"],
            "inn_resolution_method": r["method"],
            "inn_resolution_confidence": r["confidence"],
            "canonical_drug_id": None if r["id"] == head else head,
        }
        # never clobber an existing rxcui; only fill when empty and known.
        if r.get("rxcui") and not (before.get(r["id"], {}).get("rxcui")):
            patch["rxcui"] = r["rxcui"]
        sb.table("drugs").eq("id", r["id"]).update(patch).execute()
        n += 1
        if n % 250 == 0:
            print(f"  …{n}/{len(auto)} resolved rows written", flush=True)

    # 4. flag quarantine rows (no resolved_inn — just a non-drug marker).
    for q in quarantine:
        sb.table("drugs").eq("id", q["id"]).update({
            "inn_resolution_method": f"non_drug:{q['reason']}",
            "inn_resolution_confidence": 0,
        }).execute()

    print(f"DONE: {len(auto)} resolved, {len(quarantine)} quarantined, "
          f"{len(by_unii)} molecules.")


def revert(sb, manifest_path: str = "logs/inn_bulk_revert.json"):
    with open(manifest_path) as fh:
        before = json.load(fh)
    cols = ["resolved_inn", "unii", "rxcui", "inn_resolution_method",
            "inn_resolution_confidence", "canonical_drug_id"]
    for i, (drug_id, row) in enumerate(before.items(), 1):
        sb.table("drugs").eq("id", drug_id).update({c: row.get(c) for c in cols}).execute()
        if i % 250 == 0:
            print(f"  …{i}/{len(before)} reverted", flush=True)
    print(f"reverted {len(before)} rows from {manifest_path}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.getcwd())
    from backend.utils.db import get_supabase_client
    if len(sys.argv) > 1 and sys.argv[1] == "revert":
        revert(get_supabase_client())
    else:
        print("Use via inn_bulk_resolver --execute, or 'revert' to undo.")
