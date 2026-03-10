"""
GET /recalls              — paginated list with filters
GET /recalls/summary      — {total_active, class_i_count, new_this_month, by_country, by_class}
GET /recalls/{recall_id}  — detail + linked shortage_ids
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


# ── Response models ───────────────────────────────────────────────────────────

class RecallRow(BaseModel):
    id: str
    recall_id: str
    drug_id: Optional[str]
    generic_name: str
    brand_name: Optional[str]
    manufacturer: Optional[str]
    country_code: str
    recall_class: Optional[str]
    recall_type: Optional[str]
    reason: Optional[str]
    reason_category: Optional[str]
    lot_numbers: List[str]
    announced_date: str
    completion_date: Optional[str]
    status: str
    press_release_url: Optional[str]
    confidence_score: int
    source_name: Optional[str]


class RecallDetail(RecallRow):
    lot_numbers: List[str]
    raw_data: Optional[dict]
    linked_shortage_ids: List[str]


class RecallListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    results: List[RecallRow]


class RecallSummaryResponse(BaseModel):
    total_active: int
    class_i_count: int
    new_this_month: int
    by_country: List[dict]
    by_class: dict


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=RecallListResponse, summary="Browse recall events")
def list_recalls(
    country: Optional[str] = Query(None, description="ISO country code, e.g. US"),
    recall_class: Optional[str] = Query(None, description="I | II | III | Unclassified"),
    status: Optional[str] = Query(None, description="active | completed | ongoing"),
    date_from: Optional[str] = Query(None, description="ISO date, e.g. 2025-01-01"),
    date_to: Optional[str] = Query(None, description="ISO date, e.g. 2025-12-31"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    """Browse all recall events with optional filters, ordered by announced_date descending."""
    valid_classes = {"I", "II", "III", "Unclassified"}
    valid_statuses = {"active", "completed", "ongoing"}

    if recall_class and recall_class not in valid_classes:
        raise HTTPException(400, detail=f"recall_class must be one of {sorted(valid_classes)}")
    if status and status not in valid_statuses:
        raise HTTPException(400, detail=f"status must be one of {sorted(valid_statuses)}")

    db = get_supabase_client()
    offset = (page - 1) * page_size

    query = (
        db.table("recalls")
        .select(
            "id, recall_id, drug_id, generic_name, brand_name, manufacturer, "
            "country_code, recall_class, recall_type, reason, reason_category, "
            "lot_numbers, announced_date, completion_date, status, "
            "press_release_url, confidence_score, "
            "data_sources!recalls_source_id_fkey(name)",
            count="exact",
        )
        .order("announced_date", desc=True)
        .range(offset, offset + page_size - 1)
    )

    if country:
        query = query.eq("country_code", country.upper())
    if recall_class:
        query = query.eq("recall_class", recall_class)
    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("announced_date", date_from)
    if date_to:
        query = query.lte("announced_date", date_to)

    resp = query.execute()
    rows = resp.data or []
    total = resp.count or 0

    results = [
        RecallRow(
            id=r["id"],
            recall_id=r["recall_id"],
            drug_id=r.get("drug_id"),
            generic_name=r["generic_name"],
            brand_name=r.get("brand_name"),
            manufacturer=r.get("manufacturer"),
            country_code=r["country_code"],
            recall_class=r.get("recall_class"),
            recall_type=r.get("recall_type"),
            reason=r.get("reason"),
            reason_category=r.get("reason_category"),
            lot_numbers=r.get("lot_numbers") or [],
            announced_date=str(r["announced_date"]),
            completion_date=str(r["completion_date"]) if r.get("completion_date") else None,
            status=r["status"],
            press_release_url=r.get("press_release_url"),
            confidence_score=r.get("confidence_score", 80),
            source_name=(r.get("data_sources") or {}).get("name"),
        )
        for r in rows
    ]

    return RecallListResponse(page=page, page_size=page_size, total=total, results=results)


@router.get("/summary", response_model=RecallSummaryResponse, summary="Recall KPI summary")
def get_recalls_summary():
    """
    KPI summary for recalls:
    - total_active: all active recalls
    - class_i_count: active Class I recalls globally
    - new_this_month: recalls announced in the current calendar month
    - by_country: [{country_code, count}] ordered desc
    - by_class: {I: n, II: n, III: n}
    """
    db = get_supabase_client()
    today = date.today()
    month_start = today.replace(day=1).isoformat()

    # Total active
    active_resp = (
        db.table("recalls")
        .select("id", count="exact")
        .eq("status", "active")
        .execute()
    )
    total_active = active_resp.count or 0

    # Class I active
    class_i_resp = (
        db.table("recalls")
        .select("id", count="exact")
        .eq("status", "active")
        .eq("recall_class", "I")
        .execute()
    )
    class_i_count = class_i_resp.count or 0

    # New this month
    new_resp = (
        db.table("recalls")
        .select("id", count="exact")
        .gte("announced_date", month_start)
        .execute()
    )
    new_this_month = new_resp.count or 0

    # By country (fetch up to 500 active, aggregate in Python)
    country_resp = (
        db.table("recalls")
        .select("country_code")
        .eq("status", "active")
        .limit(500)
        .execute()
    )
    country_counts: dict[str, int] = {}
    for r in (country_resp.data or []):
        cc = r.get("country_code", "XX")
        country_counts[cc] = country_counts.get(cc, 0) + 1
    by_country = [
        {"country_code": cc, "count": cnt}
        for cc, cnt in sorted(country_counts.items(), key=lambda x: -x[1])
    ]

    # By class
    class_resp = (
        db.table("recalls")
        .select("recall_class")
        .eq("status", "active")
        .limit(500)
        .execute()
    )
    class_counts: dict[str, int] = {}
    for r in (class_resp.data or []):
        rc = r.get("recall_class") or "Unknown"
        class_counts[rc] = class_counts.get(rc, 0) + 1

    return RecallSummaryResponse(
        total_active=total_active,
        class_i_count=class_i_count,
        new_this_month=new_this_month,
        by_country=by_country,
        by_class=class_counts,
    )


@router.get("/{recall_id}", response_model=RecallDetail, summary="Recall detail")
def get_recall(recall_id: str):
    """Return full recall detail including linked shortage IDs."""
    db = get_supabase_client()

    # Try by UUID first, then by recall_id (MD5 dedup key)
    resp = (
        db.table("recalls")
        .select(
            "id, recall_id, drug_id, generic_name, brand_name, manufacturer, "
            "country_code, recall_class, recall_type, reason, reason_category, "
            "lot_numbers, announced_date, completion_date, status, "
            "press_release_url, confidence_score, raw_data, "
            "data_sources!recalls_source_id_fkey(name)"
        )
        .or_(f"id.eq.{recall_id},recall_id.eq.{recall_id}")
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(404, detail=f"Recall {recall_id!r} not found")
    r = rows[0]

    # Fetch linked shortages
    links_resp = (
        db.table("recall_shortage_links")
        .select("shortage_id")
        .eq("recall_id", r["id"])
        .execute()
    )
    linked_shortage_ids = [l["shortage_id"] for l in (links_resp.data or [])]

    return RecallDetail(
        id=r["id"],
        recall_id=r["recall_id"],
        drug_id=r.get("drug_id"),
        generic_name=r["generic_name"],
        brand_name=r.get("brand_name"),
        manufacturer=r.get("manufacturer"),
        country_code=r["country_code"],
        recall_class=r.get("recall_class"),
        recall_type=r.get("recall_type"),
        reason=r.get("reason"),
        reason_category=r.get("reason_category"),
        lot_numbers=r.get("lot_numbers") or [],
        announced_date=str(r["announced_date"]),
        completion_date=str(r["completion_date"]) if r.get("completion_date") else None,
        status=r["status"],
        press_release_url=r.get("press_release_url"),
        confidence_score=r.get("confidence_score", 80),
        source_name=(r.get("data_sources") or {}).get("name"),
        raw_data=r.get("raw_data"),
        linked_shortage_ids=linked_shortage_ids,
    )
