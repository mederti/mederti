"""
OECD Pharmaceutical Market Importer (Path B — 1/2)
──────────────────────────────────────────────────
Source: OECD Health Statistics, dataset HEALTH_PHMC
URL:    https://stats.oecd.org/SDMX-JSON/data/HEALTH_PHMC/all/all

Pulls the per-country × ATC-class × year pharmaceutical market data:
  • Pharmaceutical sales  (national currency, USD exch, USD PPP per capita, …)
  • Pharmaceutical consumption
  • Share of generics

The OECD dataset covers 52 countries from 1980 onwards across 37
pharmaceutical categories (ATC levels 1–3) plus the totals.

Why this matters
────────────────
Until commercial wholesaler feeds (Sigma · Symbion AU, Alliance EU, etc.)
are connected, we have no per-drug trade pricing. OECD HEALTH_PHMC gives
us the next-best thing: per-ATC-class spending per capita per country
per year. The Procurement view consumes this via the new
`v_country_pharma_spend_latest` and `v_drug_oecd_class_spend` views to
contextualise a drug's market size.

Usage
─────
    python3 -m backend.importers.oecd_pharma_importer
    python3 -m backend.importers.oecd_pharma_importer --since 2020
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.oecd_pharma_importer

Cadence
───────
Annual — OECD refreshes HEALTH_PHMC each year in Q3/Q4. Idempotent on
the (country, year, atc_code, measure, unit, market_type) unique key.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402


OECD_URL = "https://stats.oecd.org/SDMX-JSON/data/HEALTH_PHMC/all/all"
USER_AGENT = "Mederti-Importer/1.0 (https://mederti.com; drug-shortage-intelligence)"
TIMEOUT = 120.0

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"

# OECD uses ISO alpha-3 country codes. Map to alpha-2 so we can JOIN with
# Mederti's existing country_code columns. (Only OECD members + a few
# accession countries; missing entries fall back to NULL alpha-2.)
ISO3_TO_ISO2: dict[str, str] = {
    "AUS": "AU", "AUT": "AT", "BEL": "BE", "CAN": "CA", "CHL": "CL",
    "COL": "CO", "CRI": "CR", "CZE": "CZ", "DEU": "DE", "DNK": "DK",
    "ESP": "ES", "EST": "EE", "FIN": "FI", "FRA": "FR", "GBR": "GB",
    "GRC": "GR", "HUN": "HU", "IRL": "IE", "ISL": "IS", "ISR": "IL",
    "ITA": "IT", "JPN": "JP", "KOR": "KR", "LTU": "LT", "LUX": "LU",
    "LVA": "LV", "MEX": "MX", "NLD": "NL", "NOR": "NO", "NZL": "NZ",
    "POL": "PL", "PRT": "PT", "SVK": "SK", "SVN": "SI", "SWE": "SE",
    "TUR": "TR", "USA": "US", "CHE": "CH",
    "BRA": "BR", "RUS": "RU", "ZAF": "ZA", "IND": "IN", "CHN": "CN",
    "IDN": "ID", "ARG": "AR", "EU27_2020": "EU", "OECD": None,
}


def fetch_dataset(since_year: int | None) -> dict[str, Any]:
    """Pull the full HEALTH_PHMC SDMX-JSON payload."""
    params: dict[str, Any] = {}
    if since_year:
        params["startTime"] = str(since_year)

    print(f"[OECD] GET {OECD_URL}  params={params}", flush=True)
    with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT,
                                                 "Accept": "application/json"}) as c:
        r = c.get(OECD_URL, params=params)
        r.raise_for_status()
        return r.json()


def _index_dim_values(structure: dict[str, Any], dim_block: str) -> list[list[dict[str, Any]]]:
    """Return the values list per dimension, in dimension-index order."""
    dims = structure.get("dimensions", {}).get(dim_block, [])
    return [d.get("values", []) for d in dims]


def parse_observations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    SDMX-JSON parsing.

    Series are keyed by colon-separated dimension indices, e.g. "0:1:2:0:5",
    where each index maps to a value in the corresponding series-dimension.
    Inside each series, observations are keyed by the obs-dimension index
    (TIME_PERIOD).
    """
    data    = payload["data"]
    struct  = data["structures"][0]
    series_dim_vals = _index_dim_values(struct, "series")
    obs_dim_vals    = _index_dim_values(struct, "observation")

    # The series dims, in order: REF_AREA, MEASURE, UNIT_MEASURE, MARKET_TYPE, PHARMACEUTICAL
    # The single observation dim: TIME_PERIOD
    dataset = data["dataSets"][0]
    series  = dataset.get("series", {})

    rows: list[dict[str, Any]] = []

    for key, ser in series.items():
        idxs = [int(i) for i in key.split(":")]
        # In a 5-series-dim SDMX response, idxs order matches series_dim_vals.
        area_val    = series_dim_vals[0][idxs[0]]
        measure_val = series_dim_vals[1][idxs[1]]
        unit_val    = series_dim_vals[2][idxs[2]]
        market_val  = series_dim_vals[3][idxs[3]]
        atc_val     = series_dim_vals[4][idxs[4]]

        cc3 = str(area_val.get("id") or "")
        if not cc3 or len(cc3) > 12:           # OECD/EU27_2020 etc. — accept short codes only
            continue

        observations = ser.get("observations", {})
        for obs_key, obs_data in observations.items():
            t_idx = int(obs_key.split(":")[0])
            year_val = obs_dim_vals[0][t_idx]
            try:
                year = int(str(year_val.get("id") or "")[:4])
            except ValueError:
                continue

            try:
                value = float(obs_data[0])
            except (TypeError, ValueError, IndexError):
                continue

            atc_code = str(atc_val.get("id") or "")
            atc_code_db: str | None = None
            if atc_code and atc_code not in ("_T", "_O", "_Z"):
                atc_code_db = atc_code

            rows.append({
                "country_code3":  cc3 if len(cc3) == 3 else cc3,
                "country_code2":  ISO3_TO_ISO2.get(cc3),
                "country_name":   area_val.get("name") or cc3,
                "year":           year,
                "atc_code":       atc_code_db,
                "atc_label":      atc_val.get("name") or atc_code,
                "measure":        str(measure_val.get("id") or ""),
                "measure_label":  measure_val.get("name") or "",
                "unit":           str(unit_val.get("id") or ""),
                "unit_label":     unit_val.get("name") or "",
                "market_type":    str(market_val.get("id") or "") or None,
                "value":          value,
            })

    return rows


def upsert_batches(supabase: Any, rows: list[dict[str, Any]], size: int = 500) -> int:
    if not rows:
        return 0
    if DRY_RUN:
        print(f"  [DRY RUN] would upsert {len(rows)} rows; first: {rows[0]}", flush=True)
        return len(rows)
    total = 0
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        res = (
            supabase
            .table("oecd_pharma_metrics")
            .upsert(chunk, on_conflict="country_code3,year,atc_code,measure,unit,market_type")
            .execute()
        )
        total += len(res.data or [])
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=int, default=2015,
                    help="Earliest year to pull (default: 2015)")
    args = ap.parse_args()

    payload = fetch_dataset(args.since)
    rows = parse_observations(payload)
    print(f"[OECD] Parsed {len(rows)} observations from HEALTH_PHMC", flush=True)
    if not rows:
        print("[OECD] No observations parsed — abort", flush=True)
        return 1

    supabase = get_supabase_client()
    written = upsert_batches(supabase, rows)
    print(f"[OECD] Upserted {written} rows into oecd_pharma_metrics  ✓", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
