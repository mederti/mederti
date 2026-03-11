"""
World region mapper for Mederti shortage scrapers.
───────────────────────────────────────────────────

Maps ISO 3166-1 alpha-2 country codes to world region strings
used in shortage_events.world_region.

Valid regions:
    North America, Europe, Asia Pacific, Middle East,
    Latin America, Africa, Oceania

Usage:
    from backend.utils.region_mapper import get_world_region

    region = get_world_region("AU")  # "Oceania"
    region = get_world_region("US")  # "North America"
"""

from __future__ import annotations

WORLD_REGION_MAP: dict[str, str] = {
    # North America
    "US": "North America",
    "CA": "North America",
    "MX": "North America",
    # Europe
    "GB": "Europe",
    "FR": "Europe",
    "DE": "Europe",
    "IT": "Europe",
    "ES": "Europe",
    "NO": "Europe",
    "FI": "Europe",
    "SE": "Europe",
    "DK": "Europe",
    "IE": "Europe",
    "BE": "Europe",
    "AT": "Europe",
    "PT": "Europe",
    "GR": "Europe",
    "PL": "Europe",
    "CZ": "Europe",
    "CH": "Europe",
    "NL": "Europe",
    "HU": "Europe",
    "TR": "Europe",
    "EU": "Europe",
    # Asia Pacific
    "JP": "Asia Pacific",
    "SG": "Asia Pacific",
    "HK": "Asia Pacific",
    "KR": "Asia Pacific",
    "IN": "Asia Pacific",
    "CN": "Asia Pacific",
    "MY": "Asia Pacific",
    "TH": "Asia Pacific",
    # Oceania
    "AU": "Oceania",
    "NZ": "Oceania",
    # Middle East
    "IL": "Middle East",
    "SA": "Middle East",
    "AE": "Middle East",
    # Latin America
    "BR": "Latin America",
    "AR": "Latin America",
    # Africa
    "ZA": "Africa",
    "NG": "Africa",
}


def get_world_region(country_code: str) -> str | None:
    """
    Get the world region for a country code.

    Parameters
    ----------
    country_code : str
        ISO 3166-1 alpha-2 country code (e.g., "AU", "US").

    Returns
    -------
    str or None
        World region string, or None if country code is not mapped.
    """
    return WORLD_REGION_MAP.get(country_code.upper()) if country_code else None
