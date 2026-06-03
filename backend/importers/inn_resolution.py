"""
INN resolution backfill — resolve every `drugs` row to a molecule identity and
roll salt/form/language/brand variants up to a single canonical INN head.

For each drug row:
  1. Resolve raw generic_name → INN + RxCUI + UNII + ATC (substance_resolver).
  2. HIGH confidence → auto-apply:
       • populate drugs.{rxcui, unii, resolved_inn, atc_code, …}
       • find/create the canonical INN head (the clean single-INN row)
       • point variant rows' canonical_drug_id at the head and merge their
         brand names + raw name into the head so brand/name search rolls up.
  3. LOW/MEDIUM confidence → log to drug_resolution_review for a human; never
     guess.

Safety
------
  • Dry-run by DEFAULT. Writes only with --execute.
  • `on_conflict` upserts and id-filtered patches → idempotent re-runs.
  • Never overwrites a non-null identifier with null; never repoints a row that
    is itself a head.

Usage
-----
  # Dry-run the three validation molecules
  python3 -m backend.importers.inn_resolution --like 'atorvastatin*'
  python3 -m backend.importers.inn_resolution --like 'heparin*' --execute
  python3 -m backend.importers.inn_resolution --missing-unii --limit 500 --execute
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from backend.importers.substance_resolver import HIGH, resolve, Resolution
from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.importer.inn_resolution")

DRUG_COLS = (
    "id,generic_name,generic_name_normalised,brand_names,rxcui,unii,"
    "atc_code,resolved_inn,canonical_drug_id"
)


# ── Target selection ─────────────────────────────────────────────────────────

def fetch_targets(db, like: str | None, only_missing: bool, limit: int | None,
                  unresolved: bool = False) -> list[dict]:
    rows, offset, page = [], 0, 1000
    while True:
        q = db.table("drugs").select(DRUG_COLS).order("generic_name")
        if like:
            q = q.ilike("generic_name_normalised", like)
        if only_missing:
            q = q.is_("unii", "null")
        if unresolved:
            # Resumability: skip rows already resolved by a prior run. Makes the
            # backfill restart-safe (laptop sleep, kill) — re-run continues the rest.
            q = q.is_("resolved_inn", "null")
        q = q.range(offset, offset + page - 1)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < page or (limit and len(rows) >= limit):
            break
        offset += page
    return rows[:limit] if limit else rows


def fetch_shortage_drug_ids(db) -> set[str]:
    """Distinct drug_ids referenced by at least one shortage_event."""
    ids, offset, page = set(), 0, 1000
    while True:
        batch = (
            db.table("shortage_events")
            .select("drug_id")
            .not_.is_("drug_id", "null")
            .range(offset, offset + page - 1)
            .execute()
        ).data or []
        ids.update(x["drug_id"] for x in batch)
        if len(batch) < page:
            break
        offset += page
    return ids


# ── Canonical head management ────────────────────────────────────────────────

class HeadCache:
    """Resolves and (optionally) creates the canonical INN head per molecule."""

    def __init__(self, db, execute: bool):
        self.db = db
        self.execute = execute
        self._by_inn: dict[str, str | None] = {}   # inn → head drug_id
        self.created: list[str] = []

    def find_or_create(self, r: Resolution) -> str | None:
        inn = (r.inn or "").strip().lower()
        if not inn:
            return None
        if inn in self._by_inn:
            return self._by_inn[inn]

        # 1. Existing clean head: a row named exactly the INN that is itself
        #    canonical (not already pointed elsewhere).
        existing = (
            self.db.table("drugs")
            .select("id,generic_name,canonical_drug_id")
            .eq("generic_name_normalised", inn)
            .is_("canonical_drug_id", "null")
            .limit(1)
            .execute()
        ).data
        if existing:
            head_id = existing[0]["id"]
            self._by_inn[inn] = head_id
            return head_id

        # 2. Existing head by UNII (created in a prior run).
        if r.unii:
            by_unii = (
                self.db.table("drugs")
                .select("id")
                .eq("unii", r.unii)
                .is_("canonical_drug_id", "null")
                .limit(1)
                .execute()
            ).data
            if by_unii:
                head_id = by_unii[0]["id"]
                self._by_inn[inn] = head_id
                return head_id

        # 3. No clean head exists → create one (the molecule anchor).
        if not self.execute:
            self._by_inn[inn] = f"(new:{inn})"
            self.created.append(inn)
            return self._by_inn[inn]

        new = (
            self.db.table("drugs")
            .insert({
                "generic_name": inn.title(),
                "resolved_inn": inn,
                "rxcui": r.base_rxcui,
                "unii": r.unii,
                "atc_code": r.atc,
                "inn_resolution_method": r.method,
                "inn_resolution_confidence": r.score,
                "inn_resolved_at": _now(),
                "therapeutic_category": "Canonical INN head (inn_resolution)",
            })
            .execute()
        ).data
        head_id = new[0]["id"]
        self._by_inn[inn] = head_id
        self.created.append(inn)
        log.info("Created canonical head", extra={"inn": inn, "drug_id": head_id, "unii": r.unii})
        return head_id


# ── Apply / queue ────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def apply_high(db, drug: dict, r: Resolution, head_id: str | None, execute: bool) -> str:
    """Populate identifiers on the drug row and roll it up to its head."""
    is_head = head_id == drug["id"]

    patch: dict = {
        "resolved_inn": r.inn,
        "rxcui": drug.get("rxcui") or r.rxcui,
        "unii": drug.get("unii") or r.unii,
        "atc_code": drug.get("atc_code") or r.atc,
        "inn_resolution_method": r.method,
        "inn_resolution_confidence": r.score,
        "inn_resolved_at": _now(),
    }
    if not is_head and head_id and not str(head_id).startswith("(new:"):
        patch["canonical_drug_id"] = head_id

    if not execute:
        return "head" if is_head else "rollup"

    db.table("drugs").update(patch).eq("id", drug["id"]).execute()

    # Merge variant's brands + raw name into the head so brand/name search rolls up.
    if not is_head and head_id and not str(head_id).startswith("(new:"):
        _merge_aliases_into_head(db, head_id, drug)
    return "head" if is_head else "rollup"


def _merge_aliases_into_head(db, head_id: str, variant: dict) -> None:
    head = (
        db.table("drugs").select("brand_names,generic_name").eq("id", head_id).single().execute()
    ).data
    if not head:
        return
    brands = set(head.get("brand_names") or [])
    before = len(brands)
    brands.update(b for b in (variant.get("brand_names") or []) if b)
    # The variant's own generic_name is an alias of the molecule (e.g. a brand or
    # a foreign spelling) — record it as a synonym so search folds it in.
    vname = (variant.get("generic_name") or "").strip()
    if vname and vname.lower() != (head.get("generic_name") or "").lower():
        try:
            db.table("drug_synonyms").upsert(
                {"drug_id": head_id, "synonym": vname, "source": "inn_resolution"},
                on_conflict="drug_id,synonym_normalised",
            ).execute()
        except Exception as e:  # synonym table is best-effort
            log.debug(f"synonym upsert failed for {vname!r}: {e}")
    if len(brands) != before:
        db.table("drugs").update({"brand_names": sorted(brands)}).eq("id", head_id).execute()


def queue_review(db, drug: dict, r: Resolution, source: str, execute: bool) -> None:
    row = {
        "drug_id": drug["id"],
        "raw_name": drug.get("generic_name") or "",
        "source": source,
        "cleaned_name": r.cleaned,
        "removed_salts": r.removed_salts or None,
        "candidate_inn": r.inn,
        "candidate_rxcui": r.rxcui,
        "candidate_unii": r.unii,
        "candidate_atc": r.atc,
        "confidence": r.score,
        "method": r.method,
        "reason": r.reason,
        "status": "pending",
    }
    if not execute:
        return
    # The dedup index is an expression index — UNIQUE (raw_name, COALESCE(source, ''))
    # — which PostgREST cannot use as an `on_conflict` target. `source` is always
    # non-null here (a --like pattern or 'backfill'), so emulate the upsert with an
    # explicit lookup: update an existing open row, otherwise insert.
    existing = (
        db.table("drug_resolution_review")
        .select("id")
        .eq("raw_name", row["raw_name"])
        .eq("source", row["source"])
        .limit(1)
        .execute()
    ).data
    if existing:
        db.table("drug_resolution_review").update(row).eq("id", existing[0]["id"]).execute()
    else:
        db.table("drug_resolution_review").insert(row).execute()


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Resolve drugs to molecule identities (INN/RxCUI/UNII/ATC).")
    ap.add_argument("--like", help="ilike pattern on generic_name_normalised, e.g. 'atorvastatin*'")
    ap.add_argument("--missing-unii", action="store_true", help="only rows with NULL unii")
    ap.add_argument("--with-shortages", action="store_true",
                    help="only drugs referenced by >=1 shortage_event (the product-relevant set; "
                         "skips the supplement/junk tail that mostly misses RxNav and falls to GSRS)")
    ap.add_argument("--unresolved", action="store_true",
                    help="only rows with resolved_inn IS NULL — resumable: re-run continues where "
                         "a prior run was interrupted")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--execute", action="store_true", help="write changes (default: dry-run)")
    args = ap.parse_args()

    db = get_supabase_client()
    targets = fetch_targets(db, args.like, args.missing_unii, args.limit, args.unresolved)
    if args.with_shortages:
        shortage_ids = fetch_shortage_drug_ids(db)
        before = len(targets)
        targets = [d for d in targets if d["id"] in shortage_ids]
        print(f"[inn_resolution] --with-shortages: {before} → {len(targets)} rows "
              f"({len(shortage_ids)} drugs have shortage events)", flush=True)
    print(f"[inn_resolution] {len(targets)} target rows  execute={args.execute}", flush=True)

    heads = HeadCache(db, args.execute)
    stats = {"head": 0, "rollup": 0, "review": 0, "high": 0, "low_med": 0}

    for d in targets:
        raw = d.get("generic_name") or ""
        r = resolve(raw)
        if r.confidence == HIGH and r.inn:
            stats["high"] += 1
            head_id = heads.find_or_create(r)
            outcome = apply_high(db, d, r, head_id, args.execute)
            stats[outcome] += 1
            tag = "HEAD " if outcome == "head" else "→roll"
            print(f"  {tag} {raw[:48]:48} ⇒ {r.inn:18} unii={r.unii or '-':12} atc={r.atc or '-':8} head={str(head_id)[:8]}", flush=True)
        else:
            stats["low_med"] += 1
            stats["review"] += 1
            queue_review(db, d, r, args.like or args.missing_unii and "missing-unii" or "backfill", args.execute)
            print(f"  REVIEW {raw[:46]:46} ⇒ inn={r.inn or '-'} conf={r.confidence} reason={r.reason}", flush=True)

    print(
        f"\n[inn_resolution] high={stats['high']} (heads={stats['head']}, rollups={stats['rollup']}) "
        f"review={stats['review']} heads_created={len(heads.created)} execute={args.execute}",
        flush=True,
    )
    if not args.execute:
        print("[inn_resolution] DRY RUN — no writes. Re-run with --execute to apply.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
