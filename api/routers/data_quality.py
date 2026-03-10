"""
GET /health/data-quality — data hygiene, completeness and freshness metrics.

Returns a structured report covering:
  - Per-source freshness (hours since last successful scrape)
  - Global completeness rates (null severity, unknown category, null dates)
  - Consistency flags (stale actives, contradictory end dates, past ETAs)
  - Duplicate drug name detection
  - Overall quality score (0–100)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.utils.db import get_supabase_client

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Response models
# ─────────────────────────────────────────────────────────────────────────────

class SourceFreshness(BaseModel):
    source_id: str
    source_name: str
    country_code: Optional[str]
    last_scraped_at: Optional[str]
    hours_since_scrape: Optional[float]
    last_scrape_status: Optional[str]
    active_shortage_count: int
    freshness_status: str   # "fresh" | "aging" | "stale" | "never"


class CompletenessMetrics(BaseModel):
    total_active: int
    null_severity: int
    null_severity_pct: float
    unknown_category: int
    unknown_category_pct: float
    null_start_date: int
    null_start_date_pct: float
    null_reason: int
    null_reason_pct: float


class ConsistencyFlags(BaseModel):
    active_with_past_eta: int        # status=active but estimated_resolution_date < today
    active_with_end_date: int        # status=active but end_date is set (contradictory)
    stale_not_marked: int            # last_verified_at > 7 days but status still active
    resolved_without_end_date: int   # status=resolved but no end_date


class DuplicateDrug(BaseModel):
    normalised_prefix: str
    count: int
    examples: list[str]


class DataQualityReport(BaseModel):
    generated_at: str
    overall_score: int               # 0–100
    score_breakdown: dict[str, int]  # component scores
    source_freshness: list[SourceFreshness]
    completeness: CompletenessMetrics
    consistency: ConsistencyFlags
    duplicate_drugs: list[DuplicateDrug]
    recommendations: list[str]


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=DataQualityReport, summary="Data quality report")
def data_quality() -> DataQualityReport:
    """
    Full data quality audit across all shortage_events and raw_scrapes.
    Covers freshness, completeness, consistency and duplicate detection.
    """
    db = get_supabase_client()
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    # ── 1. Source freshness ───────────────────────────────────────────────────
    sources_resp = (
        db.table("data_sources")
        .select("id, name, country_code, scrape_frequency_hours")
        .eq("is_active", True)
        .execute()
    )
    sources: list[dict[str, Any]] = sources_resp.data or []

    source_freshness: list[SourceFreshness] = []

    for src in sources:
        sid = src["id"]

        # Most recent successful scrape for this source
        scrape_resp = (
            db.table("raw_scrapes")
            .select("scraped_at, status")
            .eq("data_source_id", sid)
            .in_("status", ["processed", "duplicate"])
            .order("scraped_at", desc=True)
            .limit(1)
            .execute()
        )
        scrape = (scrape_resp.data or [None])[0]

        last_scraped_at: str | None = None
        hours_since: float | None = None
        last_status: str | None = None

        if scrape:
            last_scraped_at = scrape["scraped_at"]
            last_status = scrape["status"]
            try:
                scraped_dt = datetime.fromisoformat(
                    last_scraped_at.replace("Z", "+00:00")
                )
                hours_since = round(
                    (now - scraped_dt).total_seconds() / 3600, 1
                )
            except (ValueError, TypeError):
                pass

        # Active shortage count for this source
        count_resp = (
            db.table("shortage_events")
            .select("id", count="exact")
            .eq("data_source_id", sid)
            .in_("status", ["active", "anticipated"])
            .execute()
        )
        active_count = count_resp.count or 0

        # Freshness classification
        freq_hours = src.get("scrape_frequency_hours") or 24
        if hours_since is None:
            freshness_status = "never"
        elif hours_since <= freq_hours * 1.5:
            freshness_status = "fresh"
        elif hours_since <= freq_hours * 3:
            freshness_status = "aging"
        else:
            freshness_status = "stale"

        source_freshness.append(SourceFreshness(
            source_id=sid,
            source_name=src["name"],
            country_code=src.get("country_code"),
            last_scraped_at=last_scraped_at,
            hours_since_scrape=hours_since,
            last_scrape_status=last_status,
            active_shortage_count=active_count,
            freshness_status=freshness_status,
        ))

    # ── 2. Completeness ───────────────────────────────────────────────────────
    _BATCH = 1000
    active_rows: list[dict[str, Any]] = []
    _offset = 0
    while True:
        _resp = (
            db.table("shortage_events")
            .select("id, severity, reason_category, start_date, reason")
            .in_("status", ["active", "anticipated"])
            .range(_offset, _offset + _BATCH - 1)
            .execute()
        )
        _batch = _resp.data or []
        active_rows.extend(_batch)
        if len(_batch) < _BATCH:
            break
        _offset += _BATCH
    total_active = len(active_rows)

    def pct(n: int) -> float:
        return round(n / total_active * 100, 1) if total_active else 0.0

    null_severity    = sum(1 for r in active_rows if not r.get("severity"))
    unknown_category = sum(1 for r in active_rows if not r.get("reason_category") or r["reason_category"] == "unknown")
    null_start_date  = sum(1 for r in active_rows if not r.get("start_date"))
    null_reason      = sum(1 for r in active_rows if not r.get("reason"))

    completeness = CompletenessMetrics(
        total_active=total_active,
        null_severity=null_severity,
        null_severity_pct=pct(null_severity),
        unknown_category=unknown_category,
        unknown_category_pct=pct(unknown_category),
        null_start_date=null_start_date,
        null_start_date_pct=pct(null_start_date),
        null_reason=null_reason,
        null_reason_pct=pct(null_reason),
    )

    # ── 3. Consistency flags ──────────────────────────────────────────────────

    # Active with estimated_resolution_date in the past
    past_eta_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .lt("estimated_resolution_date", today)
        .not_.is_("estimated_resolution_date", "null")
        .execute()
    )
    active_with_past_eta = past_eta_resp.count or 0

    # Active with end_date set (should only be set for resolved)
    active_end_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .not_.is_("end_date", "null")
        .execute()
    )
    active_with_end_date = active_end_resp.count or 0

    # last_verified_at > 7 days but still active (should have been marked stale)
    stale_cutoff = (
        datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
    )
    # 7 days ago
    from datetime import timedelta
    stale_threshold = (now - timedelta(days=7)).isoformat()
    stale_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .in_("status", ["active", "anticipated"])
        .lt("last_verified_at", stale_threshold)
        .execute()
    )
    stale_not_marked = stale_resp.count or 0

    # Resolved without end_date
    resolved_no_end_resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .eq("status", "resolved")
        .is_("end_date", "null")
        .execute()
    )
    resolved_without_end = resolved_no_end_resp.count or 0

    consistency = ConsistencyFlags(
        active_with_past_eta=active_with_past_eta,
        active_with_end_date=active_with_end_date,
        stale_not_marked=stale_not_marked,
        resolved_without_end_date=resolved_without_end,
    )

    # ── 4. Duplicate drug detection ───────────────────────────────────────────
    drug_rows: list[dict[str, Any]] = []
    _d_offset = 0
    while True:
        _d_resp = (
            db.table("drugs")
            .select("id, generic_name, generic_name_normalised")
            .range(_d_offset, _d_offset + _BATCH - 1)
            .execute()
        )
        _d_batch = _d_resp.data or []
        drug_rows.extend(_d_batch)
        if len(_d_batch) < _BATCH:
            break
        _d_offset += _BATCH

    # Group by first two words of normalised name to catch near-duplicates
    prefix_map: dict[str, list[str]] = {}
    for d in drug_rows:
        norm = (d.get("generic_name_normalised") or "").strip()
        words = norm.split()
        prefix = " ".join(words[:2]) if len(words) >= 2 else norm
        if len(prefix) < 4:
            continue
        prefix_map.setdefault(prefix, []).append(d.get("generic_name", ""))

    duplicate_drugs = [
        DuplicateDrug(
            normalised_prefix=prefix,
            count=len(names),
            examples=sorted(names)[:5],
        )
        for prefix, names in sorted(prefix_map.items(), key=lambda x: -len(x[1]))
        if len(names) > 1
    ][:20]  # top 20 duplicate groups

    # ── 5. Scoring ────────────────────────────────────────────────────────────
    # Each component scored 0–100, then weighted average

    # Freshness score: % of sources that are "fresh"
    fresh_count = sum(1 for s in source_freshness if s.freshness_status == "fresh")
    never_count = sum(1 for s in source_freshness if s.freshness_status == "never")
    freshness_score = round((fresh_count / len(source_freshness)) * 100) if source_freshness else 0

    # Completeness score: penalise null severity and unknown category most
    completeness_score = max(0, round(
        100
        - (null_severity_pct := pct(null_severity)) * 0.4
        - pct(unknown_category) * 0.3
        - pct(null_start_date) * 0.2
        - pct(null_reason) * 0.1
    ))

    # Consistency score: penalise each flag type
    consistency_penalty = min(100, (
        min(active_with_past_eta, 50) * 0.5 +
        min(active_with_end_date, 20) * 1.0 +
        min(stale_not_marked, 100) * 0.3 +
        min(resolved_without_end, 100) * 0.1
    ))
    consistency_score = max(0, round(100 - consistency_penalty))

    # Duplicate score: penalise duplicate groups
    duplicate_penalty = min(100, len(duplicate_drugs) * 2)
    duplicate_score = max(0, 100 - duplicate_penalty)

    overall_score = round(
        freshness_score   * 0.35 +
        completeness_score * 0.30 +
        consistency_score  * 0.25 +
        duplicate_score    * 0.10
    )

    score_breakdown = {
        "freshness":    freshness_score,
        "completeness": completeness_score,
        "consistency":  consistency_score,
        "duplicates":   duplicate_score,
    }

    # ── 6. Recommendations ────────────────────────────────────────────────────
    recommendations: list[str] = []

    stale_sources = [s for s in source_freshness if s.freshness_status in ("stale", "never")]
    if stale_sources:
        names = ", ".join(s.source_name.split("—")[0].strip() for s in stale_sources[:3])
        recommendations.append(f"{len(stale_sources)} source(s) not scraped recently: {names}")

    if null_severity > 0:
        recommendations.append(
            f"{null_severity} active shortages ({pct(null_severity)}%) have no severity — "
            "check scraper severity inference logic"
        )
    if unknown_category > total_active * 0.3:
        recommendations.append(
            f"{pct(unknown_category)}% of active shortages have unknown reason_category — "
            "expand keyword rules in scrapers"
        )
    if active_with_past_eta > 0:
        recommendations.append(
            f"{active_with_past_eta} active shortages have an estimated resolution date in the past — "
            "run mark_stale_shortages() or re-scrape"
        )
    if stale_not_marked > 0:
        recommendations.append(
            f"{stale_not_marked} active shortages not verified in 7+ days — "
            "run mark_stale_shortages()"
        )
    if len(duplicate_drugs) > 5:
        recommendations.append(
            f"{len(duplicate_drugs)} potential duplicate drug name groups detected — "
            "review auto-created drug records"
        )
    if never_count > 0:
        recommendations.append(
            f"{never_count} source(s) have never been successfully scraped"
        )

    if not recommendations:
        recommendations.append("No issues detected — data quality looks good.")

    return DataQualityReport(
        generated_at=now.isoformat(),
        overall_score=overall_score,
        score_breakdown=score_breakdown,
        source_freshness=source_freshness,
        completeness=completeness,
        consistency=consistency,
        duplicate_drugs=duplicate_drugs,
        recommendations=recommendations,
    )
