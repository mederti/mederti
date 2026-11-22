"""Read-only health detectors for the Mederti data plane.

Each detector returns a `Finding` describing what (if anything) is broken.
Findings are aggregated by `daily_check.py` and emailed as a digest.

Detectors NEVER mutate the database. They only read.
"""

from __future__ import annotations

import re
import time
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


def _parse_ts(ts: Any) -> datetime:
    """Parse a PostgREST timestamp. Python <3.11 rejects fractional seconds
    that aren't 3 or 6 digits (Postgres trims trailing zeros, e.g. .33635)."""
    t = str(ts).replace("Z", "+00:00")
    t = re.sub(r"\.(\d+)", lambda m: "." + m.group(1).ljust(6, "0")[:6], t)
    return datetime.fromisoformat(t)


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
            scraped_at = _parse_ts(ts)
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


# ── Detector 5: silent-failure scrapers ─────────────────────────────────────
# A scraper can update its data_sources.last_scraped_at row even when it
# writes ZERO records (HTTP succeeds, parser returns empty list, framework
# marks "complete"). detect_stale_sources doesn't catch this — last_scraped_at
# is fresh. This detector cross-checks: if a source is "active" and "scraped
# recently" but the corresponding country has no rows in either shortage_events
# or recalls for `lookback_days`, it's silently failing.
def detect_silent_failure_scrapers(
    db: Any | None = None,
    lookback_days: int = 14,
    fresh_scrape_hours: int = 48,
) -> Finding:
    db = db or get_supabase_client()
    name = "silent_failure_scrapers"

    try:
        sources = (
            db.table("data_sources")
            .select("id, abbreviation, country_code, last_scraped_at, is_active")
            .eq("is_active", True)
            .execute()
        ).data or []
    except Exception as exc:
        return Finding(name, SEV_WARN, "Could not query data_sources",
                       detail=f"Supabase error: {exc}")

    now = datetime.now(timezone.utc)
    scrape_cutoff = now - timedelta(hours=fresh_scrape_hours)
    row_cutoff = (now - timedelta(days=lookback_days)).isoformat()

    # Aggregate sources by country_code: a country is "covered" if ANY of its
    # sources have written rows recently to either table.
    countries_with_active_scrape: dict[str, list[dict]] = {}
    for s in sources:
        cc = s.get("country_code")
        last = s.get("last_scraped_at")
        if not cc or not last:
            continue
        try:
            ts = _parse_ts(last)
        except ValueError:
            continue
        if ts < scrape_cutoff:
            continue
        countries_with_active_scrape.setdefault(cc, []).append(s)

    silent: list[dict[str, Any]] = []
    for cc, srcs in countries_with_active_scrape.items():
        try:
            sh = (
                db.table("shortage_events")
                .select("id", count="exact")
                .eq("country_code", cc)
                .gte("created_at", row_cutoff)
                .limit(1)
                .execute()
            )
            sh_n = getattr(sh, "count", None) or 0
            rc = (
                db.table("recalls")
                .select("id", count="exact")
                .eq("country_code", cc)
                .gte("created_at", row_cutoff)
                .limit(1)
                .execute()
            )
            rc_n = getattr(rc, "count", None) or 0
        except Exception as exc:
            log.warning("silent_failure row count failed",
                        extra={"country_code": cc, "error": str(exc)})
            continue

        if sh_n == 0 and rc_n == 0:
            silent.append({
                "country_code": cc,
                "sources": [s.get("abbreviation") for s in srcs],
                "shortage_rows_last_n_days": sh_n,
                "recall_rows_last_n_days": rc_n,
            })

    if not silent:
        return Finding(
            name, SEV_OK,
            "All actively-scraping countries produced rows recently",
            metrics={"countries_checked": len(countries_with_active_scrape),
                     "lookback_days": lookback_days},
        )

    return Finding(
        name, SEV_ERROR,
        f"{len(silent)} country source(s) scraping but writing zero rows",
        detail=(
            f"data_sources.last_scraped_at within last {fresh_scrape_hours}h "
            f"but ZERO rows in shortage_events or recalls for that country in "
            f"last {lookback_days}d. Likely silent upstream-format change, "
            f"selector breakage, or country-code mismatch."
        ),
        metrics={
            "silent_countries": len(silent),
            "lookback_days": lookback_days,
            "fresh_scrape_hours": fresh_scrape_hours,
        },
        samples=silent[:15],
    )


# Open, real (non-synthetic) shortage rows — the rows a user is shown.
_OPEN_STATUSES = ("active", "anticipated")
_NOT_SYNTHETIC = "synthetic.is.null,synthetic.eq.false"


def _exec(query: Any, attempts: int = 3) -> Any:
    """Execute with a short retry — PostgREST occasionally drops a connection
    ("Server disconnected") mid-run, which must not read as a finding."""
    for i in range(attempts):
        try:
            return query.execute()
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(1.5 * (i + 1))


def _count(query: Any) -> int:
    """Run a PostgREST head-count query; returns the exact count."""
    resp = _exec(query.limit(1))
    return int(getattr(resp, "count", None) or 0)


def _active_sources(db: Any) -> list[dict[str, Any]]:
    return (
        db.table("data_sources")
        .select("id, abbreviation, country_code, last_scraped_at")
        .eq("is_active", True)
        .execute()
    ).data or []


# ── Detector 6: last scrape attempt failed ──────────────────────────────────
# Stale-source detection only fires a day or more after a scraper starts
# failing (and never for a source whose failures still bump last_scraped_at).
# raw_scrapes records every attempt, so the newest row per source says
# whether the LAST run worked — and carries the upstream error message.
def detect_failed_last_run(db: Any | None = None) -> Finding:
    db = db or get_supabase_client()
    name = "failed_last_run"
    try:
        sources = _active_sources(db)
    except Exception as exc:
        return Finding(name, SEV_WARN, "Could not query data_sources", detail=str(exc))

    failed: list[dict[str, Any]] = []
    never: list[str] = []
    for s in sources:
        try:
            rows = _exec(
                db.table("raw_scrapes")
                .select("status, error_message, scraped_at")
                .eq("data_source_id", s["id"])
                .order("scraped_at", desc=True)
                .limit(1)
            ).data or []
        except Exception as exc:
            log.warning("raw_scrapes lookup failed", extra={"source": s["abbreviation"], "error": str(exc)})
            continue
        if not rows:
            never.append(s["abbreviation"])
            continue
        if rows[0]["status"] == "failed":
            failed.append({
                "abbr": s["abbreviation"],
                "country": s["country_code"],
                "at": rows[0]["scraped_at"],
                "error": (rows[0].get("error_message") or "")[:200],
            })

    if not failed:
        return Finding(name, SEV_OK, "Latest attempt succeeded for every active source",
                       metrics={"active_sources": len(sources), "no_raw_scrapes": len(never)})
    return Finding(
        name, SEV_ERROR,
        f"{len(failed)} source(s) failed on their latest run",
        detail="Newest raw_scrapes row per active source has status=failed. "
               "The error is the upstream reason (404 = URL moved, 403/Cloudflare = blocked).",
        metrics={"active_sources": len(sources), "failed": len(failed), "no_raw_scrapes": len(never)},
        samples=failed[:20],
    )


# ── Detector 7: open-row integrity ──────────────────────────────────────────
# Rules every open shortage row must satisfy for what we display to be true.
# Each is a single head-count.
def detect_open_row_integrity(db: Any | None = None) -> Finding:
    db = db or get_supabase_client()
    name = "open_row_integrity"
    today = datetime.now(timezone.utc).date().isoformat()
    week_ago = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()

    def open_q() -> Any:
        return (
            db.table("shortage_events")
            .select("id", count="exact")
            .in_("status", list(_OPEN_STATUSES))
            .or_(_NOT_SYNTHETIC)
        )

    checks: dict[str, tuple[str, Any]] = {
        # status says it's happening now, but the regulator's start date is in the future
        "active_future_start": ("error", open_q().eq("status", "active").gt("start_date", today)),
        # row is closed (end_date in the past) but still shown as open
        "open_with_past_end_date": ("error", open_q().lt("end_date", today)),
        # "expected back" date more than a week in the past, still open
        "open_past_eta_7d": ("warn", open_q().lt("estimated_resolution_date", week_ago)),
        # can't be placed on a market
        "open_no_country": ("error", open_q().is_("country_code", "null")),
    }

    counts: dict[str, int] = {}
    worst = SEV_OK
    errors: list[str] = []
    for key, (sev, q) in checks.items():
        try:
            n = _count(q)
        except Exception as exc:
            errors.append(f"{key}: {exc}")
            continue
        counts[key] = n
        if n:
            if sev == "error":
                worst = SEV_ERROR
            elif worst == SEV_OK:
                worst = SEV_WARN

    try:
        counts["open_total"] = _count(open_q())
    except Exception:
        pass

    if errors and len(counts) <= 1:
        return Finding(name, SEV_WARN, "Integrity queries failed", detail="; ".join(errors))

    bad = {k: v for k, v in counts.items() if v and k != "open_total"}
    if worst == SEV_OK:
        return Finding(name, SEV_WARN if errors else SEV_OK,
                       "Open shortage rows pass all integrity rules" + (" (some checks errored)" if errors else ""),
                       metrics=counts, detail="; ".join(errors))
    return Finding(
        name, worst,
        "Open shortage rows break integrity rules: " + ", ".join(f"{k}={v}" for k, v in bad.items()),
        detail="Open = status active/anticipated, non-synthetic. active_future_start should be "
               "'anticipated'; past end_date should be closed (mark_stale / reconcile); past ETAs "
               "must never display as 'expected back'." + (f" Query errors: {'; '.join(errors)}" if errors else ""),
        metrics=counts,
    )


# ── Detector 8: per-source volume drift ─────────────────────────────────────
# Compares each source's open-row count with the previous persisted run
# (data_health_runs.source_counts). Catches what the other detectors miss:
# a parser that silently drops most rows (count collapses) and snapshot
# scrapers minting duplicate rows (the JP/CH phantom growth).
DRIFT_DROP_PCT = 0.30   # flag a fall of ≥30% …
DRIFT_DROP_MIN = 20     # … of at least 20 rows
DRIFT_GROW_PCT = 0.50   # flag growth of ≥50% …
DRIFT_GROW_MIN = 50     # … of at least 50 rows


def source_open_counts(db: Any) -> dict[str, dict[str, Any]]:
    """{data_source_id: {abbr, country, open}} for every active source."""
    out: dict[str, dict[str, Any]] = {}
    for s in _active_sources(db):
        try:
            n = _count(
                db.table("shortage_events")
                .select("id", count="exact")
                .eq("data_source_id", s["id"])
                .in_("status", list(_OPEN_STATUSES))
                .or_(_NOT_SYNTHETIC)
            )
        except Exception as exc:
            log.warning("open count failed", extra={"source": s["abbreviation"], "error": str(exc)})
            continue
        out[s["id"]] = {"abbr": s["abbreviation"], "country": s["country_code"], "open": n}
    return out


def detect_source_volume_drift(db: Any | None = None) -> Finding:
    db = db or get_supabase_client()
    name = "source_volume_drift"
    current = source_open_counts(db)

    try:
        prev_rows = (
            db.table("data_health_runs")
            .select("run_at, source_counts")
            .not_.is_("source_counts", "null")
            .order("run_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
    except Exception as exc:
        return Finding(name, SEV_INFO, "No previous run to compare against (data_health_runs unavailable)",
                       detail=str(exc)[:200], metrics={"source_counts": current})
    if not prev_rows:
        return Finding(name, SEV_INFO, "Baseline recorded; drift is checked from the next run",
                       metrics={"source_counts": current})

    prev = prev_rows[0]["source_counts"] or {}
    moves: list[dict[str, Any]] = []
    for sid, cur in current.items():
        before = (prev.get(sid) or {}).get("open")
        if before is None:
            continue
        delta = cur["open"] - before
        if before and delta < 0 and -delta >= DRIFT_DROP_MIN and -delta / before >= DRIFT_DROP_PCT:
            moves.append({**cur, "before": before, "change": delta, "kind": "drop"})
        elif delta >= DRIFT_GROW_MIN and (before == 0 or delta / before >= DRIFT_GROW_PCT):
            moves.append({**cur, "before": before, "change": delta, "kind": "spike"})

    metrics = {"source_counts": current, "compared_to": prev_rows[0]["run_at"]}
    if not moves:
        return Finding(name, SEV_OK, "No source changed its open-row count abnormally since the last run",
                       metrics=metrics)
    moves.sort(key=lambda m: abs(m["change"]), reverse=True)
    return Finding(
        name, SEV_WARN,
        f"{len(moves)} source(s) with abnormal open-row change since last run",
        detail=f"Drop ≥{int(DRIFT_DROP_PCT * 100)}% (≥{DRIFT_DROP_MIN} rows) suggests a parser losing rows; "
               f"spike ≥{int(DRIFT_GROW_PCT * 100)}% (≥{DRIFT_GROW_MIN} rows) suggests duplicate rows. "
               "Real regulator changes happen too — check the source before acting.",
        metrics=metrics,
        samples=moves[:15],
    )


# ── Detector 9: the quality check itself is overdue ─────────────────────────
# If the daily run stops (runner crash, deploy break), nothing else notices.
def detect_health_run_overdue(db: Any | None = None, max_hours: int = 30) -> Finding:
    db = db or get_supabase_client()
    name = "health_run_overdue"
    try:
        rows = (
            db.table("data_health_runs").select("run_at, runner")
            .order("run_at", desc=True).limit(1).execute()
        ).data or []
    except Exception as exc:
        return Finding(name, SEV_WARN, "data_health_runs not readable (migration 079 applied?)",
                       detail=str(exc)[:200])
    if not rows:
        return Finding(name, SEV_INFO, "First persisted data-quality run")
    last = _parse_ts(rows[0]["run_at"])
    age_h = (datetime.now(timezone.utc) - last).total_seconds() / 3600
    m = {"hours_since_last_run": round(age_h, 1), "last_runner": rows[0]["runner"]}
    if age_h > max_hours:
        return Finding(name, SEV_WARN, f"Previous data-quality run was {age_h:.0f}h ago (expected daily)", metrics=m)
    return Finding(name, SEV_OK, f"Previous data-quality run {age_h:.0f}h ago", metrics=m)


# ── Aggregator ──────────────────────────────────────────────────────────────
ALL_DETECTORS = (
    detect_health_run_overdue,
    detect_drug_pollution,
    detect_stale_sources,
    detect_failed_last_run,
    detect_hc_canary,
    detect_no_recent_shortages,
    detect_silent_failure_scrapers,
    detect_open_row_integrity,
    detect_source_volume_drift,
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
