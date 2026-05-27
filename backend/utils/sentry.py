"""
Sentry initialisation for Mederti scrapers.

Init is called from every cron entry point:

    from backend.utils.sentry import init_sentry
    init_sentry("shortage-scrapers")  # or "recall-scrapers", "run-all", etc.

Inert until SENTRY_DSN is set in env. Required env vars when active:

    SENTRY_DSN        — project DSN (Settings → Client Keys in Sentry)

Optional:

    SENTRY_ENVIRONMENT          — defaults to 'production'
    SENTRY_RELEASE              — defaults to short git SHA if available
    SENTRY_TRACES_SAMPLE_RATE   — defaults to 0.05 (scrapers are noisy;
                                  performance traces matter less than
                                  exception capture)
"""

from __future__ import annotations

import logging
import os
import subprocess
from typing import Optional


_initialized = False
_log = logging.getLogger(__name__)


def _git_sha_short() -> Optional[str]:
    """Best-effort short git SHA for release tagging. None on failure."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip() or None
    except Exception:
        return None


def init_sentry(component: str = "scrapers") -> None:
    """
    Initialise Sentry for the current process.

    Args:
        component: short label identifying which entry point called this
                   (e.g. 'shortage-scrapers', 'recall-scrapers', 'run-all').
                   Used as a tag on every captured event so dashboard
                   filtering works without parsing logger names.

    Safe to call multiple times — only the first call initialises.
    """
    global _initialized
    if _initialized:
        return

    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        # Inert mode — no DSN provisioned yet. Don't warn at every cron run;
        # silence keeps the log signal clean.
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        # sentry-sdk not installed — log once and continue.
        _log.warning("sentry-sdk not installed; skipping init")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        release=os.getenv("SENTRY_RELEASE") or _git_sha_short(),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05")),
        # Pull ERROR logs through as Sentry events automatically. WARNINGs
        # stay as breadcrumbs (visible on the surrounding event but not
        # alerting on their own).
        integrations=[
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        # Send PII off by default — scraper logs shouldn't carry user
        # identifiers but be explicit.
        send_default_pii=False,
    )
    sentry_sdk.set_tag("component", component)
    _initialized = True
