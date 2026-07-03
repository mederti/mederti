"""
Geocode manufacturing_facilities (and manufacturer HQs) via OpenStreetMap
Nominatim.

Backfills latitude/longitude for MapView. Nominatim is free, keyless, and
rate-limited to 1 req/sec by its usage policy — we cache by
(country, state_or_region, city) since many facilities share a location.

`--manufacturers` geocodes manufacturer HQ cities instead (migration 064):
looks up "<company name> headquarters, <country>" then "<company name>,
<country>". Name-based geocoding is fuzzier than address geocoding, so a
hit is only written when Nominatim's addressdetails country code matches
the row's country_code — a wrong-country match means we found some other
entity with a similar name, and a country-centroid fallback (what the UI
shows for rows without coords) is more honest than a confidently wrong pin.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.scripts.geocode_manufacturing_facilities
    python3 -m backend.scripts.geocode_manufacturing_facilities
    python3 -m backend.scripts.geocode_manufacturing_facilities --limit 20
    MEDERTI_DRY_RUN=1 python3 -m backend.scripts.geocode_manufacturing_facilities --manufacturers
    python3 -m backend.scripts.geocode_manufacturing_facilities --manufacturers
"""

import argparse
import os
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import httpx

from backend.utils.db import get_supabase_client

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Mederti-Geocoder/1.0 (https://mederti.com; drug-shortage-intelligence)"
RATE_LIMIT_SECONDS = 1.1

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"

CacheKey = Tuple[str, str, str]


def _query_string(country: str, state_or_region: Optional[str], city: Optional[str]) -> str:
    parts = [p for p in (city, state_or_region, country) if p]
    return ", ".join(parts)


def geocode(query: str, client: httpx.Client) -> Optional[Tuple[float, float]]:
    resp = client.get(
        NOMINATIM_URL,
        params={"q": query, "format": "json", "limit": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=15.0,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        return None
    return float(results[0]["lat"]), float(results[0]["lon"])


def geocode_with_address(query: str, client: httpx.Client) -> Optional[dict]:
    """Like geocode() but returns the full top hit incl. addressdetails."""
    resp = client.get(
        NOMINATIM_URL,
        params={"q": query, "format": "json", "limit": 1, "addressdetails": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=15.0,
    )
    resp.raise_for_status()
    results = resp.json()
    return results[0] if results else None


def run(limit: Optional[int] = None) -> None:
    db = get_supabase_client()
    resp = (
        db.table("manufacturing_facilities")
        .select("id, facility_name, country, state_or_region, city")
        .is_("latitude", "null")
        .not_.is_("country", "null")
        .execute()
    )
    rows = resp.data or []
    if limit:
        rows = rows[:limit]

    print(f"[geocode] {len(rows)} facilities need coordinates (dry_run={DRY_RUN})")

    cache: Dict[CacheKey, Optional[Tuple[float, float]]] = {}
    geocoded = 0
    skipped = 0

    with httpx.Client() as client:
        for i, row in enumerate(rows, 1):
            country = row.get("country") or ""
            state_or_region = row.get("state_or_region") or ""
            city = row.get("city") or ""
            key: CacheKey = (country, state_or_region, city)

            if key not in cache:
                query = _query_string(country, state_or_region, city)
                try:
                    cache[key] = geocode(query, client)
                except httpx.HTTPError as exc:
                    print(f"  [{i}/{len(rows)}] ERROR geocoding '{query}': {exc}")
                    cache[key] = None
                time.sleep(RATE_LIMIT_SECONDS)

            coords = cache[key]
            if coords is None:
                skipped += 1
                print(f"  [{i}/{len(rows)}] no match: {row['facility_name']} ({_query_string(country, state_or_region, city)})")
                continue

            lat, lng = coords
            geocoded += 1
            print(f"  [{i}/{len(rows)}] {row['facility_name']} -> {lat:.4f},{lng:.4f}")

            if not DRY_RUN:
                db.table("manufacturing_facilities").update(
                    {
                        "latitude": lat,
                        "longitude": lng,
                        "geocoded_at": datetime.now(timezone.utc).isoformat(),
                    }
                ).eq("id", row["id"]).execute()

    print(f"[geocode] done: {geocoded} geocoded, {skipped} skipped, {len(cache)} unique locations looked up")


def run_manufacturers(limit: Optional[int] = None) -> None:
    """Geocode manufacturer HQ cities by company name + country (migration 064)."""
    db = get_supabase_client()
    resp = (
        db.table("manufacturers")
        .select("id, name, country, country_code")
        .is_("hq_latitude", "null")
        .eq("is_active", True)
        .execute()
    )
    rows = resp.data or []
    if limit:
        rows = rows[:limit]

    print(f"[geocode:mfr] {len(rows)} manufacturers need HQ coordinates (dry_run={DRY_RUN})")

    geocoded = 0
    skipped = 0

    with httpx.Client() as client:
        for i, row in enumerate(rows, 1):
            name = row.get("name") or ""
            country = row.get("country") or ""
            country_code = (row.get("country_code") or "").lower()
            if not name or not country:
                skipped += 1
                continue

            hit = None
            for query in (f"{name} headquarters, {country}", f"{name}, {country}"):
                try:
                    hit = geocode_with_address(query, client)
                except httpx.HTTPError as exc:
                    print(f"  [{i}/{len(rows)}] ERROR geocoding '{query}': {exc}")
                    hit = None
                time.sleep(RATE_LIMIT_SECONDS)
                if hit:
                    break

            # Sanity gate: a name match in the wrong country means we found a
            # different entity — skip and leave the honest centroid fallback.
            hit_cc = ((hit or {}).get("address") or {}).get("country_code", "")
            if not hit or (country_code and hit_cc != country_code):
                skipped += 1
                reason = "wrong-country match" if hit else "no match"
                print(f"  [{i}/{len(rows)}] {reason}: {name} ({country})")
                continue

            address = hit.get("address") or {}
            city = address.get("city") or address.get("town") or address.get("village") or address.get("municipality")
            lat, lng = float(hit["lat"]), float(hit["lon"])
            geocoded += 1
            print(f"  [{i}/{len(rows)}] {name} -> {city or '?'} {lat:.4f},{lng:.4f}")

            if not DRY_RUN:
                db.table("manufacturers").update(
                    {
                        "hq_city": city,
                        "hq_latitude": lat,
                        "hq_longitude": lng,
                        "hq_geocoded_at": datetime.now(timezone.utc).isoformat(),
                    }
                ).eq("id", row["id"]).execute()

    print(f"[geocode:mfr] done: {geocoded} geocoded, {skipped} skipped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N rows (for dry-run spot checks)")
    parser.add_argument("--manufacturers", action="store_true", help="Geocode manufacturer HQs (name+country) instead of facilities")
    args = parser.parse_args()
    if args.manufacturers:
        run_manufacturers(limit=args.limit)
    else:
        run(limit=args.limit)
