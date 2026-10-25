"""
WHO Essential Medicines List Importer  →  who_essential_medicines (+ drugs flag)
────────────────────────────────────────────────────────────────────────────────
Source:  WHO electronic Essential Medicines List (eEML), the official digital
         home of the WHO Model List of Essential Medicines.
Site:    https://list.essentialmeds.org   (robots.txt: Disallow: <empty> = allowed)
API:     JSON-LD, no auth. Three endpoints used:
           GET /medicines                  → index of medicine refs (~1,100)
           GET /medicines/{id}             → INN, formulations, AWaRe, guideline refs
           GET /recommendations/{id}       → ATC code, EML section, core/complementary,
                                             children's-list flag, indication
         Pass `Accept: application/ld+json` to get JSON (HTML otherwise).

Why this matters
────────────────
Mederti already *consumes* a WHO-essential signal everywhere — badges, the chat
sole-source tools, predictive-signals, drug-resilience, SEO, OG images — via
drugs.who_essential_medicine / who_eml_section / who_eml_year (migration 023).
But nothing ever populated those columns: only ~70 of ~18k drugs were hand-seeded
vs the ~460 substances on the real 23rd List. This importer fills the gap.

It does two writes:
  1. Authoritative record  → who_essential_medicines (migration 051), one row per
     eEML medicine, verbatim (core/complementary, EMLc, AWaRe, formulations).
  2. Denormalised flag      → drugs.who_essential_medicine = TRUE plus
     who_eml_section / who_eml_year, so the existing UI lights up unchanged.

The raw-table write degrades gracefully: if migration 051 has not been applied
yet (prod has known migration drift), the importer logs a warning and STILL does
the drugs-flag backfill — the columns it needs there already exist.

Matching (WHO substance → canonical drugs row)
──────────────────────────────────────────────
INN-primary via the shared DrugResolver (alternatives_resolver.py: exact name,
INN→USAN alias, strict salt form), then exact ATC code. Both steps require
exactly one matching row — a name or code shared by several drugs rows stays
unresolved rather than flagging an arbitrary one. Unmatched WHO entries are
still stored (NULL drug_id) so the list stays complete and citable.

Records are written every BATCH_SIZE medicines, so a run that dies part-way
keeps its progress and `--resume` skips what is already in the table.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.who_eml_importer
    python3 -m backend.importers.who_eml_importer
    python3 -m backend.importers.who_eml_importer --limit 25   # quick live sample

Cadence: every 2 years (WHO republishes the list). Idempotent — upserts on the
eEML medicine id; drug-flag updates are set-to-TRUE only (never un-flags).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import DrugResolver  # noqa: E402
from backend.utils.db import get_supabase_client                  # noqa: E402
from backend.utils.logger import get_logger                       # noqa: E402

log = get_logger("mederti.importer.who_eml")

BASE_URL = "https://list.essentialmeds.org"
HEADERS = {
    "Accept": "application/ld+json",
    "User-Agent": "Mederti-EML-Importer/1.0 (drug-shortage-intelligence; contact: data@mederti.com)",
}
TIMEOUT = 90.0
RATE_LIMIT_SECONDS = 0.4          # be polite to a public WHO service
BATCH_SIZE = 50                   # write every N medicines so --resume has progress to skip
SOURCE_PAGE = BASE_URL + "/medicines/{id}"

# 23rd WHO Model List of Essential Medicines (2023). The eEML serves the current
# edition; we stamp every row so a future edition is a one-line change + re-run.
EML_EDITION = 23
EML_YEAR = 2023

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"


# ── fetch ────────────────────────────────────────────────────────────────────
# The eEML backend renders each JSON-LD record server-side: responses take
# 7-13s and the upstream throws 5xx ("upstream connect error", 503/500) under
# burst load. We retry transient failures with exponential backoff so a long,
# slow, flaky run still completes. Only the final failure logs a warning.
MAX_RETRIES = 4
RETRY_BACKOFF = 3.0  # seconds: 3, 6, 12, 24


def _get(client: httpx.Client, path: str) -> dict[str, Any] | None:
    """GET a JSON-LD resource with retry/backoff; return parsed dict or None."""
    url = BASE_URL + path
    last_err = ""
    for attempt in range(MAX_RETRIES):
        try:
            r = client.get(url)
            if r.status_code >= 500:
                last_err = f"HTTP {r.status_code}"
                raise httpx.HTTPStatusError(last_err, request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 — one bad record must not kill the run
            last_err = str(exc)
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF * (2 ** attempt))
    log.warning("eEML fetch failed", extra={"path": path, "error": last_err})
    return None


def _medicine_ids(client: httpx.Client) -> list[int]:
    """The /medicines collection is a JSON-LD ItemList of @id refs."""
    doc = _get(client, "/medicines")
    if not doc:
        return []
    ids: list[int] = []
    for el in doc.get("itemListElement", []):
        ref = el.get("@id", "") if isinstance(el, dict) else str(el)
        tail = ref.rstrip("/").rsplit("/", 1)[-1]
        if tail.isdigit():
            ids.append(int(tail))
    return sorted(set(ids))


# ── normalise ────────────────────────────────────────────────────────────────
def _as_list(v: Any) -> list[Any]:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _list_token(raw_list: str | None) -> str | None:
    """eEML 'CoreList' | 'ComplementaryList' → 'core' | 'complementary'."""
    if not raw_list:
        return None
    s = raw_list.lower()
    if "core" in s:
        return "core"
    if "complementary" in s:
        return "complementary"
    return None


def _build_record(client: httpx.Client, med_id: int) -> dict[str, Any] | None:
    """Fetch one medicine + its recommendations → a flat who_essential_medicines row."""
    med = _get(client, f"/medicines/{med_id}")
    if not med:
        return None
    inn = (med.get("nonProprietaryName") or med.get("name") or "").strip()
    if not inn:
        return None

    # Recommendations carry ATC, section, core/complementary, EMLc flag.
    atc: str | None = None
    section: str | None = None
    eml_list: str | None = None
    included_in_emlc = False
    for g in _as_list(med.get("guideline")):
        ref = g.get("@id", "") if isinstance(g, dict) else str(g)
        if not ref:
            continue
        time.sleep(RATE_LIMIT_SECONDS)
        rec = _get(client, ref if ref.startswith("/") else "/" + ref.split(BASE_URL)[-1])
        if not rec:
            continue
        # ATC from guidelineSubject.code (codingSystem == 'ATC'). Combination
        # medicines carry a LIST of subjects, one per component; their codes
        # differ, so only keep an ATC when every subject agrees on it — a
        # component's code would mis-resolve the combination via the ATC match.
        codes = {
            code["codeValue"]
            for subj in _as_list(rec.get("guidelineSubject")) if isinstance(subj, dict)
            for code in _as_list(subj.get("code"))
            if isinstance(code, dict) and code.get("codingSystem") == "ATC" and code.get("codeValue")
        }
        if len(codes) == 1:
            atc = atc or codes.pop()
        # Section name (the most specific, leaf section)
        sec = rec.get("section")
        if isinstance(sec, dict) and sec.get("name") and not section:
            section = sec["name"].strip()
        # Core beats complementary if a medicine is on both for different indications
        lt = _list_token(rec.get("list"))
        if lt == "core":
            eml_list = "core"
        elif lt and not eml_list:
            eml_list = lt
        if rec.get("includedInEmlc"):
            included_in_emlc = True

    aware = None
    aware_raw = _as_list(med.get("antibioticStewardshipGroup"))
    if aware_raw:
        # Values look like "Access" / "Watch" / "Reserve"
        first = aware_raw[0]
        aware = (first.get("name") if isinstance(first, dict) else str(first)).strip() or None

    return {
        "eeml_id": med_id,
        "inn": inn,
        "atc_code": atc,
        "description": (med.get("description") or "").strip() or None,
        "eml_section": section,
        "eml_list": eml_list,
        "included_in_emlc": included_in_emlc,
        "aware_group": aware,
        "eml_edition": EML_EDITION,
        "eml_year": EML_YEAR,
        "formulations": _as_list(med.get("drugUnit")) or None,
        "raw": med,
        "source_url": SOURCE_PAGE.format(id=med_id),
    }


def fetch_batches(limit: int | None = None, skip_ids: set[int] | None = None,
                  size: int = 0):
    """Yield lists of records, `size` at a time (0 = one list at the end).

    Yielding in batches lets the caller write as it goes, so a multi-hour run
    that dies part-way keeps what it fetched and `--resume` can skip it.
    """
    skip_ids = skip_ids or set()
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
        ids = _medicine_ids(client)
        if skip_ids:
            ids = [i for i in ids if i not in skip_ids]
        if limit:
            ids = ids[:limit]
        log.info("eEML medicine ids", extra={"count": len(ids), "skipped": len(skip_ids)})
        batch: list[dict[str, Any]] = []
        for i, mid in enumerate(ids, 1):
            time.sleep(RATE_LIMIT_SECONDS)
            rec = _build_record(client, mid)
            if rec:
                batch.append(rec)
            if i % 100 == 0:
                log.info("eEML progress", extra={"done": i, "total": len(ids)})
            if size and len(batch) >= size:
                yield batch
                batch = []
        if batch:
            yield batch


# ── drug matching ────────────────────────────────────────────────────────────
def _load_atc_index(supabase) -> dict[str, str]:
    """atc-code → drug id, only for codes carried by exactly one drugs row."""
    by_atc: dict[str, set[str]] = {}
    page, size = 0, 1000
    while True:
        res = (
            supabase.table("drugs")
            .select("id, atc_code")
            .not_.is_("atc_code", "null")
            .range(page * size, page * size + size - 1)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            atc = (r.get("atc_code") or "").strip().upper()
            if atc:
                by_atc.setdefault(atc, set()).add(r["id"])
        if len(rows) < size:
            break
        page += 1
    return {k: next(iter(v)) for k, v in by_atc.items() if len(v) == 1}


def _match(rec: dict, resolver: DrugResolver, by_atc: dict[str, str]) -> tuple[str | None, str | None]:
    """Return (drug_id, match_method). Exact INN via the shared DrugResolver
    (exact name, INN→USAN alias, strict salt form; ambiguous names stay
    unresolved), then exact ATC code where only one row carries it."""
    drug_id, method = resolver.resolve(rec["inn"])
    if drug_id:
        return drug_id, method
    atc = (rec.get("atc_code") or "").strip().upper()
    if atc and atc in by_atc:
        return by_atc[atc], "atc"
    return None, None


# ── write ────────────────────────────────────────────────────────────────────
def upsert(supabase, records: list[dict], resolver: DrugResolver,
           by_atc: dict[str, str]) -> dict[str, int]:
    counts = {"medicines": len(records), "raw_upserted": 0, "matched": 0,
              "drugs_flagged": 0, "raw_table_missing": 0, "errors": 0}
    if not records:
        return counts

    raw_rows: list[dict] = []
    drug_updates: dict[str, dict] = {}   # drug_id → {section, year} (TRUE-flag set)
    for rec in records:
        drug_id, method = _match(rec, resolver, by_atc)
        if drug_id:
            counts["matched"] += 1
            # First listing (most specific section) wins per drug.
            drug_updates.setdefault(drug_id, {
                "who_essential_medicine": True,
                "who_eml_section": rec.get("eml_section"),
                "who_eml_year": EML_YEAR,
            })
        raw_rows.append({**{k: rec[k] for k in (
            "eeml_id", "inn", "atc_code", "description", "eml_section", "eml_list",
            "included_in_emlc", "aware_group", "eml_edition", "eml_year",
            "formulations", "raw", "source_url",
        )}, "drug_id": drug_id, "match_method": method})

    # 1) Authoritative raw table (graceful if migration 051 not yet applied).
    try:
        supabase.table("who_essential_medicines").upsert(raw_rows, on_conflict="eeml_id").execute()
        counts["raw_upserted"] = len(raw_rows)
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        # A table absent from PostgREST surfaces as HTTP 404 (schema cache miss),
        # sometimes with a PGRST205 body code or "does not exist" text. Any of
        # those means "migration 051 not applied yet" — degrade gracefully to a
        # drugs-flag-only run rather than failing the whole import.
        table_missing = ("404" in msg or "PGRST205" in msg
                         or ("who_essential_medicines" in msg and "does not exist" in msg))
        if table_missing:
            counts["raw_table_missing"] = len(raw_rows)
            log.warning("who_essential_medicines table missing — apply migration 051. "
                        "Proceeding with drugs-flag backfill only.")
        else:
            counts["errors"] += 1
            log.error("Raw upsert failed", extra={"error": msg})

    # 2) Denormalised flag onto drugs (columns exist since migration 023).
    for drug_id, patch in drug_updates.items():
        try:
            supabase.table("drugs").update(patch).eq("id", drug_id).execute()
            counts["drugs_flagged"] += 1
        except Exception as exc:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("Drug flag update failed", extra={"drug_id": drug_id, "error": str(exc)})

    return counts


# ── entrypoint ───────────────────────────────────────────────────────────────
def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    parser = argparse.ArgumentParser(description="Import the WHO Essential Medicines List (eEML).")
    parser.add_argument("--limit", type=int, default=None, help="only process the first N medicines")
    parser.add_argument("--resume", action="store_true",
                        help="skip eeml_ids already in who_essential_medicines (for flaky-upstream reruns)")
    args = parser.parse_args()

    skip_ids: set[int] = set()
    if args.resume and not DRY_RUN:
        try:
            res = get_supabase_client().table("who_essential_medicines").select("eeml_id").execute()
            skip_ids = {r["eeml_id"] for r in (res.data or [])}
            log.info("Resume: skipping already-imported medicines", extra={"count": len(skip_ids)})
        except Exception as exc:  # noqa: BLE001
            log.warning("Resume lookup failed (table missing?) — fetching all", extra={"error": str(exc)})

    if DRY_RUN:
        records = [r for b in fetch_batches(limit=args.limit, skip_ids=skip_ids) for r in b]
        n_core = sum(1 for r in records if r.get("eml_list") == "core")
        n_emlc = sum(1 for r in records if r.get("included_in_emlc"))
        n_abx = sum(1 for r in records if r.get("aware_group"))
        print("=" * 64)
        print("DRY RUN — WHO Essential Medicines List (eEML)")
        print("=" * 64)
        print(f"  Medicines fetched   : {len(records)}")
        print(f"  Unique INNs         : {len({r['inn'].lower() for r in records})}")
        print(f"  With ATC code       : {sum(1 for r in records if r.get('atc_code'))}")
        print(f"  Core list           : {n_core}")
        print(f"  Children's list     : {n_emlc}")
        print(f"  Antibiotics (AWaRe) : {n_abx}")
        for r in records[:10]:
            print(f"    {r['inn'][:30]:30s}  {r.get('atc_code') or '—':10s}  "
                  f"{r.get('eml_list') or '—':13s}  {r.get('aware_group') or ''}")
        return 0

    supabase = get_supabase_client()
    resolver = DrugResolver(supabase)
    by_atc = _load_atc_index(supabase)
    counts: dict[str, int] = {}
    for batch in fetch_batches(limit=args.limit, skip_ids=skip_ids, size=BATCH_SIZE):
        for k, v in upsert(supabase, batch, resolver, by_atc).items():
            counts[k] = counts.get(k, 0) + v
        log.info("eEML batch written", extra=dict(counts))
    print("=" * 64)
    print("WHO Essential Medicines import complete")
    print("=" * 64)
    for k, v in counts.items():
        print(f"  {k:18s}: {v}")
    return 0 if counts.get("errors", 0) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
