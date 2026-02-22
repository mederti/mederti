"""
Structured JSON logger for Mederti scrapers.

Every log record is emitted as a single JSON line to stdout so it can be
ingested by any log aggregator (Datadog, CloudWatch, Loki, etc.) without
additional parsing configuration.

Usage:
    from backend.utils.logger import get_logger
    log = get_logger("mederti.scraper.tga")
    log.info("Scrape started", extra={"source": "TGA", "url": "https://..."})
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class _JSONFormatter(logging.Formatter):
    """Formats a LogRecord as a single-line JSON object."""

    # Keys that belong to LogRecord internals — exclude from the JSON output
    _SKIP_KEYS = frozenset(
        logging.LogRecord(
            name="", level=0, pathname="", lineno=0,
            msg="", args=(), exc_info=None,
        ).__dict__.keys()
    ) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()

        payload: dict[str, Any] = {
            "ts":     datetime.now(timezone.utc).isoformat(),
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.message,
        }

        # Attach any extra= kwargs passed at call-site
        for key, val in record.__dict__.items():
            if key not in self._SKIP_KEYS:
                payload[key] = val

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def get_logger(name: str, level: int = logging.DEBUG) -> logging.Logger:
    """
    Returns a named logger that writes structured JSON to stdout.
    Calling get_logger() with the same name returns the same instance.
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = False
    return logger
