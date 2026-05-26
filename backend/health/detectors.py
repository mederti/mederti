"""Read-only health detectors for the Mederti data plane.

Each detector returns a `Finding` describing what (if anything) is broken.
Findings are aggregated by `daily_check.py` and emailed as a digest.

Detectors NEVER mutate the database. They only read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.scrapers.base_recall_scraper import _looks_like_drug_name
from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.health.detectors")

# Detector severities ────────────────────────────────────────────────────────
SEV_OK       = "ok"        # nothing to report
SEV_INFO     = "info"      # worth knowing, no action
SEV_WARN     = "warn"      # degraded, action recommended
SEV_ERROR    = "error"     # broken, action required


@dataclass
class Finding:
    """One detector result."""
    detector: str
    severity: str
    headline: str
    detail:   str = ""
    metrics:  dict[str, Any] = field(default_factory=dict)
    samples:  list[Any] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "detector": self.detector,
            "severity": self.severity,
            "headline": self.headline,
            "detail":   self.detail,
            "metrics":  self.metrics,
            "samples":  self.samples,
        }


# ── Detector 1: polluted drugs catalogue ────────────────────────────────────
# Conservative: flag drug rows that look like recall headlines (sentences) —
# not just unusually long product descriptions, which can be legitimate.

_RECALL_SOURCE_MARKER = "Auto-created by"  # therapeutic_category prefix

# Substrings that, when present in a generic_name, mark it as a headline
_HEADLINE_SUBSTRINGS: tuple[str, ...] = (
    " and the risk of", " due to medication", " and the risk", " risk of ",
    " important safety information", " updated labelling for",
    " updated labeling for", " updated information for",
    " health canada ", " recall of ", " warning about ",
    " communication to ", " letter to ", " new safety information",
    " advisory on ", " advisory regarding ",
)


def _is_headline_like(name: str) -> bool:
    if not name:
        return False
    lower = " " + name.lower() + " "
    return any(s in lower for s in _HEADLINE_SUBSTRINGS)


def detect_drug_pollution(db: Any | None = None) -> Finding:
    db = db or get_supabase_client()
    name = "drug_catalogue_pollution"

    try:
        resp = (
            db.table("drugs")
            .select("id, generic_name, therapeutic_category, created_at")
            .ilike("therapeutic_category", f"{_RECALL_SOURCE_MARKER}%Recall%")
            .limit(5000)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        return Finding(name, SEV_WARN, "Could not query drugs table",
                       detail=f"Supabase error: {exc}")

    polluted = [r for r in rows if _is_headline_like(r.get("generic_name") or "")]
    if not polluted:
        return Finding(name, SEV_OK, "No headline pollution in drug catalogue",
                       metrics={"recall_auto_created": len(rows)})

    return Finding(
        name,
        SEV_ERROR,
        f"{len(polluted)} headline-shaped rows in drugs from recall scrapers",
        detail=("Rows in `drugs` auto-created by recall scrapers whose "
                "generic_name matches recall headline patterns — these are not "
                "real drug names."),
        metrics={
            "polluted":            len(polluted),
            "recall_auto_created": len(rows),
        },
        samples=[
            {
                "id":            r["id"],
                "generic_name":  r["generic_name"][:90],
                "source":        r.get("therapeutic_category"),
                "created_at":    r.get("created_at"),
            }
            for r in polluted[:10]
        ],
    )


# ── Detector 2: silent / stale data sources ─────────────────────────────────
def detect_stale_sources(db: Any | None = None, max_hours: int = 36) -> Finding:
    db = db or get_supabase_client()
    name = "stale_data_sources"

    try:
        resp = (
            db.table("data_sources")
            .select("id, abbreviation, country_code, last_scraped_at, is_active, scrape_frequency_hours")
            .eq("is_active", True)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        return Finding(name, SEV_WARN, "Could not query data_sources",
                       detail=f"Supabase error: {exc}")

    now = datetime.now(timezone.utc)
    stale: list[dict[str, Any]] = []
    never: list[dict[str, Any]] = []

    for r in rows:
        ts = r.get("last_scraped_at")
        if not ts:
            never.append(r)
            continue
        try:
            scraped_at = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            continue
        threshold_h = max(int(r.get("scrape_frequency_hours") or 24), 24) + 12
        if (now - scraped_at) > timedelta(hours=threshold_h):
            stale.append({
                **r,
                "hours_since_scrape": round((now - scraped_at).total_seconds() / 3600, 1),
            })

    if not stale and not never:
        return Finding(name, SEV_OK, "All active sources scraped recently",
                       metrics={"active_sources": len(rows)})

    sev = SEV_ERROR if stale else SEV_WARN
    return Finding(
        name,
        sev,
        f"{len(stale)} stale source(s), {len(never)} never scraped",
        detail=(f"Sources not scraped within their frequency window + {max_hours}h "
                "grace. Likely silent scraper failures or missing cron entries."),
        metrics={
            "active_sources": len(rows),
            "stale":          len(stale),
            "never_scraped":  len(never),
        },
        samples=(
            [{"abbr": r["abbreviation"], "country": r["country_code"],
              "hours_since_scrape": r["hours_since_scrape"]} for r in stale[:10]] +
            [{"abbr": r["abbreviation"], "country": r["country_code"],
              "hours_since_scrape": None} for r in never[:5]]
        ),
    )


# ── Detector 3: HC pollution canary ─────────────────────────────────────────
# A targeted check: any drug whose name contains the literal substrings that
# the broken HC scraper used to write.

_HC_CANARY_PATTERNS: tuple[str, ...] = (
    "and the risk of", "due to medication", "labelling for", "labeling for",
    "health canada", "recall of", "updated information", "important safety",
)

def detect_hc_canary(db: Any | None = None) -> Finding:
    db = db or get_supabase_client()
    name = "hc_recall_canary"

    hits: list[dict[str, Any]] = []
    seen: set[str] = set()
    for pat in _HC_CANARY_PATTERNS:
        try:
            resp = (
                db.table("drugs")
                .select("id, generic_name, therapeutic_category")
                .ilike("generic_name", f"%{pat}%")
                .limit(50)
                .execute()
            )
            for row in (resp.data or []):
                if row["id"] in seen:
                    continue
                seen.add(row["id"])
                hits.append(row)
        except Exception as exc:
            log.warning("HC canary query failed", extra={"pattern": pat, "error": str(exc)})

    if not hits:
        return Finding(name, SEV_OK, "No HC recall canary patterns found")

    return Finding(
        name,
        SEV_ERROR,
        f"{len(hits)} drug rows match HC recall headline patterns",
        detail="These rows look like recall headlines stored as drug names.",
        metrics={"matches": len(hits)},
        samples=[{"id": r["id"], "generic_name": r["generic_name"][:80]} for r in hits[:10]],
    )


# ── Detector 4: shortage_events freshness ───────────────────────────────────
def detect_no_recent_shortages(db: Any | None = None, hours: int = 48) -> Finding:
    db = db or get_supabase_client()
    name = "shortage_events_freshness"

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        resp = (
            db.table("shortage_events")
            .select("id", count="exact")
            .gte("last_verified_at", cutoff)
            .limit(1)
            .execute()
        )
        recent = getattr(resp, "count", None) or len(resp.data or [])
    except Exception as exc:
        return Finding(name, SEV_WARN, "Could not query shortage_events",
                       detail=f"Supabase error: {exc}")

    if recent == 0:
        return Finding(name, SEV_ERROR,
                       f"No shortage_events verified in the last {hours}h",
                       metrics={"recent": 0, "window_hours": hours})

    return Finding(name, SEV_OK, f"{recent} shortage events verified in last {hours}h",
                   metrics={"recent": recent, "window_hours": hours})


# ── Aggregator ──────────────────────────────────────────────────────────────
ALL_DETECTORS = (
    detect_drug_pollution,
    detect_stale_sources,
    detect_hc_canary,
    detect_no_recent_shortages,
)


def run_all(db: Any | None = None) -> list[Finding]:
    db = db or get_supabase_client()
    findings: list[Finding] = []
    for fn in ALL_DETECTORS:
        try:
            findings.append(fn(db))
        except Exception as exc:
            findings.append(Finding(
                fn.__name__, SEV_WARN, "Detector crashed",
                detail=f"{type(exc).__name__}: {exc}",
            ))
    return findings


def has_actionable(findings: list[Finding]) -> bool:
    """True if any finding is more severe than OK."""
    return any(f.severity in (SEV_WARN, SEV_ERROR) for f in findings)
