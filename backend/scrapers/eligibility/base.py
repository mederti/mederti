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
    # Resolved canonical drug. Filled by EligibilityScraper._resolve_drug_ids
    # before upsert — WITHOUT this the row only surfaces on the drug page
    # (generic_name ilike), never in /search results (which match by drug_id).
    drug_id: str | None = None


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
        # Honour the project-wide MEDERTI_DRY_RUN convention: when set, resolve and
        # log everything but perform no writes.
        self.dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip().lower() not in (
            "0", "", "false", "no",
        )

    # ─── lifecycle ────────────────────────────────────────────────────────

    def run(self) -> dict[str, int]:
        self.log("starting" + (" (DRY RUN — no writes)" if self.dry_run else ""))
        try:
            payload = self.fetch()
        except Exception as e:
            self.log(f"fetch failed: {e}", level="error")
            return {"fetched": 0, "resolved": 0, "upserted": 0, "lapsed": 0, "errors": 1}

        rows = list(self.parse(payload))
        self.log(f"parsed {len(rows)} rows")

        run_start = datetime.now(timezone.utc).isoformat()
        resolved = self._resolve_drug_ids(rows)
        upserted = self._upsert_all(rows, now=run_start)
        # Only lapse when the upsert actually landed — otherwise a failed write
        # (or a missing table) would wrongly lapse every live entry.
        lapsed = self._mark_missing_as_lapsed(rows, run_start=run_start) if upserted else 0
        self.log(f"resolved drug_id for {resolved}/{len(rows)}, upserted {upserted}, lapsed {lapsed}")
        return {
            "fetched": len(rows), "resolved": resolved,
            "upserted": upserted, "lapsed": lapsed, "errors": 0,
        }

    # ─── drug_id resolution ───────────────────────────────────────────────

    def _resolve_drug_ids(self, rows: list[EligibilityRow]) -> int:
        """Resolve each row to a canonical `drugs.id` so it surfaces in /search.

        Reuses the vetted longest-canonical-substring resolver from
        catalogue_inn_backfill (same DENY list + combination-product refusal).
        For a clean generic_name ("indapamide") it resolves directly; for a messy
        regulator product title ("NATRILIX SR indapamide 1.5mg ... (Germany)") it
        still finds the INN. On a hit we also canonicalise generic_name to the
        matched INN (cleaner display + makes the drug-page `generic_name.ilike`
        path agree with the drug_id path), keeping the raw source string in
        raw_data['source_name_raw'].
        """
        if not rows:
            return 0
        try:
            from backend.importers.catalogue_inn_backfill import build_index, make_resolver
            from backend.utils.inn_normalize import normalise
        except Exception as e:
            self.log(f"drug_id resolver unavailable ({e}); rows will carry generic_name only", level="warning")
            return 0

        # build_index does ~50 un-retried paginated fetches (drugs +
        # shortage_events); a single transient timeout would otherwise silently
        # collapse resolution to 0 and leave the /search column dark. Retry, and
        # bail WITHOUT writing partial drug_ids if it never succeeds.
        phrase_index = None
        for attempt in range(3):
            try:
                phrase_index, max_words = build_index()
                if phrase_index:
                    break
            except Exception as e:
                self.log(f"build_index attempt {attempt + 1}/3 failed: {e}", level="warning")
                import time as _t
                _t.sleep(3 * (attempt + 1))
        if not phrase_index:
            self.log("drug_id index could not be built; rows will carry generic_name only", level="error")
            return 0
        resolve = make_resolver(phrase_index, max_words)

        resolved = 0
        for r in rows:
            if r.drug_id:
                resolved += 1
                continue
            # Try the richest strings available, most specific first. Normalise
            # first to strip strength/form noise — a "/" in a strength fraction
            # ("micrograms/24 hours", "mg/ml") otherwise trips the resolver's
            # combination-product guard and refuses an otherwise-clean match.
            for cand in (r.brand_name, r.generic_name):
                if not cand:
                    continue
                cleaned = normalise(cand).query or cand
                drug, _reason = resolve(cleaned)
                if drug:
                    r.drug_id = drug["id"]
                    if (drug.get("generic_name") or "").strip():
                        if r.generic_name and r.generic_name != drug["generic_name"]:
                            r.raw_data = dict(r.raw_data or {})
                            r.raw_data.setdefault("source_name_raw", r.generic_name)
                        r.generic_name = drug["generic_name"]
                    resolved += 1
                    break
        return resolved

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

    def _upsert_all(self, rows: list[EligibilityRow], now: str | None = None) -> int:
        if not rows:
            return 0
        now = now or datetime.now(timezone.utc).isoformat()
        body = []
        for r in rows:
            body.append({
                "drug_id": r.drug_id,
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

        if self.dry_run:
            with_id = sum(1 for b in body if b["drug_id"])
            self.log(f"DRY RUN — would upsert {len(body)} rows ({with_id} with drug_id). Sample:")
            for b in body[:5]:
                self.log(
                    f"  drug_id={b['drug_id']} generic={b['generic_name']!r} "
                    f"ref={b['scheme_reference']!r} listed={b['listed_at']} "
                    f"expires={b['expires_at']} status={b['status']}"
                )
            return len(body)

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

    def _mark_missing_as_lapsed(self, rows: list[EligibilityRow], run_start: str | None = None) -> int:
        """For entries in our DB but NOT in the current scrape, flip status to 'lapsed'.

        Strategy: every row re-found this run had its last_verified_at bumped to
        `run_start` by _upsert_all. So any still-active row for this
        (scheme, country_code) whose last_verified_at predates this run was NOT
        re-found and is therefore stale → lapse it. This is a tiny, constant-size
        query regardless of how many refs were scraped (the previous not.in.(…)
        approach blew past the URL length limit — HTTP 414 — once the register
        grew past a few hundred entries).
        """
        if not rows or not run_start:
            return 0
        # Only lapse when we actually wrote this run — otherwise an upsert failure
        # would wrongly lapse every live entry.
        if self.dry_run:
            self.log(f"DRY RUN — would lapse active {self.SCHEME}/{self.COUNTRY_CODE} rows not re-verified this run")
            return 0
        try:
            url = (
                f"{self.supabase_url}/rest/v1/regulatory_eligibility"
                f"?scheme=eq.{urllib.parse.quote(self.SCHEME)}"
                f"&country_code=eq.{urllib.parse.quote(self.COUNTRY_CODE)}"
                f"&status=eq.active"
                f"&last_verified_at=lt.{urllib.parse.quote(run_start)}"
            )
            body = json.dumps({
                "status": "lapsed",
                "withdrawn_at": date.today().isoformat(),
            }).encode()
            headers = dict(self.headers)
            headers["Prefer"] = "count=exact"  # ask PG for the affected-row count
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=30) as resp:
                cr = resp.headers.get("Content-Range", "")
            # Content-Range looks like "*/<count>" on a PATCH with count=exact.
            try:
                return int(cr.rsplit("/", 1)[-1])
            except (ValueError, IndexError):
                return 0
        except Exception as e:
            self.log(f"lapsed-mark step failed (non-fatal): {e}", level="warning")
            return 0

    def log(self, msg: str, level: str = "info") -> None:
        getattr(LOG, level)(f"[{self.SCHEME}] {msg}")
