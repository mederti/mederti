"""Cleanup polluted drug rows from the canonical `drugs` catalogue.

A drug row is considered polluted when:
  - therapeutic_category starts with "Auto-created by ... Recall ... scraper", AND
  - the generic_name matches a headline-shape signature (sentence fragments
    containing risk-of/labelling-for/safety-information/Health Canada/etc.)
    OR matches an HC canary pattern.

Cleanup steps for each polluted row:
  1. Null out drug_id on related recalls / shortage_events / user_watchlists.
  2. Delete row from drug_synonyms / drug_rxnorm / drug_alternatives /
     drug_pricing if referenced (best-effort; ignored if tables absent).
  3. Delete the drug row itself.

Usage:
  python3 -m backend.health.cleanup_polluted_drugs                # dry run
  python3 -m backend.health.cleanup_polluted_drugs --commit       # do it

Defaults to dry-run; nothing is mutated without --commit.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from backend.health.detectors import (
    _HC_CANARY_PATTERNS,
    _is_headline_like,
    _RECALL_SOURCE_MARKER,
)
from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.health.cleanup")


# Tables where drug_id is nullable — we null the FK to preserve the recall row.
_FK_NULL_TABLES: tuple[str, ...] = (
    "recalls",
    "user_watchlists",
)
# Tables where drug_id is NOT NULL (or rows are pure child-of-drug):
# the corresponding rows must be deleted before the parent drug can go.
# These rows wouldn't exist if the polluted drug had never been created,
# so deleting them restores the intended state.
_FK_DELETE_TABLES: tuple[str, ...] = (
    "shortage_events",
    "drug_synonyms",
    "drug_rxnorm",
    "drug_pricing",
    "drug_catalogue",
    # drug_alternatives has ON DELETE CASCADE — covered automatically
)


def _collect_polluted(db: Any) -> list[dict[str, Any]]:
    """Return polluted drug rows, deduped by id."""
    seen: dict[str, dict[str, Any]] = {}

    # 1. headline-shape pass
    resp = (
        db.table("drugs")
        .select("id, generic_name, therapeutic_category, created_at")
        .ilike("therapeutic_category", f"{_RECALL_SOURCE_MARKER}%Recall%")
        .limit(5000)
        .execute()
    )
    for row in (resp.data or []):
        if _is_headline_like(row.get("generic_name") or ""):
            seen[row["id"]] = row

    # 2. canary patterns (catches HC pollution even without the source marker,
    #    for older rows whose therapeutic_category may differ)
    for pat in _HC_CANARY_PATTERNS:
        resp = (
            db.table("drugs")
            .select("id, generic_name, therapeutic_category, created_at")
            .ilike("generic_name", f"%{pat}%")
            .limit(100)
            .execute()
        )
        for row in (resp.data or []):
            seen[row["id"]] = row

    return list(seen.values())


def _count_refs(db: Any, drug_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for tbl in _FK_NULL_TABLES + _FK_DELETE_TABLES:
        try:
            resp = (
                db.table(tbl).select("id", count="exact")
                .eq("drug_id", drug_id).limit(1).execute()
            )
            counts[tbl] = getattr(resp, "count", None) or 0
        except Exception:
            counts[tbl] = -1  # table absent or not queryable
    return counts


def _clean_one(db: Any, drug_id: str, *, commit: bool) -> dict[str, int]:
    actions: dict[str, int] = {}
    for tbl in _FK_NULL_TABLES:
        try:
            if commit:
                resp = db.table(tbl).update({"drug_id": None}).eq("drug_id", drug_id).execute()
                actions[f"null:{tbl}"] = len(resp.data or [])
            else:
                resp = (
                    db.table(tbl).select("id", count="exact")
                    .eq("drug_id", drug_id).limit(1).execute()
                )
                actions[f"null:{tbl}"] = getattr(resp, "count", None) or 0
        except Exception as exc:
            actions[f"null:{tbl}"] = -1
            log.debug("null update skipped", extra={"table": tbl, "error": str(exc)})

    for tbl in _FK_DELETE_TABLES:
        try:
            if commit:
                resp = db.table(tbl).delete().eq("drug_id", drug_id).execute()
                actions[f"delete:{tbl}"] = len(resp.data or [])
            else:
                resp = (
                    db.table(tbl).select("id", count="exact")
                    .eq("drug_id", drug_id).limit(1).execute()
                )
                actions[f"delete:{tbl}"] = getattr(resp, "count", None) or 0
        except Exception:
            actions[f"delete:{tbl}"] = -1

    if commit:
        try:
            db.table("drugs").delete().eq("id", drug_id).execute()
            actions["delete:drugs"] = 1
        except Exception as exc:
            actions["delete:drugs"] = 0
            log.error("Failed to delete drug row",
                      extra={"drug_id": drug_id, "error": str(exc)})
    else:
        actions["delete:drugs"] = 1  # would-delete count

    return actions


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", action="store_true",
                        help="Actually mutate the database. Default: dry-run.")
    parser.add_argument("--limit", type=int, default=200,
                        help="Safety cap on rows to clean in one run.")
    args = parser.parse_args(argv)

    db = get_supabase_client()
    polluted = _collect_polluted(db)

    print(f"Polluted rows found: {len(polluted)}")
    if not polluted:
        return 0

    if len(polluted) > args.limit:
        print(f"ERROR: pollution count ({len(polluted)}) exceeds --limit "
              f"({args.limit}). Investigate before cleaning.", file=sys.stderr)
        return 2

    print()
    print(f"{'MODE:':6s} {'COMMIT' if args.commit else 'DRY-RUN (no changes)'}")
    print("-" * 78)
    for row in polluted:
        refs = _count_refs(db, row["id"])
        ref_str = " ".join(f"{k}={v}" for k, v in refs.items() if v)
        print(f"- {row['id'][:8]}  {row['generic_name'][:70]}")
        print(f"    refs: {ref_str or '(none)'}")
        actions = _clean_one(db, row["id"], commit=args.commit)
        action_str = " ".join(f"{k}={v}" for k, v in actions.items() if v)
        print(f"    {'did' if args.commit else 'would'}: {action_str}")
    print("-" * 78)
    print(f"{'COMMITTED' if args.commit else 'DRY-RUN'} — {len(polluted)} polluted rows processed.")
    if not args.commit:
        print("\nRe-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
