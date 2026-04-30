#!/usr/bin/env python3
"""
OECD pharmaceutical pricing import.

Source: OECD.Stat — Pharmaceutical Market dataset
        https://stats.oecd.org/SDMX-JSON/data/HEALTH_PHMC/<filter>/all
        Documentation: https://data-explorer.oecd.org/

OECD publishes the only consistent cross-country pharmaceutical pricing
benchmark globally — pharmaceutical expenditure and consumption per
capita, broken down by ATC class. We use it to populate
drug_pricing_history with country-level reference points.

We pull the "PHMC" (Pharmaceutical Market) dataset for the latest year
across OECD countries, expenditure variable, in PPP (purchasing power
parity) USD so prices are directly comparable across countries.

Granularity: country-level totals, not per-drug. We use this as a
backdrop comparator — the per-drug NHS Drug Tariff and supplier
inventory still drive the live shortage and quote intelligence.

Usage:
    python3 scripts/import_oecd_pricing.py
    python3 scripts/import_oecd_pricing.py --year 2022
"""
from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys
from typing import Any

import requests
from supabase import create_client


SDMX_BASE = "https://sdmx.oecd.org/public/rest/data"
# Pharmaceutical market — Key Indicators dataflow (current as of 2026):
# https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.ELS.HD&df%5Bid%5D=HEALTH_PHMC%40DF_KEY_INDIC
DATAFLOW = "OECD.ELS.HD,HEALTH_PHMC@DF_KEY_INDIC,1.0"


def fetch_oecd(session: requests.Session, year: int) -> dict[str, Any]:
    """Pull the OECD JSON-stat response for the given year."""
    url = (
        f"{SDMX_BASE}/{DATAFLOW}/all"
        f"?startPeriod={year}&endPeriod={year}&dimensionAtObservation=AllDimensions"
        f"&format=jsondata"
    )
    r = session.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def parse_observations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    OECD now wraps SDMX-JSON under `data.*`:
        payload['data']['dataSets'][0]
        payload['data']['structures'][0]['dimensions']['observation']
    Older API path put it at the top level — we handle both.
    """
    root = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    try:
        ds = root["dataSets"][0]
        # 'structures' (new) or 'structure' (old)
        if "structures" in root:
            struct = root["structures"][0]["dimensions"]["observation"]
        else:
            struct = root["structure"]["dimensions"]["observation"]
    except (KeyError, IndexError):
        return []

    dims = [{"id": d["id"], "values": d.get("values", [])} for d in struct]

    out: list[dict[str, Any]] = []
    obs = ds.get("observations") or {}
    for key_str, vals in obs.items():
        idxs = [int(x) for x in key_str.split(":")]
        row: dict[str, Any] = {}
        for dim, idx in zip(dims, idxs):
            try:
                v = dim["values"][idx]
                row[dim["id"]] = v.get("id")
                row[f"{dim['id']}_label"] = v.get("name", v.get("id"))
            except (IndexError, AttributeError):
                row[dim["id"]] = None
        if vals and len(vals) > 0:
            row["value"] = vals[0]
        out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=_dt.date.today().year - 2,
                    help="Target year (OECD usually lags 2 years; default %(default)s)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    s = create_client(url, key) if not args.dry_run else None
    session = requests.Session()
    session.headers.update({
        "Accept": "application/vnd.sdmx.data+json;version=1.0.0",
        "User-Agent": "Mederti/1.0 (oecd-pricing-import)",
    })

    print(f"OECD pharmaceutical market — fetching {args.year}…")
    try:
        payload = fetch_oecd(session, args.year)
    except Exception as e:
        print(f"OECD fetch failed: {e}", file=sys.stderr)
        # Try the previous year
        try:
            print(f"  retry with {args.year - 1}…")
            payload = fetch_oecd(session, args.year - 1)
        except Exception as e2:
            print(f"OECD fetch failed twice: {e2}", file=sys.stderr)
            return 2

    rows = parse_observations(payload)
    print(f"Parsed {len(rows)} observations")

    inserted = 0
    skipped = 0
    for r in rows:
        country = r.get("REF_AREA")
        value = r.get("value")
        if not country or value in (None, ""):
            skipped += 1
            continue

        # Map ISO-3 (OECD) → ISO-2 where we can; fall back to ISO-3.
        country_iso2 = ISO3_TO_ISO2.get(country, country[:2])

        record = {
            "country": country_iso2,
            "authority": "OECD",
            "price_type": "list",
            "category": r.get("MEASURE_label") or r.get("MEASURE"),
            "unit_price": None,
            "currency": r.get("UNIT_MEASURE") or "USD-PPP",
            "pack_price": float(value) if isinstance(value, (int, float)) else None,
            "effective_date": f"{args.year}-01-01",
            "expires_date": f"{args.year}-12-31",
            "source": "oecd_phmc",
            "source_url": "https://stats.oecd.org/Index.aspx?DataSetCode=HEALTH_PHMC",
            "raw_data": r,
        }

        if args.dry_run:
            inserted += 1
            continue

        try:
            s.table("drug_pricing_history").insert(record).execute()
            inserted += 1
        except Exception as e:
            skipped += 1
            print(f"  ! insert failed for {country}: {e}", file=sys.stderr)

    print(f"\n✅ OECD import done — inserted {inserted}, skipped {skipped}")
    return 0


# Minimal ISO-3 → ISO-2 mapping for OECD member countries
ISO3_TO_ISO2 = {
    "AUS": "AU", "AUT": "AT", "BEL": "BE", "CAN": "CA", "CHE": "CH",
    "CHL": "CL", "COL": "CO", "CRI": "CR", "CZE": "CZ", "DEU": "DE",
    "DNK": "DK", "ESP": "ES", "EST": "EE", "FIN": "FI", "FRA": "FR",
    "GBR": "GB", "GRC": "GR", "HUN": "HU", "IRL": "IE", "ISL": "IS",
    "ISR": "IL", "ITA": "IT", "JPN": "JP", "KOR": "KR", "LTU": "LT",
    "LUX": "LU", "LVA": "LV", "MEX": "MX", "NLD": "NL", "NOR": "NO",
    "NZL": "NZ", "POL": "PL", "PRT": "PT", "SVK": "SK", "SVN": "SI",
    "SWE": "SE", "TUR": "TR", "USA": "US",
}


if __name__ == "__main__":
    sys.exit(main())
