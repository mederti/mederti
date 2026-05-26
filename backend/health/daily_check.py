"""Mederti daily data-health check.

Runs every detector in `backend.health.detectors` and emails a digest to
`OPS_ALERT_EMAIL` if any finding is non-OK.

Usage:
    python3 -m backend.health.daily_check                # run + email if needed
    python3 -m backend.health.daily_check --print        # always print, never email
    python3 -m backend.health.daily_check --force-email  # email even when all OK

Exit codes:
    0  — all detectors OK
    1  — at least one warning
    2  — at least one error
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from backend.alerts.resend_client import send_ops_alert
from backend.health.detectors import (
    SEV_ERROR,
    SEV_OK,
    SEV_WARN,
    Finding,
    has_actionable,
    run_all,
)
from backend.utils.logger import get_logger

log = get_logger("mederti.health.daily_check")

# Severity → emoji-free prefix kept readable in plain text logs
_SEV_PREFIX = {
    SEV_OK:    "[ ok ]",
    SEV_WARN:  "[warn]",
    SEV_ERROR: "[ERR ]",
}


def _print_findings(findings: list[Finding]) -> None:
    print(f"Mederti data-health check  @ {datetime.now(timezone.utc).isoformat()}")
    print("-" * 78)
    for f in findings:
        print(f"{_SEV_PREFIX.get(f.severity, '[?]')}  {f.detector}: {f.headline}")
        if f.detail:
            print(f"        {f.detail}")
        if f.metrics:
            print(f"        metrics: {f.metrics}")
        for s in f.samples[:3]:
            print(f"          - {s}")
    print("-" * 78)


def _build_email(findings: list[Finding]) -> tuple[str, str, list[dict]]:
    errors = [f for f in findings if f.severity == SEV_ERROR]
    warns  = [f for f in findings if f.severity == SEV_WARN]

    if errors:
        subject = f"Mederti data-health: {len(errors)} error(s), {len(warns)} warning(s)"
    elif warns:
        subject = f"Mederti data-health: {len(warns)} warning(s)"
    else:
        subject = "Mederti data-health: all clear"

    summary_lines: list[str] = []
    for f in findings:
        summary_lines.append(f"{_SEV_PREFIX.get(f.severity, '[?]')}  {f.detector} — {f.headline}")
        if f.detail:
            summary_lines.append(f"      {f.detail}")
        if f.metrics:
            metric_kv = "  ".join(f"{k}={v}" for k, v in f.metrics.items())
            summary_lines.append(f"      {metric_kv}")
        for s in f.samples[:3]:
            summary_lines.append(f"        · {s}")
        summary_lines.append("")

    summary = "\n".join(summary_lines).rstrip()

    # Build a compact row table for the actionable ones
    rows: list[dict] = []
    for f in findings:
        if f.severity == SEV_OK:
            continue
        rows.append({
            "detector": f.detector,
            "severity": f.severity,
            "headline": f.headline,
            "metric":   " ".join(f"{k}={v}" for k, v in f.metrics.items())[:120],
        })

    return subject, summary, rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true",
                        help="Print findings and never email.")
    parser.add_argument("--force-email", action="store_true",
                        help="Email even when all findings are OK.")
    args = parser.parse_args(argv)

    findings = run_all()
    _print_findings(findings)

    actionable = has_actionable(findings)
    should_email = not args.print and (args.force_email or actionable)

    if should_email:
        to = os.environ.get("OPS_ALERT_EMAIL", "").strip()
        if to:
            subject, summary, rows = _build_email(findings)
            ok = send_ops_alert(to=to, subject=subject, summary=summary, rows=rows)
            log.info(
                "Daily health digest sent",
                extra={"to": to, "sent": ok, "actionable": actionable},
            )
        else:
            log.warning(
                "OPS_ALERT_EMAIL not configured — health digest not sent",
                extra={"actionable": actionable},
            )

    if any(f.severity == SEV_ERROR for f in findings):
        return 2
    if any(f.severity == SEV_WARN for f in findings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
