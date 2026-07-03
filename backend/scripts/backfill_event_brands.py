"""
Event brand/sponsor backfill
────────────────────────────
Populate the shortage_events.brand_name / .sponsor columns (migration 068) from
the per-product identity the regulators already publish and we already store
verbatim in raw_data. Nothing is inferred: sources that report at ingredient
level only (MHRA and most others) are left NULL, and the UI labels those rows
ingredient-level.

Per-source extraction (raw_data keys as written by the scrapers):

  source                 brand_name from            sponsor from
  ─────────────────────  ─────────────────────────  ─────────────────────────
  TGA (AU)               trade_names                sponsor
  Health Canada (CA)     brand_name                 company_name
  FDA (US)               —  (not in raw_data)       company_name
  EMA (EU)               medicine_affected*         marketing_authorisation_holder_s*

  * EMA raw_data is the upstream record verbatim, so we probe the same key
    aliases the scraper uses.

Idempotent and re-runnable: only rows where brand_name AND sponsor are both
NULL are considered, and rows whose raw_data yields nothing are skipped (they
will be re-examined on the next run, which stays cheap because the candidate
set only shrinks). Safe to run on cron until scrapers write these directly.

Usage:
  # Dry run (default) — read-only: extraction coverage stats + samples:
  python3 -m backend.scripts.backfill_event_brands

  # Execute (requires migration 068 applied to the target DB first):
  python3 -m backend.scripts.backfill_event_brands --execute
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from typing import Any, Callable

from backend.utils.db import get_supabase_client

# data_sources UUIDs (seeded in migration 001) → extractor(raw_data) →
# (brand_name, sponsor). Keep in sync with each scraper's raw_record shape.
SOURCE_LABELS: dict[str, str] = {
    "10000000-0000-0000-0000-000000000001": "fda",
    "10000000-0000-0000-0000-000000000002": "health_canada",
    "10000000-0000-0000-0000-000000000003": "tga",
    "10000000-0000-0000-0000-000000000005": "ema",
}

_EMA_BRAND_KEYS = ["medicine_affected", "medicine affected", "medicine name"]
_EMA_MAH_KEYS = [
    "marketing_authorisation_holder_s", "marketing_authorisation_holder",
    "marketing authorisation holder", "mah", "MAH", "holder",
    "Marketing Authorisation Holder",
]


def _clean(v: Any) -> str | None:
    """Whitespace-strip to a bounded, non-empty string or None."""
    if v is None:
        return None
    if isinstance(v, list):
        v = v[0] if v else None
    s = str(v or "").strip()
    if not s or s.lower() in ("n/a", "none", "unknown", "-"):
        return None
    return s[:300]


def _probe(raw: dict, keys: list[str]) -> str | None:
    for k in keys:
        if k in raw:
            got = _clean(raw.get(k))
            if got:
                return got
    return None


EXTRACTORS: dict[str, Callable[[dict], tuple[str | None, str | None]]] = {
    "fda":           lambda r: (None, _clean(r.get("company_name"))),
    "health_canada": lambda r: (_clean(r.get("brand_name")), _clean(r.get("company_name"))),
    "tga":           lambda r: (_clean(r.get("trade_names")), _clean(r.get("sponsor"))),
    "ema":           lambda r: (_probe(r, _EMA_BRAND_KEYS), _probe(r, _EMA_MAH_KEYS)),
}

PAGE = 1000


def fetch_candidates(db, migrated: bool) -> list[dict]:
    """All rows from the known sources with nothing extracted yet.

    `migrated=False` supports dry-running BEFORE migration 068 is applied:
    the brand/sponsor columns are neither selected nor filtered on, so every
    row from the known sources is a candidate (fine — the run is read-only).
    """
    rows: list[dict] = []
    offset = 0
    while True:
        qb = (
            db.table("shortage_events")
            .select("id,data_source_id,raw_data" + (",brand_name,sponsor" if migrated else ""))
            .in_("data_source_id", list(SOURCE_LABELS.keys()))
        )
        if migrated:
            qb = qb.is_("brand_name", "null").is_("sponsor", "null")
        resp = qb.order("id").range(offset, offset + PAGE - 1).execute()
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--execute", action="store_true",
                    help="write updates (default is a read-only dry run)")
    ap.add_argument("--limit", type=int, default=0,
                    help="cap processed rows (0 = all); useful for a first verified batch")
    args = ap.parse_args()

    db = get_supabase_client()
    # Probe whether migration 068 is applied; degrade the dry run gracefully
    # when it isn't (--execute genuinely needs the columns, so that stays fatal).
    try:
        db.table("shortage_events").select("brand_name").limit(1).execute()
        migrated = True
    except Exception:
        migrated = False
        if args.execute:
            print("shortage_events.brand_name does not exist — apply migration "
                  "068 before running with --execute.", file=sys.stderr)
            return 1
        print("NOTE: migration 068 not applied yet — dry-running against all "
              "rows from the known sources.")
    rows = fetch_candidates(db, migrated)
    if args.limit:
        rows = rows[: args.limit]
    print(f"candidates (brand_name+sponsor both NULL, known sources): {len(rows)}")

    extracted: list[tuple[str, str | None, str | None]] = []  # (id, brand, sponsor)
    per_source: Counter[str] = Counter()
    misses: Counter[str] = Counter()
    for row in rows:
        label = SOURCE_LABELS[row["data_source_id"]]
        brand, sponsor = EXTRACTORS[label](row.get("raw_data") or {})
        if brand or sponsor:
            extracted.append((row["id"], brand, sponsor))
            per_source[label] += 1
        else:
            misses[label] += 1

    print(f"extractable: {len(extracted)}  by source: {dict(per_source)}")
    print(f"nothing extractable (stay NULL): {dict(misses)}")
    # Show up to 3 samples per source so a human can eyeball correctness.
    shown: Counter[str] = Counter()
    for row in rows:
        label = SOURCE_LABELS[row["data_source_id"]]
        brand, sponsor = EXTRACTORS[label](row.get("raw_data") or {})
        if (brand or sponsor) and shown[label] < 3:
            shown[label] += 1
            print(f"  sample [{label}] id={row['id']}: brand={brand!r} sponsor={sponsor!r}")

    if not args.execute:
        print("\nDRY RUN — nothing written. Re-run with --execute to apply.")
        return 0

    written = failed = 0
    for ev_id, brand, sponsor in extracted:
        patch: dict[str, Any] = {}
        if brand:
            patch["brand_name"] = brand
        if sponsor:
            patch["sponsor"] = sponsor
        try:
            db.table("shortage_events").update(patch).eq("id", ev_id).execute()
            written += 1
        except Exception as exc:  # keep going; report at the end
            failed += 1
            if failed <= 5:
                print(f"  FAILED id={ev_id}: {exc}", file=sys.stderr)
        if written and written % 1000 == 0:
            print(f"  … {written}/{len(extracted)} written")

    print(f"done: {written} written, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
