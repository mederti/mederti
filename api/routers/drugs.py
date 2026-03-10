"""
GET /drugs/{drug_id}               — drug detail
GET /drugs/{drug_id}/shortages     — shortage events for this drug
GET /drugs/{drug_id}/alternatives  — therapeutic alternatives
GET /drugs/{drug_id}/recalls       — recall history + resilience score
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()

# Actual columns confirmed from DB schema
_DRUG_COLS = (
    "id, generic_name, brand_names, atc_code, atc_description, "
    "drug_class, dosage_forms, strengths, routes_of_administration, "
    "therapeutic_category, is_controlled_substance"
)


# ── Response models ───────────────────────────────────────────────────────────

class DrugDetail(BaseModel):
    drug_id: str
    generic_name: str
    brand_names: List[str]
    atc_code: Optional[str]
    atc_description: Optional[str]
    drug_class: Optional[str]
    dosage_forms: List[str]
    strengths: List[str]
    routes_of_administration: List[str]
    therapeutic_category: Optional[str]
    is_controlled_substance: Optional[bool]


class ShortageEvent(BaseModel):
    shortage_id: str
    country: str
    country_code: str
    status: str
    severity: Optional[str]
    reason: Optional[str]
    reason_category: Optional[str]
    start_date: Optional[str]
    end_date: Optional[str]
    estimated_resolution_date: Optional[str]
    source_name: Optional[str]
    source_url: Optional[str]
    last_verified_at: Optional[str]


class RecallSummary(BaseModel):
    id: str
    recall_id: str
    country_code: str
    recall_class: Optional[str]
    generic_name: str
    brand_name: Optional[str]
    manufacturer: Optional[str]
    announced_date: str
    status: str
    reason_category: Optional[str]
    press_release_url: Optional[str]
    linked_shortages: int


class DrugRecallsResponse(BaseModel):
    drug_id: str
    resilience_score: int
    recalls: List[RecallSummary]


class Alternative(BaseModel):
    alternative_drug_id: str
    alternative_generic_name: str
    alternative_brand_names: List[str]
    relationship_type: str
    clinical_evidence_level: Optional[str]
    similarity_score: Optional[float]
    dose_conversion_notes: Optional[str]
    availability_note: Optional[str]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_drug_or_404(drug_id: str) -> dict:
    db = get_supabase_client()
    resp = (
        db.table("drugs")
        .select(_DRUG_COLS)
        .eq("id", drug_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail=f"Drug {drug_id!r} not found")
    return rows[0]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{drug_id}", response_model=DrugDetail, summary="Drug detail")
def get_drug(drug_id: str):
    """Return full details for a single drug."""
    row = _get_drug_or_404(drug_id)
    return DrugDetail(
        drug_id=row["id"],
        generic_name=row["generic_name"],
        brand_names=row.get("brand_names") or [],
        atc_code=row.get("atc_code"),
        atc_description=row.get("atc_description"),
        drug_class=row.get("drug_class"),
        dosage_forms=row.get("dosage_forms") or [],
        strengths=row.get("strengths") or [],
        routes_of_administration=row.get("routes_of_administration") or [],
        therapeutic_category=row.get("therapeutic_category"),
        is_controlled_substance=row.get("is_controlled_substance"),
    )


@router.get(
    "/{drug_id}/shortages",
    response_model=List[ShortageEvent],
    summary="Shortage events for a drug",
)
def get_drug_shortages(
    drug_id: str,
    status: Optional[str] = Query(None, description="active | anticipated | resolved | stale"),
):
    """
    Return shortage events for a drug across all countries.
    Optional ?status filter: active | anticipated | resolved | stale
    """
    _get_drug_or_404(drug_id)
    db = get_supabase_client()

    query = (
        db.table("shortage_events")
        .select(
            "shortage_id, country, country_code, status, severity, "
            "reason, reason_category, start_date, end_date, "
            "estimated_resolution_date, source_url, last_verified_at, "
            "data_sources(name)"
        )
        .eq("drug_id", drug_id)
        .order("start_date", desc=True)
    )
    if status:
        query = query.eq("status", status)

    resp = query.execute()
    rows = resp.data or []

    return [
        ShortageEvent(
            shortage_id=r["shortage_id"],
            country=r.get("country") or "",
            country_code=r.get("country_code") or "",
            status=r["status"],
            severity=r.get("severity"),
            reason=r.get("reason"),
            reason_category=r.get("reason_category"),
            start_date=r.get("start_date"),
            end_date=r.get("end_date"),
            estimated_resolution_date=r.get("estimated_resolution_date"),
            source_name=(r.get("data_sources") or {}).get("name"),
            source_url=r.get("source_url"),
            last_verified_at=r.get("last_verified_at"),
        )
        for r in rows
    ]


@router.get(
    "/{drug_id}/alternatives",
    response_model=List[Alternative],
    summary="Therapeutic alternatives for a drug",
)
def get_drug_alternatives(drug_id: str):
    """
    Return therapeutic alternatives ordered by clinical evidence level (A → E).
    """
    _get_drug_or_404(drug_id)
    db = get_supabase_client()

    resp = (
        db.table("drug_alternatives")
        .select(
            "alternative_drug_id, relationship_type, "
            "clinical_evidence_level, similarity_score, "
            "dose_conversion_notes, availability_note, "
            "drugs!drug_alternatives_alternative_drug_id_fkey(generic_name, brand_names)"
        )
        .eq("drug_id", drug_id)
        .eq("is_approved", True)
        .order("similarity_score", desc=True)
        .execute()
    )
    rows = resp.data or []

    return [
        Alternative(
            alternative_drug_id=r["alternative_drug_id"],
            alternative_generic_name=(r.get("drugs") or {}).get("generic_name", ""),
            alternative_brand_names=(r.get("drugs") or {}).get("brand_names") or [],
            relationship_type=r.get("relationship_type", ""),
            clinical_evidence_level=r.get("clinical_evidence_level"),
            similarity_score=r.get("similarity_score"),
            dose_conversion_notes=r.get("dose_conversion_notes"),
            availability_note=r.get("availability_note"),
        )
        for r in rows
    ]


@router.get(
    "/{drug_id}/recalls",
    response_model=DrugRecallsResponse,
    summary="Recall history + resilience score for a drug",
)
def get_drug_recalls(drug_id: str):
    """
    Return recall history for a drug and a computed resilience score (0-100).

    Resilience score formula:
      Start at 100.
      -5  per recall announced in the last 12 months
      -15 per Class I recall in the last 24 months
      -20 per Class I recall that caused or preceded a shortage (via recall_shortage_links)
    Clamped to [0, 100].
    """
    _get_drug_or_404(drug_id)
    db = get_supabase_client()

    recalls_resp = (
        db.table("recalls")
        .select(
            "id, recall_id, country_code, recall_class, generic_name, brand_name, "
            "manufacturer, announced_date, status, reason_category, press_release_url"
        )
        .eq("drug_id", drug_id)
        .order("announced_date", desc=True)
        .execute()
    )
    rows = recalls_resp.data or []

    # Fetch link counts per recall
    recall_ids = [r["id"] for r in rows]
    link_counts: dict[str, int] = {rid: 0 for rid in recall_ids}
    if recall_ids:
        links_resp = (
            db.table("recall_shortage_links")
            .select("recall_id")
            .in_("recall_id", recall_ids)
            .execute()
        )
        for link in (links_resp.data or []):
            rid = link["recall_id"]
            link_counts[rid] = link_counts.get(rid, 0) + 1

    # Compute resilience score
    today = date.today()
    score = 100

    for r in rows:
        try:
            announced = date.fromisoformat(str(r["announced_date"]))
        except Exception:
            continue
        age_months = (today.year - announced.year) * 12 + (today.month - announced.month)

        if age_months <= 12:
            score -= 5
        if r.get("recall_class") == "I" and age_months <= 24:
            score -= 15
            # Extra penalty if this recall is linked to a shortage
            if link_counts.get(r["id"], 0) > 0:
                score -= 20

    score = max(0, min(100, score))

    recalls_out = [
        RecallSummary(
            id=r["id"],
            recall_id=r["recall_id"],
            country_code=r["country_code"],
            recall_class=r.get("recall_class"),
            generic_name=r["generic_name"],
            brand_name=r.get("brand_name"),
            manufacturer=r.get("manufacturer"),
            announced_date=str(r["announced_date"]),
            status=r["status"],
            reason_category=r.get("reason_category"),
            press_release_url=r.get("press_release_url"),
            linked_shortages=link_counts.get(r["id"], 0),
        )
        for r in rows
    ]

    return DrugRecallsResponse(
        drug_id=drug_id,
        resilience_score=score,
        recalls=recalls_out,
    )
