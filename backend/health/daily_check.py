"""Mederti daily data-health check.

Runs every detector in `backend.health.detectors` and emails a digest to
`OPS_ALERT_EMAIL` if any finding is non-OK.

Usage:
    python3 -m backend.health.daily_check                # run + email if needed
    python3 -m backend.health.daily_check --print        # always print, never email
    python3 -m backend.health.daily_check --force-email  # email even when all OK
    python3 -m backend.health.daily_check --with-scenarios --persist --runner railway:shortage-cron-daily
        # FULL daily check (what Railway runs): detectors + live-site scenario
        # suite, result saved to data_health_runs for /admin/freshness

Exit codes:
    0  — all detectors OK
    1  — at least one warning
    2  — at least one error
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

from backend.alerts.resend_client import send_ops_alert
from backend.health.detectors import (
    SEV_ERROR,
    SEV_INFO,
    SEV_OK,
    SEV_WARN,
    Finding,
    has_actionable,
    run_all,
)
from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.health.daily_check")

# Severity → emoji-free prefix kept readable in plain text logs
_SEV_PREFIX = {
    SEV_OK:    "[ ok ]",
    SEV_INFO:  "[info]",
    SEV_WARN:  "[warn]",
    SEV_ERROR: "[ERR ]",
}


def _print_findings(findings: list[Finding]) -> None:
    print(f"Mederti data-health check  @ {datetime.now(timezone.utc).isoformat()}")
    print("-" * 78)
    for f in findings:
        print(f"{_SEV_PREFIX.get(f.severity, '[?]')}  {f.detector}: {f.headline}")
        if f.detail:
            print(f"        {f.detail.splitlines()[0][:300]}")
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


def run_scenario_suite() -> tuple[Finding, dict | None]:
    """Run the live-site scenario suite (backend.scenarios.run_scenarios) and
    fold it into one Finding. A crash or timeout is an error, never a pass."""
    name = "scenario_suite"
    with tempfile.TemporaryDirectory() as out:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "backend.scenarios.run_scenarios", "--out", out],
                capture_output=True, text=True, timeout=45 * 60,
            )
        except subprocess.TimeoutExpired:
            return Finding(name, SEV_ERROR, "Scenario suite timed out after 45 min"), None
        reports = glob.glob(os.path.join(out, "*.json"))
        if not reports:
            tail = (proc.stderr or proc.stdout or "")[-400:]
            return Finding(name, SEV_ERROR, "Scenario suite produced no report", detail=tail), None
        with open(reports[0]) as f:
            report = json.load(f)

    results = report.get("results", [])
    failed = [r for r in results if r.get("status") == "FAIL"]
    gaps = [r for r in results if r.get("status") == "KNOWN GAP"]
    summary = {
        "date": report.get("date"),
        "base": report.get("base"),
        "results": [
            {"id": r["id"], "title": r.get("title"), "status": r.get("status"),
             "passed": r.get("passed"), "failed": r.get("failed"),
             "failures": (r.get("failures") or [])[:5]}
            for r in results
        ],
    }
    metrics = {"scenarios": len(results), "failed": len(failed), "known_gaps": len(gaps)}
    if not failed:
        return Finding(name, SEV_OK, f"All {len(results) - len(gaps)} scenarios pass on the live site",
                       metrics=metrics), summary
    return Finding(
        name, SEV_ERROR,
        f"{len(failed)} scenario(s) fail on the live site: " + ", ".join(r["id"] for r in failed),
        detail="What a pharmacist sees on www.mederti.com disagrees with the regulator record.",
        metrics=metrics,
        samples=[{"id": r["id"], "title": r.get("title"), "failure": (r.get("failures") or [""])[0][:160]}
                 for r in failed],
    ), summary


def _split_source_counts(findings: list[Finding]) -> dict | None:
    """The drift detector returns every source's open count in its metrics;
    pull that out so it's persisted as source_counts, not printed/emailed."""
    counts = None
    for f in findings:
        if "source_counts" in f.metrics:
            counts = f.metrics.pop("source_counts")
    return counts


def persist_run(findings: list[Finding], scenarios: dict | None, source_counts: dict | None,
                runner: str, duration_s: float) -> bool:
    errors = sum(f.severity == SEV_ERROR for f in findings)
    warns = sum(f.severity == SEV_WARN for f in findings)
    row = {
        "runner": runner,
        "overall": "error" if errors else ("warn" if warns else "ok"),
        "errors": errors,
        "warnings": warns,
        "findings": [f.to_dict() for f in findings],
        "scenarios": scenarios,
        "source_counts": source_counts,
        "duration_s": round(duration_s, 1),
    }
    try:
        get_supabase_client().table("data_health_runs").insert(json.loads(json.dumps(row, default=str))).execute()
        return True
    except Exception as exc:
        log.error("Could not persist data_health_runs row", extra={"error": str(exc)})
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true",
                        help="Print findings and never email.")
    parser.add_argument("--force-email", action="store_true",
                        help="Email even when all findings are OK.")
    parser.add_argument("--with-scenarios", action="store_true",
                        help="Also run the live-site scenario suite.")
    parser.add_argument("--persist", action="store_true",
                        help="Save the run to data_health_runs (shown on /admin/freshness).")
    parser.add_argument("--runner", default=os.environ.get("MEDERTI_HEALTH_RUNNER", "manual"),
                        help="Label recorded with the persisted run.")
    args = parser.parse_args(argv)

    t0 = time.time()
    findings = run_all()
    scenarios = None
    if args.with_scenarios:
        f, scenarios = run_scenario_suite()
        findings.append(f)
    source_counts = _split_source_counts(findings)
    _print_findings(findings)

    if args.persist:
        ok = persist_run(findings, scenarios, source_counts, args.runner, time.time() - t0)
        print(f"persisted to data_health_runs: {ok}")

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
