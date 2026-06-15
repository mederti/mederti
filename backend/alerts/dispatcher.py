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
from backend.alerts.resend_client import send_shortage_alert, send_recall_alert, send_concession_alert

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


_CUR_SYM = {"GBP": "£", "USD": "US$", "EUR": "€", "AUD": "A$", "NZD": "NZ$", "CAD": "C$"}


def _month_label(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%B %Y")
    except Exception:
        return None


def _prior_month(ym: str) -> str:
    """'2026-06' → '2026-05'; '2026-01' → '2025-12'."""
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def dispatch_concession_alerts() -> dict[str, int]:
    """
    Dispatch price-concession early-warning alerts.

    A concession (regulator paying above the standard tariff because pharmacies
    can't source at price) is a supply-pressure signal that often PRECEDES a
    formal shortage listing. For each watched drug that has NEWLY entered
    concession in a market (a recently-scraped concession row whose effective
    month is current AND with no concession in the immediately-prior month — so
    monthly roll-overs don't re-spam), alert the active watchers.

    Dedup model mirrors dispatch_recall_alerts(): a recency window on
    created_at, intended to run once per NHS-scraper cadence (weekly). The
    prior-month guard makes each new entry alert at most once per concession
    episode.

    Returns: {"processed": n, "sent": n, "failed": n, "no_watchers": n,
              "rollover_skipped": n}
    """
    db = get_supabase_client()
    summary: dict[str, int] = {
        "processed": 0, "sent": 0, "failed": 0, "no_watchers": 0, "rollover_skipped": 0,
    }

    from datetime import timedelta
    now = datetime.now(timezone.utc)
    created_cutoff = (now - timedelta(days=8)).isoformat()       # since last weekly run
    active_cutoff = (now - timedelta(days=75)).date().isoformat()  # current concession only

    try:
        rows_resp = (
            db.table("drug_pricing_history")
            .select("drug_id, country, product_name, pack_price, currency, pack_description, effective_date")
            .eq("price_type", "concession")
            .gte("created_at", created_cutoff)
            .gte("effective_date", active_cutoff)
            .not_.is_("drug_id", "null")
            .limit(3000)
            .execute()
        )
        rows: list[dict[str, Any]] = rows_resp.data or []
    except Exception as exc:
        # Table/columns not present (pre-migration-055) → nothing to do.
        log.info("Concession alerts skipped — drug_pricing_history not queryable",
                 extra={"error": str(exc)})
        return summary

    if not rows:
        log.info("No newly-published concessions to alert on")
        return summary

    # One representative per (drug, country): latest effective_date.
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        key = (r["drug_id"], r["country"])
        cur = by_key.get(key)
        if cur is None or (r.get("effective_date") or "") > (cur.get("effective_date") or ""):
            by_key[key] = r

    # Roll-over guard: fetch concession month-history for these drugs so we can
    # tell a NEW entry from a month-to-month continuation.
    drug_ids = list({k[0] for k in by_key})
    months_by_key: dict[tuple[str, str], set[str]] = {}
    if drug_ids:
        try:
            hist = (
                db.table("drug_pricing_history")
                .select("drug_id, country, effective_date")
                .eq("price_type", "concession")
                .in_("drug_id", drug_ids)
                .gte("effective_date", (now - timedelta(days=140)).date().isoformat())
                .limit(5000)
                .execute()
            ).data or []
            for h in hist:
                mk = (h["drug_id"], h["country"])
                months_by_key.setdefault(mk, set()).add((h.get("effective_date") or "")[:7])
        except Exception as exc:
            log.warning("Could not load concession history for roll-over guard",
                        extra={"error": str(exc)})

    log.info(f"Evaluating {len(by_key)} drug-market concessions for alerts")

    for (drug_id, country), r in by_key.items():
        month = (r.get("effective_date") or "")[:7]
        if month and _prior_month(month) in months_by_key.get((drug_id, country), set()):
            summary["rollover_skipped"] += 1
            continue

        try:
            watchers = (
                db.table("user_watchlists")
                .select("id, user_id, notification_channels")
                .eq("drug_id", drug_id)
                .eq("is_active", True)
                .execute()
            ).data or []
            if not watchers:
                summary["no_watchers"] += 1
                summary["processed"] += 1
                continue

            drug_name = (
                (db.table("drugs").select("generic_name").eq("id", drug_id).single().execute()).data or {}
            ).get("generic_name", "a watched medicine")

            # Corroborating shortage footprint = distinct OTHER markets short now.
            sh = (
                db.table("shortage_events")
                .select("country_code")
                .eq("drug_id", drug_id)
                .eq("status", "active")
                .limit(500)
                .execute()
            ).data or []
            short_count = len({
                x["country_code"] for x in sh
                if x.get("country_code") and x["country_code"] != country
            })

            price_str = None
            if r.get("pack_price") is not None:
                sym = _CUR_SYM.get(r.get("currency") or "", (r.get("currency") or "") + " ")
                try:
                    price_str = f"{sym}{float(r['pack_price']):.2f}"
                except (TypeError, ValueError):
                    price_str = None

            drug_url = f"https://mederti.com/drugs/{drug_id}"

            for w in watchers:
                channels = w.get("notification_channels") or {}
                if not channels.get("email", True):
                    continue
                try:
                    user_resp = db.auth.admin.get_user_by_id(w["user_id"])
                    email: str | None = getattr(getattr(user_resp, "user", None), "email", None)
                except Exception as exc:
                    log.warning("Could not retrieve user email for concession alert",
                                extra={"user_id": w["user_id"], "error": str(exc)})
                    email = None
                if not email:
                    continue

                sent = send_concession_alert(
                    to=email,
                    drug_name=drug_name,
                    country_code=country,
                    concession_price=price_str,
                    pack=r.get("pack_description"),
                    effective_month=_month_label(r.get("effective_date")),
                    short_in_count=short_count,
                    drug_url=drug_url,
                )
                now_iso = datetime.now(timezone.utc).isoformat()
                try:
                    db.table("alert_notifications").insert({
                        "watchlist_id": w["id"],
                        "channel": "email",
                        "recipient": email,
                        "status": "sent" if sent else "failed",
                        **({"sent_at": now_iso} if sent else {"failed_at": now_iso}),
                    }).execute()
                except Exception as exc:
                    log.warning("Could not record concession alert_notification",
                                extra={"error": str(exc), "recipient": email})

                summary["sent" if sent else "failed"] += 1

        except Exception as exc:
            log.error("Error processing concession alert",
                      extra={"drug_id": drug_id, "error": str(exc)}, exc_info=True)
            summary["failed"] += 1

        summary["processed"] += 1

    log.info("Concession alert dispatch complete", extra=summary)
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
