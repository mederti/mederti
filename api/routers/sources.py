"""
GET /sources — list all active data sources (regulatory bodies).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


class DataSource(BaseModel):
    id: str
    name: str
    abbreviation: Optional[str]
    country: Optional[str]
    country_code: Optional[str]
    region: Optional[str]
    source_url: Optional[str]
    scrape_frequency_hours: Optional[int]
    reliability_weight: Optional[float]
    is_active: bool


@router.get("", response_model=List[DataSource], summary="List all data sources")
def list_sources():
    """Return all active regulatory data sources."""
    db = get_supabase_client()
    resp = (
        db.table("data_sources")
        .select(
            "id, name, abbreviation, country, country_code, region, "
            "source_url, scrape_frequency_hours, reliability_weight, is_active"
        )
        .eq("is_active", True)
        .order("country")
        .execute()
    )
    return [DataSource(**r) for r in (resp.data or [])]
