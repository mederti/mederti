"""
GET /shortages/summary — aggregated shortage counts for the dashboard KPIs.

Returns:
    by_severity     dict  active/anticipated counts keyed by severity level
    by_category     list  top categories sorted by severity, then count
    total_active    int   total active + anticipated shortage events
    new_this_month  int   active/anticipated events created in last 30 days
    resolved_this_month int  resolved events last verified in last 30 days
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()

_SEV_ORDER = ["critical", "high", "medium", "low"]


class CategoryBucket(BaseModel):
    category: str
    count: int
    max_severity: str


class CountryBucket(BaseModel):
    country_code: str
    country: str
    count: int
    max_severity: str


class SummaryResponse(BaseModel):
    by_severity: dict[str, int]
    by_category: list[CategoryBucket]
    by_country: list[CountryBucket]
    total_active: int
    new_this_month: int
    resolved_this_month: int


@router.get("", response_model=SummaryResponse, summary="Dashboard summary counts")
def get_summary() -> SummaryResponse:
    """
    Returns aggregated counts used by the dashboard KPIs and heatmap.
    Makes three focused queries: active events, new this month, resolved this month.
    """
    db = get_supabase_client()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    # ── 1. All active/anticipated events (paginated — avoids 1000-row cap) ──────
    _BATCH = 1000
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        resp = (
            db.table("shortage_events")
            .select("severity, reason_category, country_code, country")
            .in_("status", ["active", "anticipated"])
            .range(offset, offset + _BATCH - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < _BATCH:
            break
        offset += _BATCH

    by_severity: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_category_map: dict[str, dict[str, Any]] = {}
    by_country_map: dict[str, dict[str, Any]] = {}

    for row in rows:
        sev = (row.get("severity") or "low").lower()
        if sev in by_severity:
            by_severity[sev] += 1

        cat = row.get("reason_category") or "Other"
        if cat not in by_category_map:
            by_category_map[cat] = {"count": 0, "max_severity": "low"}
        by_category_map[cat]["count"] += 1

        cc = row.get("country_code") or "XX"
        country_name = row.get("country") or cc
        if cc not in by_country_map:
            by_country_map[cc] = {"country": country_name, "count": 0, "max_severity": "low"}
        by_country_map[cc]["count"] += 1

        if sev in _SEV_ORDER:
            for bucket in (by_category_map[cat], by_country_map[cc]):
                cur = bucket["max_severity"]
                if _SEV_ORDER.index(sev) < _SEV_ORDER.index(cur):
                    bucket["max_severity"] = sev

    total_active = len(rows)

    by_country = sorted(
        [
            CountryBucket(
                country_code=cc,
                country=data["country"],
                count=data["count"],
                max_severity=data["max_severity"],
            )
            for cc, data in by_country_map.items()
            if cc != "XX"
        ],
        key=lambda b: -b.count,
    )

    # Sort: worst severity first, then highest count
    by_category = sorted(
        [
            CategoryBucket(
                category=cat,
                count=data["count"],
                max_severity=data["max_severity"],
            )
            for cat, data in by_category_map.items()
        ],
        key=lambda b: (_SEV_ORDER.index(b.max_severity), -b.count),
    )[:15]

    # ── 2. New this month (active/anticipated, created recently) ─────────────
    new_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .gte("created_at", cutoff)
        .execute()
    )
    new_this_month: int = new_resp.count or 0

    # ── 3. Resolved this month (last_verified_at updated recently) ───────────
    resolved_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .eq("status", "resolved")
        .gte("last_verified_at", cutoff)
        .execute()
    )
    resolved_this_month: int = resolved_resp.count or 0

    return SummaryResponse(
        by_severity=by_severity,
        by_category=by_category,
        by_country=by_country,
        total_active=total_active,
        new_this_month=new_this_month,
        resolved_this_month=resolved_this_month,
    )
