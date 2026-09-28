#!/usr/bin/env python3
"""
Repair data_sources metadata corruption (discovered 2026-09-28).

Ten importer definitions (RxNorm, PBS Schedule, NHS Drug Tariff, WHO EML, FDA
MedWatch, ANSM Ruptures, Medsafe NZ Full, ANVISA, ATC/DDD, FDA Orange Book) were
written INTO ten existing recall-source rows instead of being inserted as new
rows — an import that addressed rows by POSITION rather than by id. Each victim
row kept its own `name` but took the intruder's `abbreviation` and `source_url`,
and two also took the wrong `country_code`. A fourth, unrelated defect is an
`is_active` flag that was never maintained.

  1. `abbreviation` — ten sources carry another source's abbreviation. Spain's
     AEMPS recall feed is labelled "RxNorm". Anything that labels a source by
     abbreviation mis-attributes the regulator.
  2. `source_url` — the same ten carry the intruder's URL, so a "view source"
     link on Spain's recall feed sends the user to RxNorm's API and the UK's
     MHRA recall feed points at the FDA Orange Book. Restored from each
     scraper's own BASE_URL, which is the authoritative value.
  3. `country_code` — Health Canada's recall feed is tagged NZ; EMA's
     withdrawal feed is tagged US.
  4. `is_active=false` on eight sources holding 62,000+ live rows — including
     PMDA (37,138 shortage rows, the largest country dataset) and the FDA full
     recall database (17,916 recalls, 71% of the recall corpus). Any surface
     filtering on is_active hides them entirely.

Deliberately NOT activated: BfArM Recalls and HSA Recalls (0 rows, stale 125d /
89d), and MFDS + NAFDAC (scraping daily, writing nothing). Those are broken
scrapers, not mislabelled flags — activating them would manufacture the
appearance of coverage that does not exist. Their labels are still corrected.

Run with --apply to write. Default is a dry run. --apply verifies one probe row
lands before touching the rest.
"""
import os
import sys
import json
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
APPLY = "--apply" in sys.argv

SELECT = "data_sources?select=id,name,abbreviation,country_code,is_active,source_url&limit=200"


def req(method: str, path: str, body=None):
    r = urllib.request.Request(
        f"{URL}/rest/v1/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []


# Keyed by each row's own `name` — the one column the corruption left intact —
# so every fix is auditable against the table itself.
FIXES: dict[str, dict] = {
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

# Lifted from each matching scraper's own BASE_URL rather than reconstructed by
# hand. Merged into FIXES so the dict above stays readable.
SOURCE_URLS = {
    "AEMPS — Drug Recalls (Spain)":                "https://cima.aemps.es/cima/publico/lista.html",
    "AIFA — Drug Recalls (Italy)":                 "https://www.aifa.gov.it/en/difetti-di-qualit%C3%A01",
    "ANSM — Rappels de Lots (France)":             "https://ansm.sante.fr/informations-de-securite/",
    "BfArM — Drug Recalls (Germany)":              "https://www.pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html",
    "EMA — Withdrawn Medicines & Recalls":         "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx",
    "FDA Drug Enforcement — Full Recall Database": "https://api.fda.gov/drug/enforcement.json",
    "Health Canada — Recalls and Safety Alerts":   "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json",
    "HSA — Drug Recalls (Singapore)":              "https://www.hsa.gov.sg/announcements/safety-alerts-and-product-recalls",
    "Medsafe — Product Recalls (New Zealand)":     "https://www.medsafe.govt.nz/hot/recalls/RecallSearch.asp",
    "MHRA — Drug Alerts & Recalls (UK)":           "https://www.gov.uk/drug-device-alerts.atom",
}
for _name, _url in SOURCE_URLS.items():
    FIXES.setdefault(_name, {})["source_url"] = _url


def summarise(row: dict, delta: dict) -> str:
    parts = []
    for k, v in delta.items():
        before = row.get(k)
        if k == "source_url":
            # URLs are long; the host is what makes the defect obvious.
            def host(u):
                return (u or "").split("//")[-1].split("/")[0] or "—"
            parts.append(f"source_url host: {host(before)} -> {host(v)}")
        else:
            parts.append(f"{k}: {before!r} -> {v!r}")
    return ", ".join(parts)


def main() -> int:
    rows = req("GET", SELECT)
    by_name = {r["name"]: r for r in rows}

    print("DRY RUN — no writes\n" if not APPLY else "APPLYING\n")

    plan = []
    for name, patch in FIXES.items():
        row = by_name.get(name)
        if row is None:
            print(f"  !!   row not found, skipping: {name}")
            continue
        delta = {k: v for k, v in patch.items() if row.get(k) != v}
        if not delta:
            print(f"  ok   {name[:56]:<58} already correct")
            continue
        print(f"  FIX  {name[:56]:<58} {summarise(row, delta)}")
        plan.append((row["id"], name, delta))

    print(f"\n── {len(plan)} row(s) to patch ──")
    if not APPLY:
        print("\nRe-run with --apply to write.")
        return 0
    if not plan:
        print("\nNothing to do.")
        return 0

    # Probe one row first: if a write silently does not stick, stop before the
    # batch rather than after it.
    rid, name, delta = plan[0]
    req("PATCH", f"data_sources?id=eq.{rid}", delta)
    after = req("GET", f"{SELECT}&id=eq.{rid}")[0]
    for k, v in delta.items():
        if after.get(k) != v:
            print(f"\n  ABORT: probe write did not stick on {k} for {name}")
            return 1
    print(f"\n  probe OK: {name[:52]}")

    for rid, name, delta in plan[1:]:
        req("PATCH", f"data_sources?id=eq.{rid}", delta)
        print(f"  patched: {name[:60]}")

    # Re-read and confirm nothing is left behind.
    rows = req("GET", SELECT)
    by_name = {r["name"]: r for r in rows}
    left = [
        n for n, patch in FIXES.items()
        if n in by_name and any(by_name[n].get(k) != v for k, v in patch.items())
    ]
    print(f"\n  remaining unfixed: {len(left)}" + (f" {left}" if left else ""))
    print(f"  active sources now: {len([r for r in rows if r['is_active']])} / {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
