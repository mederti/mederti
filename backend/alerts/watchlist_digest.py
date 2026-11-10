"""
Daily watchlist digest — one email per user, only when something changed.
────────────────────────────────────────────────────────────────────────────────
Replaces per-row alerts from dispatch_pending_alerts(), which sent one email
per shortage_status_log row across every country. That log is noisy (in the
week to 2026-10-25: 3,574 active→active rows and ~750 resolved↔active flips),
so a watcher of a common medicine would have had many emails a day.

For every active watch (email channel on) the job works out the medicine's tier
in the watcher's market — the same rules as /api/watchlist/risk-board:

    short_now      an active shortage in the market
    anticipated    an anticipated shortage in the market
    early_warning  active in ≥2 of the market's peers, not in the market
    watching       none of the above

and compares it with the tier stored at the last digest (watchlist_alert_state,
migration 075). Transitions go into one email per user. The first time a watch
is seen its tier is stored silently, so the first run doesn't send everyone a
"change". Synthetic rows (FDA MedWatch recalls) are excluded.

Market = the watch's first country, else the user's first profile country.
Watches with neither are skipped and counted.

Every email carries a one-click unsubscribe link signed with
HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, user_id) — verified by
/api/alerts/unsubscribe, which turns email off on all the user's watches.

Usage:
    python3 -m backend.alerts.watchlist_digest --dry-run           # write HTML, send nothing, store nothing
    python3 -m backend.alerts.watchlist_digest --dry-run --all     # also preview unchanged watches
    python3 -m backend.alerts.watchlist_digest                     # send + update state
Cron: daily, after the scrapers and the risk score (cron/crontab_fixed.txt).
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import html
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.alerts.resend_client import send_email  # noqa: E402
from backend.utils.db import get_supabase_client      # noqa: E402
from backend.utils.logger import get_logger           # noqa: E402

log = get_logger("mederti.alerts.watchlist_digest")

SITE = os.getenv("MEDERTI_SITE_URL", "https://www.mederti.com").rstrip("/")

# Mirrors PEER_GROUPS in /api/watchlist/risk-board and /api/predictive-signals.
PEER_GROUPS: dict[str, list[str]] = {
    "GB": ["IE", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
    "IE": ["GB", "IT", "DE", "FR", "ES", "BE", "NL", "PT", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
    "AU": ["NZ", "GB", "US", "CA", "SG"],
    "NZ": ["AU", "GB", "US", "CA", "SG"],
    "CA": ["US", "GB", "EU", "FR", "DE", "AU"],
    "US": ["CA", "GB", "EU", "FR", "DE"],
    "IT": ["DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
    "DE": ["IT", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
    "FR": ["IT", "DE", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
    "ES": ["IT", "DE", "FR", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "GB", "EU"],
}

COUNTRY_NAMES = {
    "AU": "Australia", "US": "the United States", "GB": "the United Kingdom", "CA": "Canada",
    "NZ": "New Zealand", "IE": "Ireland", "DE": "Germany", "FR": "France", "IT": "Italy",
    "ES": "Spain", "SG": "Singapore", "EU": "the EU",
}

TIER_RANK = {"short_now": 3, "anticipated": 2, "early_warning": 1, "watching": 0}


def user_email(user_id: str) -> str | None:
    """Auth admin lookup over REST (the project's db client is PostgREST-only)."""
    import httpx
    url = os.environ["SUPABASE_URL"].rstrip("/") + f"/auth/v1/admin/users/{user_id}"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    try:
        r = httpx.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=15)
        r.raise_for_status()
        return (r.json() or {}).get("email")
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not load user email", extra={"user_id": user_id, "error": str(exc)})
        return None


def unsubscribe_token(user_id: str) -> str:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].encode()
    return hmac.new(key, user_id.encode(), hashlib.sha256).hexdigest()[:32]


def tier_for(country: str, events: list[dict]) -> tuple[str, list[str], str | None]:
    """(tier, peers short, earliest anticipated start) — risk-board rules."""
    peers = set(PEER_GROUPS.get(country, []))
    local_active = [e for e in events if e["country_code"] == country and e["status"] == "active"]
    local_ant = [e for e in events if e["country_code"] == country and e["status"] == "anticipated"]
    peer_short = sorted({e["country_code"] for e in events
                         if e["status"] == "active" and e["country_code"] in peers})
    ant_start = min((e["anticipated_start_date"] for e in local_ant if e.get("anticipated_start_date")), default=None)
    if local_active:
        return "short_now", peer_short, None
    if local_ant:
        return "anticipated", peer_short, ant_start
    if len(peer_short) >= 2:
        return "early_warning", peer_short, None
    return "watching", peer_short, None


def describe(old: str, new: str, country: str, peers: list[str], ant_start: str | None) -> str:
    where = COUNTRY_NAMES.get(country, country)
    if new == "short_now":
        return f"Now reported short in {where}."
    if new == "anticipated":
        return f"A shortage is anticipated in {where}" + (f" from {ant_start}." if ant_start else ".")
    if new == "early_warning":
        return (f"Short in {len(peers)} peer markets ({', '.join(peers)}) but not reported in {where}. "
                "In our history, 13–39% of these were reported here within six months.")
    # → watching
    if old == "short_now":
        return f"No longer reported short in {where}."
    if old == "anticipated":
        return f"The anticipated shortage in {where} has been withdrawn."
    return f"No longer short in two or more of {where}'s peer markets."


def render(email: str, changes: list[dict], unsub_url: str) -> tuple[str, str]:
    worst = max(changes, key=lambda c: TIER_RANK[c["new"]])
    n = len(changes)
    subject = (f"{worst['name']}: {worst['line'].rstrip('.')}" if n == 1
               else f"{n} changes to medicines you watch")
    rows = "".join(
        f'<tr><td style="padding:12px 0;border-top:1px solid #eef2f5;vertical-align:top">'
        f'<a href="{SITE}/drugs/{c["drug_id"]}" style="font-weight:600;color:#0c1118;text-decoration:none">{html.escape(c["name"])}</a>'
        f'<div style="font-size:13px;color:#3b434e;margin-top:3px;line-height:1.5">{html.escape(c["line"])}</div></td></tr>'
        for c in sorted(changes, key=lambda c: -TIER_RANK[c["new"]])
    )
    body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;padding:32px 16px;margin:0">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e8ecf0">
    <div style="font-size:18px;font-weight:700;color:#0fa676;margin-bottom:18px">Mederti</div>
    <h1 style="font-size:18px;font-weight:600;color:#0c1118;margin:0 0 6px">Changes to medicines you watch</h1>
    <p style="font-size:13px;color:#6a7280;margin:0 0 8px">From official regulator shortage reports, as of {datetime.now(timezone.utc).strftime('%-d %b %Y')}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">{rows}</table>
    <a href="{SITE}/insights/dashboard" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#0fa676;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">Open your dashboard</a>
    <div style="margin-top:24px;padding-top:14px;border-top:1px solid #eef2f5;font-size:11.5px;color:#98a1ac;line-height:1.6">
      You're receiving this because you watch these medicines on Mederti. It's sent only when something changes.
      Not medical advice; check the regulator notice before acting.<br>
      <a href="{SITE}/watchlist" style="color:#0c8a62">Manage your watchlist</a> ·
      <a href="{unsub_url}" style="color:#0c8a62">Stop these emails</a>
    </div>
  </div>
</body></html>"""
    return subject, body


def run(dry_run: bool, preview_all: bool) -> dict[str, int]:
    db = get_supabase_client()
    counts = {"watches": 0, "no_market": 0, "users_emailed": 0, "changes": 0,
              "initialised": 0, "sent": 0, "failed": 0}

    watches = (db.table("user_watchlists")
               .select("id, user_id, drug_id, countries, notification_channels")
               .eq("is_active", True).execute().data or [])
    watches = [w for w in watches if (w.get("notification_channels") or {}).get("email", True)]
    counts["watches"] = len(watches)
    if not watches:
        return counts

    user_ids = sorted({w["user_id"] for w in watches})
    profiles = {p["user_id"]: p for p in (db.table("user_profiles").select("user_id, countries")
                                            .in_("user_id", user_ids).execute().data or [])}
    drug_ids = sorted({w["drug_id"] for w in watches})
    names = {d["id"]: d["generic_name"] for d in (db.table("drugs").select("id, generic_name")
                                                   .in_("id", drug_ids).execute().data or [])}
    events: dict[str, list[dict]] = defaultdict(list)
    for i in range(0, len(drug_ids), 100):
        for e in (db.table("shortage_events")
                  .select("drug_id, country_code, status, anticipated_start_date")
                  .in_("drug_id", drug_ids[i:i + 100]).in_("status", ["active", "anticipated"])
                  .or_("synthetic.is.null,synthetic.eq.false").execute().data or []):
            if e.get("country_code"):
                e["country_code"] = e["country_code"].upper()
                events[e["drug_id"]].append(e)
    state = {(s["user_id"], s["drug_id"], s["country"]): s
             for s in (db.table("watchlist_alert_state").select("*").in_("user_id", user_ids).execute().data or [])}

    now = datetime.now(timezone.utc).isoformat()
    per_user: dict[str, list[dict]] = defaultdict(list)
    upserts: list[dict[str, Any]] = []
    for w in watches:
        country = ((w.get("countries") or []) or (profiles.get(w["user_id"], {}).get("countries") or []) or [None])[0]
        if not country:
            counts["no_market"] += 1
            continue
        country = country.upper()
        tier, peers, ant_start = tier_for(country, events.get(w["drug_id"], []))
        prev = state.get((w["user_id"], w["drug_id"], country))
        row = {"user_id": w["user_id"], "drug_id": w["drug_id"], "country": country, "tier": tier,
               "peers": peers, "last_seen_at": now,
               "tier_since": prev["tier_since"] if prev and prev["tier"] == tier else now}
        if prev is None:
            counts["initialised"] += 1
            if preview_all:
                per_user[w["user_id"]].append({"drug_id": w["drug_id"], "name": names.get(w["drug_id"], "A medicine"),
                                               "old": tier, "new": tier,
                                               "line": f"(first run, no email) {describe('watching', tier, country, peers, ant_start) if tier != 'watching' else 'In supply in ' + COUNTRY_NAMES.get(country, country) + '.'}",
                                               "watchlist_id": w["id"]})
        elif prev["tier"] != tier:
            per_user[w["user_id"]].append({"drug_id": w["drug_id"], "name": names.get(w["drug_id"], "A medicine"),
                                           "old": prev["tier"], "new": tier,
                                           "line": describe(prev["tier"], tier, country, peers, ant_start),
                                           "watchlist_id": w["id"]})
            counts["changes"] += 1
        upserts.append(row)

    for user_id, changes in per_user.items():
        email = user_email(user_id)
        if not email:
            continue
        unsub = f"{SITE}/api/alerts/unsubscribe?u={user_id}&t={unsubscribe_token(user_id)}"
        subject, body = render(email, changes, unsub)
        if dry_run:
            path = os.path.join("logs", f"digest_preview_{user_id[:8]}.html")
            os.makedirs("logs", exist_ok=True)
            with open(path, "w") as fh:
                fh.write(body)
            print(f"[dry-run] {email}: {subject!r} → {path}")
            continue
        ok, provider_id, error = send_email(
            to=email, subject=subject, html=body,
            headers={"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
        )
        counts["users_emailed" if ok else "failed"] += 1
        counts["sent"] += int(ok)
        db.table("alert_notifications").insert({
            "watchlist_id": changes[0]["watchlist_id"], "channel": "email", "recipient": email,
            "status": "sent" if ok else "failed",
            "sent_at": now if ok else None, "failed_at": None if ok else now,
            "error_message": error, "provider_message_id": provider_id,
            "payload": {"kind": "watchlist_digest", "subject": subject,
                        "changes": [{k: c[k] for k in ("drug_id", "name", "old", "new", "line")} for c in changes]},
        }).execute()
        if ok:
            for c in changes:
                for u in upserts:
                    if u["user_id"] == user_id and u["drug_id"] == c["drug_id"]:
                        u["last_emailed_at"] = now

    if not dry_run and upserts:
        for i in range(0, len(upserts), 200):
            db.table("watchlist_alert_state").upsert(upserts[i:i + 200], on_conflict="user_id,drug_id,country").execute()
    return counts


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
    except ImportError:
        pass
    ap = argparse.ArgumentParser(description="Send the daily watchlist digest.")
    ap.add_argument("--dry-run", action="store_true", help="render HTML to logs/, send and store nothing")
    ap.add_argument("--all", action="store_true", help="with --dry-run, preview first-run watches too")
    args = ap.parse_args()
    counts = run(dry_run=args.dry_run, preview_all=args.all)
    print(f"Watchlist digest{' (dry run)' if args.dry_run else ''}: {counts}")
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
