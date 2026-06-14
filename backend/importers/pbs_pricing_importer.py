"""
PBS Trade-Price Importer (AU)
─────────────────────────────
Source: PBS Schedule Data API (public tier)
        https://data-api.health.gov.au/pbs/api/v3/item-overview

Populates drug_pricing with one representative Australian trade price per
canonical drug per monthly schedule:

  • price_amount     — AEMP (Approved Ex-Manufacturer Price, `determined_price`)
  • dispensed_amount — DPMQ (community-pharmacy `cmnwlth_dsp_price_max_qty`)
  • pack_size        — the PBS `schedule_form` ("atorvastatin 80 mg tablet, 30")
  • price_date       — the schedule's effective date (1st of the month)

The /api/search trade-price column and the drug-page price card already read
exactly these columns (see frontend/app/api/search/route.ts) and light up
automatically once rows exist. Requires migration 056 (dispensed_amount).

Representative-item choice
──────────────────────────
A molecule lists many PBS items (strengths × forms × brands). We keep the
item with the LOWEST AEMP — "trade price from" semantics — with the pack
described in pack_size so the choice is transparent in the UI. Deterministic
tie-break on pbs_code.

Pricing fields (ground-truthed against schedule 4664, June 2026)
────────────────────────────────────────────────────────────────
  determined_price          = AEMP per pricing_quantity (fallback claimed_price)
  item_dispensing_rules[]   = per-channel computed prices; the entry whose
                              dispensing_rule.community_pharmacy_indicator is
                              "true" carries the published DPMQ
                              (Lipitor 80mg×30: AEMP 4.00 → DPMQ 22.40 ✓)

API etiquette
─────────────
Public tier is rate-limited to ~1 request / 20 s, so pages are pulled at a
21 s pace with limit=1000 (15 pages ≈ 5 min). The response copyright header
grants use + redistribution provided copyright statements are retained.

Usage
─────
    python3 -m backend.importers.pbs_pricing_importer
    python3 -m backend.importers.pbs_pricing_importer --schedule-code 4664
    python3 -m backend.importers.pbs_pricing_importer --max-pages 1   # smoke test
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.pbs_pricing_importer

Cadence
───────
Monthly — the PBS Schedule takes effect on the 1st of every month. Idempotent:
rows carry a deterministic uuid5 PK on (drug_id, price_date) so re-runs upsert
in place.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from datetime import date
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402

API_BASE = "https://data-api.health.gov.au/pbs/api/v3"
# Public-tier key published in the PBS API getting-started docs (not a secret).
SUBSCRIPTION_KEY = os.environ.get("PBS_API_SUBSCRIPTION_KEY", "2384af7c667342ceb5a736fe29f1dc6b")
PACE_SECONDS = float(os.environ.get("PBS_API_PACE_SECONDS", "21"))
PAGE_SIZE = 1000
USER_AGENT = "Mederti-Importer/1.0 (https://mederti.com; drug-shortage-intelligence)"
TIMEOUT = 120.0

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"

# Fixed namespace so (drug_id, price_date) always maps to the same PK —
# PostgREST can't ON CONFLICT a partial/expression index, so we upsert on id.
PBS_UUID_NS = uuid.UUID("7b5dc9ae-90f1-4f0a-9c12-5a7e6f3d8b21")


def _get(client: httpx.Client, path: str, params: dict[str, Any]) -> dict[str, Any]:
    """GET with retry. The public tier 429s if we outpace ~1 req/20s."""
    for attempt in range(4):
        try:
            r = client.get(f"{API_BASE}/{path}", params=params)
            if r.status_code == 429:
                wait = 25 * (attempt + 1)
                print(f"[PBS] 429 rate-limited; sleeping {wait}s", flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            if attempt == 3:
                raise
            print(f"[PBS] {path} attempt {attempt + 1} failed: {e}; retrying", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("unreachable")


def latest_schedule(client: httpx.Client) -> tuple[int, str]:
    """Newest published schedule whose effective_date is not in the future."""
    payload = _get(client, "schedules", {"limit": 6})
    today = date.today().isoformat()
    for s in payload.get("data", []):
        if s.get("publication_status") == "PUBLISHED" and (s.get("effective_date") or "") <= today:
            return int(s["schedule_code"]), str(s["effective_date"])
    raise RuntimeError("no published, in-effect schedule found")


def fetch_items(client: httpx.Client, schedule_code: int, max_pages: int | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = _get(client, "item-overview",
                       {"schedule_code": schedule_code, "limit": PAGE_SIZE, "page": page})
        data = payload.get("data", [])
        items.extend(data)
        total = payload.get("_meta", {}).get("total_records")
        print(f"[PBS] page {page}: +{len(data)} items ({len(items)}/{total})", flush=True)
        if not data or len(items) >= int(total or 0) or (max_pages and page >= max_pages):
            return items
        page += 1
        time.sleep(PACE_SECONDS)


def community_pharmacy_dpmq(item: dict[str, Any]) -> float | None:
    """Published DPMQ = the community-pharmacy dispensing-rule price."""
    best: float | None = None
    for rule in item.get("item_dispensing_rules") or []:
        ref = (rule.get("dispensing_rule") or {})
        if str(ref.get("community_pharmacy_indicator")) != "true":
            continue
        price = rule.get("cmnwlth_dsp_price_max_qty")
        if price is None:
            continue
        # Ready-prepared ("rp-…") is the headline figure on pbs.gov.au; an
        # immediate-supply CP entry only wins if no rp- entry exists.
        if str(ref.get("dispensing_rule_reference", "")).startswith("rp-"):
            return float(price)
        if best is None:
            best = float(price)
    return best


def pick_representative(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """name(lower) → lowest-AEMP item carrying both AEMP and a CP DPMQ."""
    chosen: dict[str, dict[str, Any]] = {}
    for it in items:
        name = (it.get("drug_name") or "").strip()
        aemp = it.get("determined_price")
        if aemp is None:
            aemp = it.get("claimed_price")
        if not name or aemp is None:
            continue
        dpmq = community_pharmacy_dpmq(it)
        cand = {
            "drug_name": name,
            "aemp": float(aemp),
            "dpmq": dpmq,
            "pack": (it.get("schedule_form") or it.get("li_form") or "").strip() or None,
            "pbs_code": it.get("pbs_code") or "",
            "brand": it.get("brand_name"),
        }
        cur = chosen.get(name.lower())
        if (cur is None
                or cand["aemp"] < cur["aemp"]
                or (cand["aemp"] == cur["aemp"] and cand["pbs_code"] < cur["pbs_code"])):
            chosen[name.lower()] = cand
    return chosen


def _full_drug_index() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """(exact, salt-stripped-base) generic_name(lower) → drug, over ALL drugs.

    build_index() only targets drugs with >=1 shortage event — right for the
    catalogue backfill, but a trade price is just as useful for never-short
    molecules (abacavir, alendronate, …). Same DENY/combination guards apply.
    """
    from backend.importers.catalogue_inn_backfill import _get_all, COMBO, DENY, SALTS

    exact: dict[str, dict[str, Any]] = {}
    base: dict[str, dict[str, Any]] = {}
    for d in _get_all("drugs?select=id,generic_name&order=id"):
        gn = (d.get("generic_name") or "").strip().lower()
        if not gn or len(gn) < 4 or COMBO.search(gn) or gn in DENY:
            continue
        exact.setdefault(gn, d)
        words = gn.split()
        while len(words) > 1 and words[-1] in SALTS:
            words = words[:-1]
        stripped = " ".join(words)
        if stripped != gn and len(stripped) >= 4 and stripped not in DENY:
            base.setdefault(stripped, d)
    return exact, base


def resolve_drugs(names: dict[str, dict[str, Any]]) -> dict[str, str]:
    """name(lower) → drugs.id.

    Primary: the vetted longest-canonical-substring resolver (same path the
    eligibility scrapers use) — handles messy strings, refuses combination
    products it can't pin to ONE molecule (collapsing a combo to one
    ingredient would price the wrong thing). Fallback: exact / salt-stripped
    match over the full drugs table, since PBS drug_name is already a clean
    INN ("abacavir") while the primary index only covers shortage-linked rows.
    """
    from backend.importers.catalogue_inn_backfill import COMBO_NAME, build_index, make_resolver
    from backend.utils.inn_normalize import normalise

    phrase_index = None
    for attempt in range(3):
        try:
            phrase_index, max_words = build_index()
            if phrase_index:
                break
        except Exception as e:
            print(f"[PBS] build_index attempt {attempt + 1}/3 failed: {e}", flush=True)
            time.sleep(3 * (attempt + 1))
    if not phrase_index:
        raise RuntimeError("drug_id index could not be built; aborting (no partial writes)")
    resolve = make_resolver(phrase_index, max_words)
    exact, base = _full_drug_index()

    out: dict[str, str] = {}
    for key, cand in names.items():
        raw = cand["drug_name"]
        cleaned = normalise(raw).query or raw
        drug, _reason = resolve(cleaned)
        if not drug and not COMBO_NAME.search(raw) and "&" not in raw:  # PBS co-packs use "(&)"
            # Single-molecule name only — pricing a combo ("abiraterone (&)
            # methylprednisolone") as one ingredient would price the wrong thing.
            # "adrenaline (epinephrine)" → try whole, before-parens, in-parens.
            variants = [cleaned.lower().strip(), raw.lower().strip()]
            if "(" in raw:
                head, _, tail = raw.lower().partition("(")
                variants += [head.strip(), tail.rstrip(") ").strip()]
            for v in variants:
                hit = exact.get(v) or base.get(v)
                if hit:
                    drug = hit
                    break
        if drug:
            out[key] = drug["id"]
    return out


def previous_prices(supabase: Any, drug_ids: list[str], before: str) -> dict[str, dict[str, Any]]:
    """Latest existing AU row per drug strictly before this schedule date."""
    prev: dict[str, dict[str, Any]] = {}
    for i in range(0, len(drug_ids), 100):
        chunk = drug_ids[i:i + 100]
        try:
            res = (
                supabase.table("drug_pricing")
                .select("drug_id,price_amount,pack_size,price_date")
                .eq("country_code", "AU")
                .in_("drug_id", chunk)
                .lt("price_date", before)
                .order("price_date", desc=True)
                .execute()
            )
        except Exception as e:
            print(f"[PBS] previous-price lookup failed ({e}); trends skipped for chunk", flush=True)
            continue
        for row in res.data or []:
            prev.setdefault(row["drug_id"], row)  # first = latest
    return prev


def build_rows(resolved: dict[str, str], chosen: dict[str, dict[str, Any]],
               prev: dict[str, dict[str, Any]], price_date: str) -> list[dict[str, Any]]:
    # Several PBS drug_names can resolve to one molecule (salt variants):
    # keep the overall lowest AEMP per drug_id.
    per_drug: dict[str, dict[str, Any]] = {}
    for key, drug_id in resolved.items():
        cand = chosen[key]
        cur = per_drug.get(drug_id)
        if cur is None or cand["aemp"] < cur["aemp"]:
            per_drug[drug_id] = cand

    rows: list[dict[str, Any]] = []
    for drug_id, cand in per_drug.items():
        trend_ind, trend_pct = None, None
        p = prev.get(drug_id)
        # Trend is only meaningful against the SAME pack — the representative
        # presentation can change month to month.
        if p and p.get("price_amount") and p.get("pack_size") == cand["pack"]:
            old = float(p["price_amount"])
            if old > 0:
                pct = (cand["aemp"] - old) / old * 100.0
                trend_pct = round(pct, 2)
                trend_ind = "rising" if pct > 0.5 else "falling" if pct < -0.5 else "stable"
        rows.append({
            "id": str(uuid.uuid5(PBS_UUID_NS, f"pbs|AU|{drug_id}|{price_date}")),
            "drug_id": drug_id,
            "country": "Australia",
            "country_code": "AU",
            "price_amount": cand["aemp"],
            "dispensed_amount": cand["dpmq"],
            "currency": "AUD",
            "price_per": "pack",
            "pack_size": cand["pack"],
            "price_date": price_date,
            "source": "PBS",
            "trend_indicator": trend_ind,
            "trend_percentage": trend_pct,
        })
    return rows


def upsert_batches(supabase: Any, rows: list[dict[str, Any]], size: int = 500) -> int:
    if not rows:
        return 0
    if DRY_RUN:
        print(f"  [DRY RUN] would upsert {len(rows)} rows; first: {rows[0]}", flush=True)
        return len(rows)
    total = 0
    drop_dispensed = False
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        if drop_dispensed:
            chunk = [{k: v for k, v in r.items() if k != "dispensed_amount"} for r in chunk]
        try:
            res = supabase.table("drug_pricing").upsert(chunk, on_conflict="id").execute()
        except httpx.HTTPStatusError as e:
            # Migration 055 not applied yet (manual dashboard step): land the
            # AEMP side rather than nothing; DPMQ fills on the next run after
            # the column exists. The column name is only in the PostgREST body.
            body = e.response.text if e.response is not None else str(e)
            if "dispensed_amount" in body and not drop_dispensed:
                print("[PBS] WARNING dispensed_amount column missing (migration 055 pending) — "
                      "writing AEMP-only rows; re-run after applying 055 to fill DPMQ", flush=True)
                drop_dispensed = True
                chunk = [{k: v for k, v in r.items() if k != "dispensed_amount"} for r in chunk]
                res = supabase.table("drug_pricing").upsert(chunk, on_conflict="id").execute()
            else:
                raise
        total += len(res.data or [])
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schedule-code", type=int, default=None,
                    help="Pin a schedule (default: latest published, in effect)")
    ap.add_argument("--max-pages", type=int, default=None,
                    help="Cap item-overview pages (smoke testing)")
    args = ap.parse_args()

    headers = {"subscription-key": SUBSCRIPTION_KEY, "User-Agent": USER_AGENT}
    with httpx.Client(timeout=TIMEOUT, headers=headers) as client:
        if args.schedule_code:
            schedule_code, effective = args.schedule_code, None
            payload = _get(client, "schedules", {"schedule_code": schedule_code, "limit": 1})
            data = payload.get("data") or []
            if not data:
                print(f"[PBS] schedule {schedule_code} not found", flush=True)
                return 1
            effective = str(data[0]["effective_date"])
            time.sleep(PACE_SECONDS)
        else:
            schedule_code, effective = latest_schedule(client)
            time.sleep(PACE_SECONDS)
        print(f"[PBS] schedule {schedule_code} effective {effective}", flush=True)

        items = fetch_items(client, schedule_code, args.max_pages)
    print(f"[PBS] fetched {len(items)} schedule items", flush=True)
    if not items:
        print("[PBS] no items — abort", flush=True)
        return 1

    chosen = pick_representative(items)
    priced = sum(1 for c in chosen.values() if c["dpmq"] is not None)
    print(f"[PBS] {len(chosen)} distinct drug names ({priced} with a community-pharmacy DPMQ)", flush=True)

    resolved = resolve_drugs(chosen)
    print(f"[PBS] resolved {len(resolved)}/{len(chosen)} names to canonical drugs", flush=True)
    unresolved = sorted(k for k in chosen if k not in resolved)
    if unresolved:
        print(f"[PBS] unresolved sample (combos refuse by design): {unresolved[:15]}", flush=True)
    if not resolved:
        print("[PBS] nothing resolved — abort (no writes)", flush=True)
        return 1

    supabase = get_supabase_client()
    prev = {} if DRY_RUN else previous_prices(supabase, sorted(set(resolved.values())), effective)
    rows = build_rows(resolved, chosen, prev, effective)
    written = upsert_batches(supabase, rows)
    print(f"[PBS] Upserted {written} drug_pricing rows for {effective}  ✓", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
