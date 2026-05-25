"""
PharmaCompass API Supplier Summary Importer (Path A — 3/3)
──────────────────────────────────────────────────────────
For every drug in Mederti's catalogue, fetch the corresponding
PharmaCompass active-pharmaceutical-ingredient page and record the
aggregate supplier counts (total suppliers, USDMF, CEP/COS, EU WC, etc.).

Why this matters
────────────────
The single biggest gap in Mederti's drug pages today is supplier-side
intel. A pharmacist sees a shortage and an alternative, but never
sees how *concentrated* the global manufacturing base is — i.e. whether
the shortage is structurally fragile (2 makers) or accidental (180).

PharmaCompass exposes API supplier directories publicly. We extract
the aggregate counts only (not individual maker rows, which often sit
behind their commercial wall), populate the new `api_supply_summary`
table, and the `v_drug_manufacturer_concentration` view falls back to
these counts to compute a concentration risk band per drug.

Source
──────
https://www.pharmacompass.com/active-pharmaceutical-ingredients/{slug}
Slugged with hyphens, lowercased.

Usage
─────
    python3 -m backend.importers.pharmacompass_importer              # all drugs
    python3 -m backend.importers.pharmacompass_importer --limit 100  # smoke test
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.pharmacompass_importer

Cadence
───────
Quarterly (manufacturer base changes slowly). Idempotent — upserts on
api_name_normalized.

Notes
─────
We do not redistribute PharmaCompass content. We store only the
aggregate count integers (no proprietary text) and link back to the
source URL.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from typing import Any

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402


BASE_URL = "https://www.pharmacompass.com/active-pharmaceutical-ingredients/"
USER_AGENT = "Mederti-Importer/1.0 (https://mederti.com; drug-shortage-intelligence)"
RATE_LIMIT = 2.0   # be generous — they don't owe us this
TIMEOUT = 30.0

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"


# Regex for each count label on a PharmaCompass API page
COUNT_PATTERNS: dict[str, re.Pattern[str]] = {
    "total_suppliers":      re.compile(r"(\d[\d,]*)\s*API Suppliers", re.IGNORECASE),
    "usdmf_count":          re.compile(r"(\d[\d,]*)\s*USDMF",          re.IGNORECASE),
    "cep_count":            re.compile(r"(\d[\d,]*)\s*CEP[/\\]COS",    re.IGNORECASE),
    "jdmf_count":           re.compile(r"(\d[\d,]*)\s*JDMF",           re.IGNORECASE),
    "kdmf_count":           re.compile(r"(\d[\d,]*)\s*KDMF",           re.IGNORECASE),
    "eu_wc_count":          re.compile(r"(\d[\d,]*)\s*EU\s*WC",        re.IGNORECASE),
    "ndc_count":            re.compile(r"(\d[\d,]*)\s*NDC\s*API",      re.IGNORECASE),
    "drugs_in_development": re.compile(r"(\d[\d,]*)\s*Drugs in Development", re.IGNORECASE),
}


def slugify(name: str) -> str:
    """PharmaCompass URL slug: lowercase, hyphenated, ASCII only."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def fetch_api_page(slug: str) -> str | None:
    """Fetch one PharmaCompass API page; None on 404 or non-API page."""
    url = f"{BASE_URL}{slug}"
    try:
        with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT},
                          follow_redirects=True) as c:
            r = c.get(url)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
    except httpx.HTTPError as e:
        print(f"  ! fetch failed for {slug}: {e}", flush=True)
        return None


def parse_counts(html: str) -> dict[str, int] | None:
    """Extract aggregate counts from a PharmaCompass API page."""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    counts: dict[str, int] = {}
    for field, pattern in COUNT_PATTERNS.items():
        m = pattern.search(text)
        if m:
            try:
                counts[field] = int(m.group(1).replace(",", ""))
            except ValueError:
                pass

    # Sanity check: a real API page has at least "API Suppliers" count
    if "total_suppliers" not in counts:
        return None
    return counts


def fetch_drugs(supabase: Any, limit: int | None = None) -> list[dict[str, Any]]:
    """Pull the deduped list of generic names from drugs table."""
    print("[PharmaCompass] Loading drug catalogue…", flush=True)
    drugs: list[dict[str, Any]] = []
    offset = 0
    PAGE = 1000
    while True:
        page = (
            supabase.table("drugs")
            .select("id, generic_name")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data or []
        )
        drugs.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE

    # Dedupe by lowercased generic_name
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for d in drugs:
        n = (d.get("generic_name") or "").strip().lower()
        if not n or n in seen:
            continue
        seen.add(n)
        deduped.append(d)

    print(f"[PharmaCompass] {len(deduped)} unique generic names "
          f"({len(drugs)} drug rows)", flush=True)

    # Filter to ones we haven't ingested yet
    done_offset = 0
    done: set[str] = set()
    while True:
        page = (
            supabase.table("api_supply_summary")
            .select("api_name_normalized")
            .range(done_offset, done_offset + PAGE - 1)
            .execute()
            .data or []
        )
        for r in page:
            done.add(r["api_name_normalized"])
        if len(page) < PAGE:
            break
        done_offset += PAGE

    pending = [d for d in deduped if d["generic_name"].strip().lower() not in done]
    print(f"[PharmaCompass] {len(pending)} APIs need fetching "
          f"({len(done)} already done)", flush=True)
    if limit:
        pending = pending[:limit]
        print(f"[PharmaCompass] --limit {limit} → processing {len(pending)}", flush=True)
    return pending


def upsert_batch(supabase: Any, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    if DRY_RUN:
        print(f"  [DRY RUN] would upsert {len(rows)}; first: {rows[0]}", flush=True)
        return len(rows)
    res = supabase.table("api_supply_summary").upsert(
        rows, on_conflict="api_name_normalized"
    ).execute()
    return len(res.data or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--flush-every", type=int, default=25)
    args = ap.parse_args()

    supabase = get_supabase_client()
    pending = fetch_drugs(supabase, limit=args.limit)
    if not pending:
        print("[PharmaCompass] Nothing to do ✓", flush=True)
        return 0

    matched = 0
    unresolved = 0
    buffer: list[dict[str, Any]] = []

    for i, drug in enumerate(pending, start=1):
        gname = drug["generic_name"].strip()
        slug = slugify(gname)
        html = fetch_api_page(slug)
        time.sleep(RATE_LIMIT)

        if html is None:
            unresolved += 1
        else:
            counts = parse_counts(html)
            if counts is None:
                unresolved += 1
            else:
                row = {
                    "api_name_normalized": gname.lower(),
                    "api_name_display":    gname,
                    "source_url":          f"{BASE_URL}{slug}",
                    **counts,
                }
                buffer.append(row)
                matched += 1
                if len(buffer) >= args.flush_every:
                    upsert_batch(supabase, buffer)
                    buffer.clear()

        if i % 10 == 0:
            print(f"  …{i}/{len(pending)}  matched={matched}  unresolved={unresolved}",
                  flush=True)

    if buffer:
        upsert_batch(supabase, buffer)

    print(f"[PharmaCompass] Done ✓  matched={matched}  unresolved={unresolved}",
          flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
