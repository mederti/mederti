"""Lightweight base for eligibility scrapers.

Conventions
-----------
Subclasses define:
  SCHEME           — one of: tga_s19a | mhra_ssp | dhsc_msn | fda_503b |
                     fda_shortage | eu_art_5_2 | other
  COUNTRY_CODE     — ISO-2 of the issuing regulator
  SOURCE_NAME      — human-readable name for the source listing
  SOURCE_URL       — canonical URL of the published listing
  USER_AGENT       — UA string (default OK)

And implement:
  fetch(self) -> str|bytes  — HTTP GET against SOURCE_URL (or a paginated set)
  parse(self, payload)      — yield EligibilityRow dicts

The base handles:
  • Supabase REST upsert with deterministic conflict-key resolution
  • last_verified_at refresh for re-confirmed entries (status='active' rows
    re-found in the source on this run keep their timestamps fresh)
  • status='lapsed' marking for rows the source removed but we previously saw

Schema reference: supabase/migrations/040_regulatory_eligibility.sql
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterable

LOG = logging.getLogger("eligibility")
if not LOG.handlers:
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    LOG.addHandler(h)
    LOG.setLevel(logging.INFO)


@dataclass
class EligibilityRow:
    """One row to upsert into regulatory_eligibility."""
    generic_name: str
    country_code: str
    scheme: str
    status: str = "active"
    brand_name: str | None = None
    scheme_reference: str | None = None
    description: str | None = None
    listed_at: str | None = None  # ISO date
    expires_at: str | None = None
    withdrawn_at: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)


class EligibilityScraper(ABC):
    SCHEME: str = "other"
    COUNTRY_CODE: str = ""
    SOURCE_NAME: str = ""
    SOURCE_URL: str = ""
    USER_AGENT: str = "MedertiBot/1.0 (eligibility scraper; contact@mederti.com)"

    def __init__(self) -> None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set "
                "(source .env at the repo root before invoking)."
            )
        self.supabase_url = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }

    # ─── lifecycle ────────────────────────────────────────────────────────

    def run(self) -> dict[str, int]:
        self.log("starting")
        try:
            payload = self.fetch()
        except Exception as e:
            self.log(f"fetch failed: {e}", level="error")
            return {"fetched": 0, "upserted": 0, "lapsed": 0, "errors": 1}

        rows = list(self.parse(payload))
        self.log(f"parsed {len(rows)} rows")

        upserted = self._upsert_all(rows)
        lapsed = self._mark_missing_as_lapsed(rows)
        self.log(f"upserted {upserted}, lapsed {lapsed}")
        return {"fetched": len(rows), "upserted": upserted, "lapsed": lapsed, "errors": 0}

    # ─── subclass hooks ───────────────────────────────────────────────────

    @abstractmethod
    def fetch(self) -> Any:
        """HTTP GET against SOURCE_URL (or paginated set). Return raw payload."""

    @abstractmethod
    def parse(self, payload: Any) -> Iterable[EligibilityRow]:
        """Yield EligibilityRow per published entry."""

    # ─── helpers ──────────────────────────────────────────────────────────

    def _http_get(self, url: str, timeout: int = 30) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": self.USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()

    def _upsert_all(self, rows: list[EligibilityRow]) -> int:
        if not rows:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        body = []
        for r in rows:
            body.append({
                "generic_name": r.generic_name,
                "brand_name": r.brand_name,
                "country_code": r.country_code,
                "scheme": r.scheme,
                "status": r.status,
                "scheme_reference": r.scheme_reference,
                "description": r.description,
                "listed_at": r.listed_at,
                "expires_at": r.expires_at,
                "withdrawn_at": r.withdrawn_at,
                "source_url": r.source_url or self.SOURCE_URL,
                "source_name": r.source_name or self.SOURCE_NAME,
                "raw_data": r.raw_data,
                "last_verified_at": now,
            })

        # Conflict target: prefer scheme_reference; fall back to composite.
        on_conflict = "scheme,scheme_reference"
        url = f"{self.supabase_url}/rest/v1/regulatory_eligibility?on_conflict={on_conflict}"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=self.headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                _ = resp.read()
            return len(body)
        except urllib.error.HTTPError as e:
            self.log(f"upsert failed: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:300]}", level="error")
            return 0
        except Exception as e:
            self.log(f"upsert failed: {e}", level="error")
            return 0

    def _mark_missing_as_lapsed(self, rows: list[EligibilityRow]) -> int:
        """For entries in our DB but NOT in the current scrape, flip status to 'lapsed'.

        Scope: same (scheme, country_code), status='active', scheme_reference not in
        the current set. Skipped entirely when scheme_reference is unreliable for the
        source — subclasses can override.
        """
        if not rows:
            return 0
        current_refs = sorted({r.scheme_reference for r in rows if r.scheme_reference})
        if not current_refs:
            return 0
        try:
            in_clause = "(" + ",".join(f'"{ref}"' for ref in current_refs) + ")"
            url = (
                f"{self.supabase_url}/rest/v1/regulatory_eligibility"
                f"?scheme=eq.{urllib.parse.quote(self.SCHEME)}"
                f"&country_code=eq.{urllib.parse.quote(self.COUNTRY_CODE)}"
                f"&status=eq.active"
                f"&scheme_reference=not.in.{urllib.parse.quote(in_clause)}"
            )
            body = json.dumps({
                "status": "lapsed",
                "withdrawn_at": date.today().isoformat(),
            }).encode()
            req = urllib.request.Request(url, data=body, headers=self.headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=30) as resp:
                _ = resp.read()
            return 0  # PATCH return count requires Prefer: count=exact; best-effort
        except Exception as e:
            self.log(f"lapsed-mark step failed (non-fatal): {e}", level="warning")
            return 0

    def log(self, msg: str, level: str = "info") -> None:
        getattr(LOG, level)(f"[{self.SCHEME}] {msg}")
