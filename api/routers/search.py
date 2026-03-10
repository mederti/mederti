"""
GET /search?q=amoxicillin&limit=10

Fuzzy drug search using Supabase full-text search (tsvector) with
ilike fallback. Returns ranked drug list with active shortage count.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


class DrugHit(BaseModel):
    drug_id: str
    generic_name: str
    brand_names: List[str]
    atc_code: Optional[str]
    active_shortage_count: int


class SearchResponse(BaseModel):
    query: str
    results: List[DrugHit]
    total: int


@router.get("", response_model=SearchResponse, summary="Fuzzy drug name search")
def search_drugs(
    q: str = Query(..., min_length=2, description="Drug name (generic or brand)"),
    limit: int = Query(10, ge=1, le=50),
):
    """
    Search for drugs by generic name or brand name.

    Uses PostgreSQL full-text search with ilike fallback for fuzzy matching.
    Each result includes the count of currently active shortage events globally.
    """
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    db = get_supabase_client()
    q_clean = q.strip()

    # Full-text search on search_vector
    rows = []
    try:
        resp = (
            db.table("drugs")
            .select("id, generic_name, brand_names, atc_code")
            .text_search("search_vector", q_clean, config="english")
            .limit(limit)
            .execute()
        )
        rows = resp.data or []
    except Exception:
        pass

    # Fallback: ilike if FTS returned nothing
    if not rows:
        try:
            resp = (
                db.table("drugs")
                .select("id, generic_name, brand_names, atc_code")
                .ilike("generic_name", f"%{q_clean}%")
                .limit(limit)
                .execute()
            )
            rows = resp.data or []
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not rows:
        return SearchResponse(query=q_clean, results=[], total=0)

    # Fetch active shortage counts for matched drug IDs
    drug_ids = [r["id"] for r in rows]
    shortage_counts: dict = {did: 0 for did in drug_ids}
    try:
        sc_resp = (
            db.table("shortage_events")
            .select("drug_id")
            .in_("drug_id", drug_ids)
            .in_("status", ["active", "anticipated"])
            .execute()
        )
        for row in sc_resp.data or []:
            shortage_counts[row["drug_id"]] = shortage_counts.get(row["drug_id"], 0) + 1
    except Exception:
        pass

    results = [
        DrugHit(
            drug_id=r["id"],
            generic_name=r["generic_name"],
            brand_names=r.get("brand_names") or [],
            atc_code=r.get("atc_code"),
            active_shortage_count=shortage_counts.get(r["id"], 0),
        )
        for r in rows
    ]

    return SearchResponse(query=q_clean, results=results, total=len(results))
