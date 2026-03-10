"""
Recall Linker — Post-scrape intelligence linking.

After scrapers run, some recalls will have drug_id resolved but no
recall_shortage_links entries (e.g. first-run or newly matched drugs).

This module re-links such orphaned recalls and auto-creates anticipated
shortages for any Class I recalls that still have no active shortage.

Call from run_all_scrapers.py after dispatch_pending_alerts().
"""

from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from typing import Any

from supabase import Client

from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.recalls.linker")


def link_unlinked_recalls(
    db: Client | None = None,
    lookback_days: int = 7,
) -> dict[str, int]:
    """
    Fetch recalls created in the last `lookback_days` that have:
      - drug_id IS NOT NULL
      - no recall_shortage_links entries

    For each, attempt to link to shortage_events and auto-create
    anticipated shortages for Class I recalls.

    Returns summary: {"checked": n, "linked": n, "auto_shortages": n, "errors": n}
    """
    if db is None:
        db = get_supabase_client()

    summary: dict[str, int] = {"checked": 0, "linked": 0, "auto_shortages": 0, "errors": 0}
    cutoff = (date.today() - timedelta(days=lookback_days)).isoformat()

    # ── Fetch candidate recalls ───────────────────────────────────────────────
    try:
        resp = (
            db.table("recalls")
            .select("id, drug_id, source_id, country_code, recall_class, announced_date, press_release_url")
            .gte("created_at", cutoff)
            .not_.is_("drug_id", "null")
            .execute()
        )
        recalls: list[dict[str, Any]] = resp.data or []
    except Exception as exc:
        log.error("Failed to fetch candidate recalls", extra={"error": str(exc)})
        return summary

    log.info("Recall linker: candidates", extra={"count": len(recalls), "lookback_days": lookback_days})

    for recall in recalls:
        recall_uuid = recall["id"]
        drug_id     = recall["drug_id"]
        country_code = recall["country_code"]
        announced_date = str(recall.get("announced_date") or date.today().isoformat())
        recall_class = recall.get("recall_class")

        # Check if already linked
        try:
            existing_links = (
                db.table("recall_shortage_links")
                .select("id")
                .eq("recall_id", recall_uuid)
                .limit(1)
                .execute()
            )
            already_linked = bool(existing_links.data)
        except Exception:
            already_linked = False

        summary["checked"] += 1

        # Link to shortage events
        if not already_linked:
            try:
                linked_count = _link_recall_to_shortages(db, recall_uuid, drug_id, country_code, announced_date)
                summary["linked"] += linked_count
            except Exception as exc:
                log.warning("Linker: could not link recall", extra={"recall_id": recall_uuid, "error": str(exc)})
                summary["errors"] += 1

        # Auto-create shortage for Class I with no active shortage
        if recall_class == "I":
            try:
                created = _maybe_auto_create_shortage(db, recall, drug_id, country_code, announced_date)
                if created:
                    summary["auto_shortages"] += 1
            except Exception as exc:
                log.warning("Linker: auto-shortage failed", extra={"recall_id": recall_uuid, "error": str(exc)})

    log.info("Recall linker complete", extra=summary)
    return summary


def _link_recall_to_shortages(
    db: Client,
    recall_uuid: str,
    drug_id: str,
    country_code: str,
    announced_date: str,
) -> int:
    """Link a recall to matching shortage_events. Returns number of links created."""
    shortage_resp = (
        db.table("shortage_events")
        .select("id, start_date")
        .eq("drug_id", drug_id)
        .eq("country_code", country_code)
        .execute()
    )
    shortages = shortage_resp.data or []
    announced_dt = datetime.fromisoformat(announced_date)
    linked = 0

    for s in shortages:
        start_raw = s.get("start_date")
        if not start_raw:
            continue
        try:
            start_dt = datetime.fromisoformat(str(start_raw))
        except ValueError:
            continue

        diff_days = (start_dt - announced_dt).days
        if diff_days > 1:
            link_type = "recall_caused_shortage"
        elif abs(diff_days) <= 30:
            link_type = "concurrent"
        else:
            link_type = "shortage_preceded_recall"

        try:
            db.table("recall_shortage_links").upsert(
                {
                    "recall_id":   recall_uuid,
                    "shortage_id": s["id"],
                    "link_type":   link_type,
                },
                on_conflict="recall_id,shortage_id",
            ).execute()
            linked += 1
        except Exception:
            pass

    return linked


def _maybe_auto_create_shortage(
    db: Client,
    recall: dict,
    drug_id: str,
    country_code: str,
    announced_date: str,
) -> bool:
    """
    Auto-create anticipated shortage for Class I recall if none exists.
    Returns True if a shortage was created.
    """
    # Check for existing active/anticipated shortage
    existing = (
        db.table("shortage_events")
        .select("id")
        .eq("drug_id", drug_id)
        .eq("country_code", country_code)
        .in_("status", ["active", "anticipated"])
        .limit(1)
        .execute()
    )
    if existing.data:
        return False

    import hashlib
    source_id = recall.get("source_id", "")
    shortage_id_raw = f"{drug_id}|{source_id}|{country_code}|{announced_date}"
    shortage_id = hashlib.md5(shortage_id_raw.encode()).hexdigest()

    try:
        db.table("shortage_events").upsert(
            {
                "shortage_id":      shortage_id,
                "drug_id":          drug_id,
                "data_source_id":   source_id,
                "country_code":     country_code,
                "status":           "anticipated",
                "severity":         "high",
                "reason_category":  "regulatory_action",
                "start_date":       announced_date,
                "source_url":       recall.get("press_release_url", ""),
                "notes":            f"Auto-generated from Class I recall {recall['id']}",
                "last_verified_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="shortage_id",
        ).execute()
        log.info(
            "Auto-created anticipated shortage from Class I recall",
            extra={"drug_id": drug_id, "recall_uuid": recall["id"]},
        )
        return True
    except Exception as exc:
        log.warning("Auto-shortage creation failed", extra={"error": str(exc)})
        return False
