"""
GET /intelligence-sources          — full list, filterable by category and priority
GET /intelligence-sources/summary  — counts by category, priority, access_method
GET /intelligence-sources/{id}     — single source detail
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


# ── Response models ────────────────────────────────────────────────────────────

class IntelligenceSource(BaseModel):
    source_id: str
    name: str
    owner_org: Optional[str]
    category: Optional[str]
    subcategory: Optional[str]
    geography_coverage: Optional[str]
    access_method: Optional[str]
    auth: Optional[str]
    raw_data_entrypoints: Optional[str]
    docs_entrypoint: Optional[str]
    formats: Optional[str]
    update_frequency_expected: Optional[str]
    recommended_poll_frequency: Optional[str]
    change_detection: Optional[str]
    primary_keys: Optional[str]
    terms_notes: Optional[str]
    is_medicines_regulator: bool
    is_government_or_igo: bool
    priority_for_daily_monitoring: Optional[str]
    notes: Optional[str]


class IntelligenceSourceListResponse(BaseModel):
    total: int
    results: List[IntelligenceSource]


class IntelligenceSourceSummary(BaseModel):
    total: int
    by_category: List[dict]
    by_priority: List[dict]
    by_access_method: List[dict]


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=IntelligenceSourceListResponse,
    summary="List all intelligence sources",
)
def list_intelligence_sources(
    category: Optional[str] = Query(None, description="Filter by category, e.g. procurement"),
    priority_for_daily_monitoring: Optional[str] = Query(
        None, description="Filter by priority: high | medium | low"
    ),
    access_method: Optional[str] = Query(None, description="Filter by access method, e.g. api"),
    is_government_or_igo: Optional[bool] = Query(None, description="Filter to government/IGO sources only"),
):
    """Return all intelligence sources. Filterable by category, priority, access_method, and government flag."""
    db = get_supabase_client()

    query = (
        db.table("intelligence_sources")
        .select("*", count="exact")
        .order("category")
        .order("name")
    )

    if category:
        query = query.eq("category", category)
    if priority_for_daily_monitoring:
        query = query.eq("priority_for_daily_monitoring", priority_for_daily_monitoring)
    if access_method:
        query = query.eq("access_method", access_method)
    if is_government_or_igo is not None:
        query = query.eq("is_government_or_igo", is_government_or_igo)

    resp = query.execute()
    rows = resp.data or []
    total = resp.count or len(rows)

    results = [
        IntelligenceSource(
            source_id=r["source_id"],
            name=r["name"],
            owner_org=r.get("owner_org"),
            category=r.get("category"),
            subcategory=r.get("subcategory"),
            geography_coverage=r.get("geography_coverage"),
            access_method=r.get("access_method"),
            auth=r.get("auth"),
            raw_data_entrypoints=r.get("raw_data_entrypoints"),
            docs_entrypoint=r.get("docs_entrypoint"),
            formats=r.get("formats"),
            update_frequency_expected=r.get("update_frequency_expected"),
            recommended_poll_frequency=r.get("recommended_poll_frequency"),
            change_detection=r.get("change_detection"),
            primary_keys=r.get("primary_keys"),
            terms_notes=r.get("terms_notes"),
            is_medicines_regulator=r.get("is_medicines_regulator", False),
            is_government_or_igo=r.get("is_government_or_igo", False),
            priority_for_daily_monitoring=r.get("priority_for_daily_monitoring"),
            notes=r.get("notes"),
        )
        for r in rows
    ]

    return IntelligenceSourceListResponse(total=total, results=results)


@router.get(
    "/summary",
    response_model=IntelligenceSourceSummary,
    summary="Intelligence sources summary counts",
)
def get_intelligence_sources_summary():
    """Aggregated counts by category, priority, and access method."""
    db = get_supabase_client()

    resp = db.table("intelligence_sources").select(
        "category, priority_for_daily_monitoring, access_method", count="exact"
    ).execute()
    rows = resp.data or []
    total = resp.count or len(rows)

    # Aggregate in Python (124 rows — no need for DB-side groupby)
    cat_counts: dict[str, int] = {}
    pri_counts: dict[str, int] = {}
    acc_counts: dict[str, int] = {}

    for r in rows:
        cat = r.get("category") or "unknown"
        pri = r.get("priority_for_daily_monitoring") or "unknown"
        acc = r.get("access_method") or "unknown"
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        pri_counts[pri] = pri_counts.get(pri, 0) + 1
        acc_counts[acc] = acc_counts.get(acc, 0) + 1

    return IntelligenceSourceSummary(
        total=total,
        by_category=[{"category": k, "count": v} for k, v in sorted(cat_counts.items(), key=lambda x: -x[1])],
        by_priority=[{"priority": k, "count": v} for k, v in sorted(pri_counts.items(), key=lambda x: -x[1])],
        by_access_method=[{"access_method": k, "count": v} for k, v in sorted(acc_counts.items(), key=lambda x: -x[1])],
    )


@router.get(
    "/{source_id}",
    response_model=IntelligenceSource,
    summary="Get a single intelligence source by ID",
)
def get_intelligence_source(source_id: str):
    """Return a single intelligence source record by its source_id slug."""
    db = get_supabase_client()

    resp = (
        db.table("intelligence_sources")
        .select("*")
        .eq("source_id", source_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(404, detail=f"Intelligence source {source_id!r} not found")
    r = rows[0]

    return IntelligenceSource(
        source_id=r["source_id"],
        name=r["name"],
        owner_org=r.get("owner_org"),
        category=r.get("category"),
        subcategory=r.get("subcategory"),
        geography_coverage=r.get("geography_coverage"),
        access_method=r.get("access_method"),
        auth=r.get("auth"),
        raw_data_entrypoints=r.get("raw_data_entrypoints"),
        docs_entrypoint=r.get("docs_entrypoint"),
        formats=r.get("formats"),
        update_frequency_expected=r.get("update_frequency_expected"),
        recommended_poll_frequency=r.get("recommended_poll_frequency"),
        change_detection=r.get("change_detection"),
        primary_keys=r.get("primary_keys"),
        terms_notes=r.get("terms_notes"),
        is_medicines_regulator=r.get("is_medicines_regulator", False),
        is_government_or_igo=r.get("is_government_or_igo", False),
        priority_for_daily_monitoring=r.get("priority_for_daily_monitoring"),
        notes=r.get("notes"),
    )
