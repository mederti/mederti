#!/usr/bin/env python3
"""
Import RxNorm RxCUI codes into the drugs table.

RxNorm is the U.S. National Library of Medicine's canonical drug nomenclature.
Every clinical IT system in the U.S. (EHRs, e-prescribing, FHIR APIs) uses it.
Linking our drugs to RxCUIs makes Mederti interoperable with any U.S.
healthcare system.

We use the public RxNav REST API (rate-limited to ~20 rps, no auth needed):
    https://lhncbc.nlm.nih.gov/RxNav/APIs/

Strategy
--------
For each drug in our catalogue without an rxcui, query
    /REST/rxcui.json?name=<generic_name>&search=2
    (search=2 = "approximate match", falls back to normalized then SAB)

If a single best match comes back, write rxcui to drugs.

Usage:
    python3 scripts/import_rxnorm.py                # full pass
    python3 scripts/import_rxnorm.py --limit 200    # sample
    python3 scripts/import_rxnorm.py --refresh      # re-check drugs that already have rxcui
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

import requests
from supabase import create_client


RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST"


def find_rxcui(generic_name: str, session: requests.Session) -> Optional[str]:
    """Best-effort lookup. Returns RxCUI string or None."""
    name = generic_name.strip()
    if not name:
        return None

    # Step 1: exact name match
    try:
        r = session.get(
            f"{RXNAV_BASE}/rxcui.json",
            params={"name": name, "search": 2},
            timeout=10,
        )
        if r.ok:
            data = r.json()
            ids = (data.get("idGroup") or {}).get("rxnormId") or []
            if ids:
                return ids[0]
    except Exception:
        pass

    # Step 2: approximate term match (fuzzy)
    try:
        r = session.get(
            f"{RXNAV_BASE}/approximateTerm.json",
            params={"term": name, "maxEntries": 1, "option": 0},
            timeout=10,
        )
        if r.ok:
            data = r.json()
            cands = (data.get("approximateGroup") or {}).get("candidate") or []
            if cands:
                # Only accept if it's a high-quality match (score >= 80)
                top = cands[0]
                score = int(top.get("score", 0))
                if score >= 80 and top.get("rxcui"):
                    return top["rxcui"]
    except Exception:
        pass

    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Cap drugs processed (0 = all)")
    ap.add_argument("--refresh", action="store_true", help="Re-check drugs that already have an rxcui")
    ap.add_argument("--sleep", type=float, default=0.05, help="Seconds between API calls (rate limit)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    s = create_client(url, key)

    # Fetch drugs without an RxCUI (paginated through Supabase 1k limit)
    drugs: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        q = s.table("drugs").select("id, generic_name, rxcui").order("generic_name")
        if not args.refresh:
            q = q.is_("rxcui", "null")
        res = q.range(offset, offset + page_size - 1).execute()
        rows = res.data or []
        drugs.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    if args.limit:
        drugs = drugs[: args.limit]

    print(f"RxNorm import: {len(drugs)} drugs to check")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mederti/1.0 (rxnorm-import)"})

    matched = 0
    miss = 0
    for i, d in enumerate(drugs, 1):
        name = d.get("generic_name") or ""
        if not name:
            miss += 1
            continue

        rxcui = find_rxcui(name, session)
        if rxcui:
            try:
                s.table("drugs").update({"rxcui": rxcui}).eq("id", d["id"]).execute()
                matched += 1
            except Exception as e:
                print(f"  ! update failed for {name}: {e}", file=sys.stderr)
        else:
            miss += 1

        if i % 50 == 0:
            pct = (matched / i) * 100
            print(f"  {i}/{len(drugs)}  matched={matched} ({pct:.0f}%)  miss={miss}")

        time.sleep(args.sleep)

    print(f"\n✅ RxNorm import done — matched {matched}/{len(drugs)} drugs ({matched / max(len(drugs),1) * 100:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
