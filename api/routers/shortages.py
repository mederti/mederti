"""
GET /shortages — browse all shortage events with filtering and pagination.

Filters:
    country     ISO 3166-1 alpha-2  (AU, US, GB, …)
    status      active | anticipated | resolved | stale
    severity    critical | high | medium | low
    source_id   UUID of a data_source row
    page        1-indexed
    page_size   max 100
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


class ShortageRow(BaseModel):
    shortage_id: str
    drug_id: str
    generic_name: str
    brand_names: List[str]
    country: str
    country_code: str
    status: str
    severity: Optional[str]
    reason_category: Optional[str]
    start_date: Optional[str]
    estimated_resolution_date: Optional[str]
    source_name: Optional[str]
    source_url: Optional[str]


class ShortageListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    results: List[ShortageRow]


@router.get("", response_model=ShortageListResponse, summary="Browse shortage events")
def list_shortages(
    country: Optional[str] = Query(None, description="ISO country code, e.g. AU"),
    status: Optional[str] = Query(None, description="active | anticipated | resolved | stale"),
    severity: Optional[str] = Query(None, description="critical | high | medium | low"),
    source_id: Optional[str] = Query(None, description="data_source UUID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    """
    Browse all shortage events with optional filters.
    Results ordered by start_date descending (newest first).
    """
    valid_statuses = {"active", "anticipated", "resolved", "stale"}
    valid_severities = {"critical", "high", "medium", "low"}

    if status and status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(valid_statuses)}")
    if severity and severity not in valid_severities:
        raise HTTPException(status_code=400, detail=f"severity must be one of {sorted(valid_severities)}")

    db = get_supabase_client()
    offset = (page - 1) * page_size

    query = (
        db.table("shortage_events")
        .select(
            "shortage_id, drug_id, country, country_code, status, severity, "
            "reason_category, start_date, estimated_resolution_date, source_url, "
            "drugs(generic_name, brand_names), "
            "data_sources(name)",
            count="exact",
        )
        .order("start_date", desc=True)
        .range(offset, offset + page_size - 1)
    )

    if country:
        query = query.eq("country_code", country.upper())
    if status:
        query = query.eq("status", status)
    if severity:
        query = query.eq("severity", severity)
    if source_id:
        query = query.eq("data_source_id", source_id)

    resp = query.execute()
    rows = resp.data or []
    total = resp.count or 0

    results = [
        ShortageRow(
            shortage_id=r["shortage_id"],
            drug_id=r["drug_id"],
            generic_name=(r.get("drugs") or {}).get("generic_name", ""),
            brand_names=(r.get("drugs") or {}).get("brand_names") or [],
            country=r.get("country") or "",
            country_code=r.get("country_code") or "",
            status=r["status"],
            severity=r.get("severity"),
            reason_category=r.get("reason_category"),
            start_date=r.get("start_date"),
            estimated_resolution_date=r.get("estimated_resolution_date"),
            source_name=(r.get("data_sources") or {}).get("name"),
            source_url=r.get("source_url"),
        )
        for r in rows
    ]

    return ShortageListResponse(
        page=page,
        page_size=page_size,
        total=total,
        results=results,
    )
