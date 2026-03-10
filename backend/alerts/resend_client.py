"""
Resend email client for Mederti alert dispatch.

If RESEND_API_KEY is not set, all sends are stubbed (logged instead of sent).
Designed to fail gracefully so scraper runs are never blocked by email issues.
"""

from __future__ import annotations

import os

import httpx

from backend.utils.logger import get_logger

log = get_logger("mederti.alerts.resend")

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM    = os.getenv("RESEND_FROM_EMAIL", "intelligence@mederti.com")
_API_URL       = "https://api.resend.com/emails"

_STUBBED = not RESEND_API_KEY or RESEND_API_KEY.startswith("re_placeholder")


def send_shortage_alert(
    to: str,
    drug_name: str,
    old_status: str | None,
    new_status: str,
    shortage_url: str | None = None,
) -> bool:
    """
    Send a shortage status-change alert email.
    Returns True if sent successfully, False if stubbed or failed.
    """
    if _STUBBED:
        log.info(
            "RESEND_API_KEY not configured — stubbing shortage alert",
            extra={"to": to, "drug_name": drug_name, "new_status": new_status},
        )
        return False

    subject = f"Mederti Alert: {drug_name} — status changed to {new_status}"
    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:36px 40px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:700;color:#0d9488;letter-spacing:-0.02em;margin-bottom:20px">Mederti</div>
    <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 12px">Shortage Status Update</h1>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0 0 16px">
      The shortage status for <strong style="color:#0f172a">{drug_name}</strong> has changed.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Previous status</div>
      <div style="font-size:15px;font-weight:500;color:#64748b">{old_status or "Unknown"}</div>
      <div style="font-size:13px;color:#94a3b8;margin:10px 0 4px">New status</div>
      <div style="font-size:15px;font-weight:600;color:#0f172a">{new_status}</div>
    </div>
    {f'<a href="{shortage_url}" style="display:inline-block;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">View full details →</a>' if shortage_url else ''}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8">
      Mederti · You're receiving this because you set a watchlist alert.<br>
      <a href="https://mederti.com/dashboard" style="color:#0d9488">Manage your alerts →</a>
    </div>
  </div>
</body>
</html>"""

    try:
        resp = httpx.post(
            _API_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": RESEND_FROM, "to": [to], "subject": subject, "html": html},
            timeout=15.0,
        )
        resp.raise_for_status()
        log.info("Shortage alert sent", extra={"to": to, "drug_name": drug_name})
        return True
    except Exception as exc:
        log.error(
            "Failed to send shortage alert",
            extra={"error": str(exc), "to": to, "drug_name": drug_name},
        )
        return False


def send_recall_alert(
    to: str,
    drug_name: str,
    country_code: str,
    reason: str | None = None,
    lot_numbers: list[str] | None = None,
    press_release_url: str | None = None,
) -> bool:
    """
    Send an URGENT Class I recall alert email.
    Returns True if sent successfully, False if stubbed or failed.
    """
    if _STUBBED:
        log.info(
            "RESEND_API_KEY not configured — stubbing recall alert",
            extra={"to": to, "drug_name": drug_name, "country_code": country_code},
        )
        return False

    subject = f"URGENT: Class I Recall — {drug_name} ({country_code})"
    lots_html = ""
    if lot_numbers:
        lot_list = ", ".join(lot_numbers[:10])
        lots_html = f"""
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#dc2626;margin-bottom:4px">Affected Lot Numbers</div>
      <div style="font-size:14px;font-family:monospace;color:#0f172a">{lot_list}</div>
    </div>"""

    reason_html = ""
    if reason:
        reason_html = f"""
    <div style="margin-bottom:16px">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">Reason for recall</div>
      <div style="font-size:14px;color:#0f172a;line-height:1.6">{reason[:400]}</div>
    </div>"""

    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;margin:0">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:36px 40px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:700;color:#0d9488;letter-spacing:-0.02em;margin-bottom:20px">Mederti</div>
    <div style="background:#dc2626;color:#fff;border-radius:6px;padding:8px 14px;display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:16px">
      ⚠ URGENT: Class I Recall
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 8px">{drug_name}</h1>
    <p style="font-size:13px;color:#64748b;margin:0 0 20px">
      Country: <strong>{country_code}</strong> · Class I Recall (most serious classification)
    </p>
    {reason_html}
    {lots_html}
    <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0 0 20px">
      A Class I recall indicates a situation where there is a reasonable probability that use of the product will cause serious adverse health consequences or death. Check your supply and take action immediately.
    </p>
    {f'<a href="{press_release_url}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">View full recall notice →</a>' if press_release_url else ''}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8">
      Mederti · You're receiving this because you watched <strong>{drug_name}</strong>.<br>
      <a href="https://mederti.com/dashboard" style="color:#0d9488">Manage your watchlist →</a>
    </div>
  </div>
</body>
</html>"""

    try:
        resp = httpx.post(
            _API_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": RESEND_FROM, "to": [to], "subject": subject, "html": html},
            timeout=15.0,
        )
        resp.raise_for_status()
        log.info("Class I recall alert sent", extra={"to": to, "drug_name": drug_name})
        return True
    except Exception as exc:
        log.error(
            "Failed to send recall alert",
            extra={"error": str(exc), "to": to, "drug_name": drug_name},
        )
        return False


def send_welcome_email(to: str) -> bool:
    """
    Send a welcome email to a new subscriber.
    Returns True if sent successfully, False if stubbed or failed.
    """
    if _STUBBED:
        log.info(
            "RESEND_API_KEY not configured — stubbing welcome email",
            extra={"to": to},
        )
        return False

    subject = "You're on the Mederti list"
    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:36px 40px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:700;color:#0d9488;margin-bottom:20px">Mederti</div>
    <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 12px">You're on the list.</h1>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0 0 20px">
      Thanks for signing up for Mederti intelligence. We'll keep you informed on
      global pharmaceutical shortage developments affecting your region.
    </p>
    <a href="https://mederti.com/dashboard"
       style="display:inline-block;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
      View the Dashboard →
    </a>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8">
      Mederti · Global Pharmaceutical Shortage Intelligence<br>
      {to} · <a href="https://mederti.com" style="color:#0d9488">mederti.com</a>
    </div>
  </div>
</body>
</html>"""

    try:
        resp = httpx.post(
            _API_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": RESEND_FROM, "to": [to], "subject": subject, "html": html},
            timeout=15.0,
        )
        resp.raise_for_status()
        log.info("Welcome email sent", extra={"to": to})
        return True
    except Exception as exc:
        log.error("Failed to send welcome email", extra={"error": str(exc), "to": to})
        return False
