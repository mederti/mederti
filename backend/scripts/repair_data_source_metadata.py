#!/usr/bin/env python3
"""
Repair data_sources metadata corruption (discovered 2026-09-28).

Three defects, all traced to an import that wrote columns by POSITION rather
than by id, plus one flag that was never maintained:

  1. `abbreviation` — ten recall/secondary sources carry another source's
     abbreviation (Spain's AEMPS recall feed was labelled "RxNorm"). Anything
     that labels a source by abbreviation mis-attributes the regulator.
  2. `country_code` — two rows carry the wrong country (Health Canada's recall
     feed tagged NZ; EMA's withdrawal feed tagged US).
  3. `is_active=false` on eight sources holding 62,000+ live rows — including
     PMDA (37,138 shortage rows, the largest country dataset) and the FDA full
     recall database (17,916 recalls, 71% of the recall corpus). Any surface
     that filters on is_active hides them.

Deliberately NOT flipped: BfArM Recalls and HSA Recalls (0 rows, stale 125d /
89d) and MFDS + NAFDAC (scraping daily, writing nothing). Those are broken
scrapers, not mislabelled flags — activating them would manufacture the
appearance of coverage that does not exist.

Run with --apply to write. Default is a dry run.
"""
import os, sys, json, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
APPLY = "--apply" in sys.argv

def req(method, path, body=None):
    r = urllib.request.Request(
        f"{URL}/rest/v1/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []

# name -> {column: correct value}. Keyed by name so every fix is auditable
# against the table itself.
FIXES = {
    "AEMPS — Drug Recalls (Spain)":                {"abbreviation": "AEMPS Recalls",   "is_active": True},
    "AIFA — Drug Recalls (Italy)":                 {"abbreviation": "AIFA Recalls",    "is_active": True},
    "ANSM — Rappels de Lots (France)":             {"abbreviation": "ANSM Recalls",    "is_active": True},
    "BfArM — Drug Recalls (Germany)":              {"abbreviation": "BfArM Recalls"},
    "EMA — Withdrawn Medicines & Recalls":         {"abbreviation": "EMA Recalls",     "country_code": "EU"},
    "FDA Drug Enforcement — Full Recall Database": {"abbreviation": "FDA Recalls",     "is_active": True},
    "Health Canada — Recalls and Safety Alerts":   {"abbreviation": "HC Recalls",      "country_code": "CA", "is_active": True},
    "HSA — Drug Recalls (Singapore)":              {"abbreviation": "HSA Recalls"},
    "Medsafe — Product Recalls (New Zealand)":     {"abbreviation": "Medsafe Recalls", "is_active": True},
    "MHRA — Drug Alerts & Recalls (UK)":           {"abbreviation": "MHRA Recalls",    "is_active": True},
    "PMDA — Pharmaceuticals and Medical Devices Agency": {"is_active": True},
}

rows = req("GET", "data_sources?select=id,name,abbreviation,country_code,is_active&limit=200")
by_name = {r["name"]: r for r in rows}

print(f"{'DRY RUN — no writes' if not APPLY else 'APPLYING'}\n")
plan = []
for name, patch in FIXES.items():
    r = by_name.get(name)
    if not r:
        print(f"  !! row not found: {name}")
        continue
    delta = {k: v for k, v in patch.items() if r.get(k) != v}
    if not delta:
        print(f"  ok   {name[:56]:<58} already correct")
        continue
    shown = ", ".join(f"{k}: {r.get(k)!r} -> {v!r}" for k, v in delta.items())
    print(f"  FIX  {name[:56]:<58} {shown}")
    plan.append((r["id"], name, delta))

print(f"\n── {len(plan)} row(s) to patch ──")
if not APPLY:
    print("\nRe-run with --apply to write.")
    sys.exit(0)

# Verify one representative row lands before doing the rest.
rid, name, delta = plan[0]
req("PATCH", f"data_sources?id=eq.{rid}", delta)
after = req("GET", f"data_sources?select=name,abbreviation,country_code,is_active&id=eq.{rid}")[0]
for k, v in delta.items():
    assert after[k] == v, f"probe write did not stick on {k} — aborting before batch"
print(f"\n  probe OK: {name[:50]} -> {delta}")
for rid, name, delta in plan[1:]:
    req("PATCH", f"data_sources?id=eq.{rid}", delta)
    print(f"  patched: {name[:56]}")

# Re-read and confirm nothing is left.
rows = req("GET", "data_sources?select=id,name,abbreviation,country_code,is_active&limit=200")
by_name = {r["name"]: r for r in rows}
left = [n for n, p in FIXES.items() if n in by_name
        and any(by_name[n].get(k) != v for k, v in p.items())]
print(f"\n  remaining unfixed: {len(left)} {left}")
print(f"  active sources now: {len([r for r in rows if r['is_active']])} / {len(rows)}")
