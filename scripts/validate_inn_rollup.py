"""
Validation harness for INN resolution — shows the BEFORE/AFTER molecule rollup
for a set of name patterns, using live RxNorm/UNII resolution and live shortage
counts. Read-only: it resolves and aggregates in-memory exactly as the
inn_resolution importer would persist (grouping key = resolved UNII).

Usage:
  python3 -m scripts.validate_inn_rollup atorvastatin heparin obinutuzumab
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict

import httpx

from backend.importers.substance_resolver import resolve

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# Molecule → list of generic_name_normalised ilike probes. Brand-divergent
# molecules need every brand spelling probed because brands are often stored as
# their own `drugs` rows, not in brand_names_text.
PROBES = {
    "atorvastatin": ["atorvastatin*", "atorvastatina*"],
    "heparin": ["heparin*"],
    "obinutuzumab": ["obinutuzumab*", "gazyva*", "gazyvaro*"],
}


def get(path: str, **params) -> list[dict]:
    r = httpx.get(f"{URL}/rest/v1/{path}", params=params, headers=H, timeout=40)
    r.raise_for_status()
    return r.json()


def active_count(drug_id: str) -> int:
    r = httpx.get(
        f"{URL}/rest/v1/shortage_events",
        params={"select": "id", "drug_id": f"eq.{drug_id}", "status": "eq.active"},
        headers={**H, "Prefer": "count=exact"}, timeout=40,
    )
    return int(r.headers.get("content-range", "*/0").split("/")[-1])


def total_count(drug_id: str) -> int:
    r = httpx.get(
        f"{URL}/rest/v1/shortage_events",
        params={"select": "id", "drug_id": f"eq.{drug_id}"},
        headers={**H, "Prefer": "count=exact"}, timeout=40,
    )
    return int(r.headers.get("content-range", "*/0").split("/")[-1])


def collect_rows(molecule: str) -> list[dict]:
    cols = "id,generic_name,brand_names,rxcui,unii,atc_code"
    seen, rows = set(), []
    for pat in PROBES[molecule]:
        for params in [
            {"select": cols, "generic_name_normalised": f"ilike.{pat}", "order": "generic_name", "limit": "200"},
            {"select": cols, "brand_names_text": f"ilike.*{pat.strip('*')}*", "limit": "200"},
        ]:
            for d in get("drugs", **params):
                if d["id"] not in seen:
                    seen.add(d["id"])
                    rows.append(d)
    return rows


def run(molecule: str) -> None:
    rows = collect_rows(molecule)
    print(f"\n{'='*100}\nMOLECULE PROBE: {molecule}   ({len(rows)} candidate drug rows)\n{'='*100}")

    # BEFORE — each row stands alone; shortages fragmented across them.
    print("\nBEFORE (current state — one drug row per spelling, identifiers mostly null):")
    print(f"  {'generic_name':58} {'active':>6} {'total':>6}  unii")
    before_active = 0
    for d in sorted(rows, key=lambda x: x["generic_name"]):
        a, t = active_count(d["id"]), total_count(d["id"])
        before_active += a
        print(f"  {d['generic_name'][:58]:58} {a:>6} {t:>6}  {d.get('unii') or '—'}")

    # AFTER — resolve each row and regroup by resolved UNII (molecule identity).
    groups: dict[str, list[tuple[dict, object]]] = defaultdict(list)
    unresolved: list[dict] = []
    for d in rows:
        r = resolve(d["generic_name"])
        key = r.unii or (f"inn:{r.inn}" if r.inn else None)
        if key and r.confidence == "high":
            groups[key].append((d, r))
        else:
            unresolved.append(d)

    print("\nAFTER (resolved → grouped by UNII; one molecule, shortages rolled up):")
    for key, members in sorted(groups.items(), key=lambda kv: -sum(active_count(m[0]["id"]) for m in kv[1])):
        any_r = members[0][1]
        roll_active = sum(active_count(m[0]["id"]) for m in members)
        roll_total = sum(total_count(m[0]["id"]) for m in members)
        names = ", ".join(sorted({m[0]["generic_name"] for m in members}))
        brands = sorted({b for m in members for b in (m[0].get("brand_names") or [])})
        print(f"\n  ▸ MOLECULE: {any_r.inn}   UNII={any_r.unii}  RxCUI={any_r.base_rxcui}  ATC={any_r.atc}")
        print(f"      rolled-up shortages:  active={roll_active}   total={roll_total}   "
              f"(was split across {len(members)} rows)")
        print(f"      folded variant rows:  {names}")
        if brands:
            print(f"      brand names folded in: {', '.join(brands[:12])}{' …' if len(brands)>12 else ''}")

    if unresolved:
        print("\n  ⚠ ROUTED TO REVIEW QUEUE (not auto-rolled — combo/no-RxCUI/low-confidence):")
        for d in unresolved:
            r = resolve(d["generic_name"])
            print(f"      {d['generic_name'][:70]:70}  inn={r.inn or '—'} conf={r.confidence} reason={r.reason}")


if __name__ == "__main__":
    for m in sys.argv[1:] or list(PROBES):
        run(m)
