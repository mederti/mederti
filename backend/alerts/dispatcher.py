"""
dispatch_pending_alerts() — Alert dispatcher for Mederti.

Processing loop:
    1. Fetch shortage_status_log rows where alert_sent = FALSE
    2. For each: find all active user_watchlists for that drug
    3. Retrieve user email via Supabase Auth admin API
    4. Send shortage alert via Resend
    5. Record in alert_notifications (success or failure)
    6. Mark shortage_status_log.alert_sent = TRUE

Call this after each scraper run from run_all_scrapers.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger
from backend.alerts.resend_client import send_shortage_alert, send_recall_alert

log = get_logger("mederti.alerts.dispatcher")


def dispatch_pending_alerts() -> dict[str, int]:
    """
    Process all unprocessed shortage_status_log entries.
    Returns summary: {"processed": n, "sent": n, "failed": n, "no_watchers": n}
    """
    db = get_supabase_client()
    summary: dict[str, int] = {"processed": 0, "sent": 0, "failed": 0, "no_watchers": 0}

    # ── 1. Fetch unprocessed status-change log entries ────────────────────────
    logs_resp = (
        db.table("shortage_status_log")
        .select("id, shortage_event_id, drug_id, old_status, new_status, old_severity, new_severity")
        .eq("alert_sent", False)
        .limit(500)  # safety cap per run
        .execute()
    )
    logs: list[dict[str, Any]] = logs_resp.data or []

    if not logs:
        log.info("No pending alerts to dispatch")
        return summary

    log.info(f"Dispatching alerts for {len(logs)} status changes")

    for entry in logs:
        drug_id           = entry["drug_id"]
        shortage_event_id = entry["shortage_event_id"]
        log_id            = entry["id"]

        try:
            # ── 2. Fetch drug name ────────────────────────────────────────────
            drug_resp = (
                db.table("drugs")
                .select("generic_name")
                .eq("id", drug_id)
                .single()
                .execute()
            )
            drug_name: str = (drug_resp.data or {}).get("generic_name", "Unknown drug")

            # ── 3. Fetch shortage source URL ──────────────────────────────────
            ev_resp = (
                db.table("shortage_events")
                .select("source_url")
                .eq("id", shortage_event_id)
                .single()
                .execute()
            )
            source_url: str | None = (ev_resp.data or {}).get("source_url")

            # ── 4. Fetch active watchers ──────────────────────────────────────
            watches_resp = (
                db.table("user_watchlists")
                .select("id, user_id, notification_channels")
                .eq("drug_id", drug_id)
                .eq("is_active", True)
                .execute()
            )
            watchers: list[dict[str, Any]] = watches_resp.data or []

            if not watchers:
                summary["no_watchers"] += 1
                _mark_sent(db, log_id)
                continue

            # ── 5. Send alert to each watcher ─────────────────────────────────
            for watcher in watchers:
                watchlist_id         = watcher["id"]
                user_id              = watcher["user_id"]
                notification_channels = watcher.get("notification_channels") or {}

                if not notification_channels.get("email", True):
                    continue

                # Retrieve email via Supabase Auth admin API
                try:
                    user_resp = db.auth.admin.get_user_by_id(user_id)
                    email: str | None = getattr(getattr(user_resp, "user", None), "email", None)
                except Exception as exc:
                    log.warning(
                        "Could not retrieve user email",
                        extra={"user_id": user_id, "error": str(exc)},
                    )
                    email = None

                if not email:
                    continue

                sent = send_shortage_alert(
                    to=email,
                    drug_name=drug_name,
                    old_status=entry.get("old_status"),
                    new_status=entry["new_status"],
                    shortage_url=source_url,
                )

                # ── 6. Record dispatch in alert_notifications ─────────────────
                now_iso = datetime.now(timezone.utc).isoformat()
                _record_notification(
                    db=db,
                    watchlist_id=watchlist_id,
                    shortage_event_id=shortage_event_id,
                    recipient=email,
                    sent=sent,
                    now_iso=now_iso,
                )

                if sent:
                    summary["sent"] += 1
                else:
                    summary["failed"] += 1

        except Exception as exc:
            log.error(
                "Error processing alert log entry",
                extra={"log_id": log_id, "error": str(exc)},
                exc_info=True,
            )
            summary["failed"] += 1

        # Mark log entry as processed regardless of send outcome
        _mark_sent(db, log_id)
        summary["processed"] += 1

    log.info("Alert dispatch complete", extra=summary)
    return summary


def dispatch_recall_alerts() -> dict[str, int]:
    """
    Dispatch Class I recall alerts for newly-created recalls (last 24h).

    For each Class I recall created in the last 24h with a resolved drug_id:
      1. Find active user_watchlists for that drug
      2. Send URGENT recall alert email
      3. Record in alert_notifications (shortage_event_id=NULL)

    Returns: {"processed": n, "sent": n, "failed": n, "no_watchers": n}
    """
    db = get_supabase_client()
    summary: dict[str, int] = {"processed": 0, "sent": 0, "failed": 0, "no_watchers": 0}

    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    recalls_resp = (
        db.table("recalls")
        .select("id, drug_id, generic_name, country_code, reason, lot_numbers, press_release_url")
        .eq("recall_class", "I")
        .not_.is_("drug_id", "null")
        .gte("created_at", cutoff)
        .limit(200)
        .execute()
    )
    recalls: list[dict[str, Any]] = recalls_resp.data or []

    if not recalls:
        log.info("No new Class I recalls to alert on")
        return summary

    log.info(f"Dispatching Class I recall alerts for {len(recalls)} recalls")

    for recall in recalls:
        drug_id   = recall["drug_id"]
        recall_id = recall["id"]

        try:
            # Fetch active watchers
            watches_resp = (
                db.table("user_watchlists")
                .select("id, user_id, notification_channels")
                .eq("drug_id", drug_id)
                .eq("is_active", True)
                .execute()
            )
            watchers: list[dict[str, Any]] = watches_resp.data or []

            if not watchers:
                summary["no_watchers"] += 1
                summary["processed"] += 1
                continue

            for watcher in watchers:
                watchlist_id  = watcher["id"]
                user_id       = watcher["user_id"]
                channels      = watcher.get("notification_channels") or {}

                if not channels.get("email", True):
                    continue

                try:
                    user_resp = db.auth.admin.get_user_by_id(user_id)
                    email: str | None = getattr(getattr(user_resp, "user", None), "email", None)
                except Exception as exc:
                    log.warning("Could not retrieve user email for recall alert",
                                extra={"user_id": user_id, "error": str(exc)})
                    email = None

                if not email:
                    continue

                # send_recall_alert may not exist yet — fall back to send_shortage_alert
                try:
                    sent = send_recall_alert(
                        to=email,
                        drug_name=recall["generic_name"],
                        country_code=recall["country_code"],
                        reason=recall.get("reason"),
                        lot_numbers=recall.get("lot_numbers") or [],
                        press_release_url=recall.get("press_release_url"),
                    )
                except (AttributeError, TypeError):
                    # Fallback if send_recall_alert not yet implemented
                    sent = send_shortage_alert(
                        to=email,
                        drug_name=recall["generic_name"],
                        old_status=None,
                        new_status="Class I Recall",
                        shortage_url=recall.get("press_release_url"),
                    )

                now_iso = datetime.now(timezone.utc).isoformat()
                try:
                    db.table("alert_notifications").insert({
                        "watchlist_id":  watchlist_id,
                        "channel":       "email",
                        "recipient":     email,
                        "status":        "sent" if sent else "failed",
                        **({
                            "sent_at": now_iso,
                        } if sent else {
                            "failed_at": now_iso,
                        }),
                    }).execute()
                except Exception as exc:
                    log.warning("Could not record recall alert_notification",
                                extra={"error": str(exc), "recipient": email})

                if sent:
                    summary["sent"] += 1
                else:
                    summary["failed"] += 1

        except Exception as exc:
            log.error("Error processing recall alert",
                      extra={"recall_id": recall_id, "error": str(exc)}, exc_info=True)
            summary["failed"] += 1

        summary["processed"] += 1

    log.info("Recall alert dispatch complete", extra=summary)
    return summary


def _mark_sent(db: Any, log_id: str) -> None:
    """Mark a shortage_status_log entry as alert_sent = TRUE."""
    db.table("shortage_status_log").update({"alert_sent": True}).eq("id", log_id).execute()


def _record_notification(
    db: Any,
    watchlist_id: str,
    shortage_event_id: str,
    recipient: str,
    sent: bool,
    now_iso: str,
) -> None:
    """Insert a row into alert_notifications recording the dispatch attempt."""
    row: dict[str, Any] = {
        "watchlist_id":       watchlist_id,
        "shortage_event_id":  shortage_event_id,
        "channel":            "email",
        "recipient":          recipient,
        "status":             "sent" if sent else "failed",
    }
    if sent:
        row["sent_at"] = now_iso
    else:
        row["failed_at"] = now_iso

    try:
        db.table("alert_notifications").insert(row).execute()
    except Exception as exc:
        log.warning(
            "Could not record alert_notification row",
            extra={"error": str(exc), "recipient": recipient},
        )
