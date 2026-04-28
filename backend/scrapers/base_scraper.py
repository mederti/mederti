"""
BaseScraper — abstract base class for all Mederti shortage data scrapers.

Lifecycle (orchestrated by run()):
    1. fetch()          → raw payload from upstream source
    2. _log_raw_scrape()→ writes to raw_scrapes (status=processing)
    3. normalize()      → list of intermediate shortage dicts
    4. upsert()         → drug lookup/create + shortage_events insert/update
    5. _update_raw_scrape() → marks raw_scrape processed/failed

Subclasses must define class-level constants and implement fetch() + normalize().
Everything else is provided by this base.

Deterministic shortage_id
─────────────────────────
shortage_id = MD5(drug_id + "|" + SOURCE_ID + "|" + COUNTRY_CODE + "|" + start_date)

This mirrors the set_shortage_id() Postgres trigger in 001_initial_schema.sql.
Keeping them identical is CRITICAL — if you change the formula here, update the
trigger too (and vice versa).
"""

from __future__ import annotations

import hashlib
import json
import time
from abc import ABC, abstractmethod
from datetime import date, datetime, timezone
from typing import Any

import httpx
from supabase import Client

from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger
from backend.utils.retry import with_exponential_backoff


class ScraperError(Exception):
    """Raised when a scraper encounters an unrecoverable error."""


class BaseScraper(ABC):
    """
    Abstract base for all Mederti shortage scrapers.

    Class-level constants (set in each subclass):
        SOURCE_ID      UUID matching data_sources.id seeded in the migration
        SOURCE_NAME    Human-readable label (matches data_sources.name)
        BASE_URL       Primary URL being scraped
        COUNTRY        Full country name, e.g. "Australia"
        COUNTRY_CODE   ISO 3166-1 alpha-2, e.g. "AU"

    Instance constants (override per-scraper if needed):
        RATE_LIMIT_DELAY   Seconds between HTTP requests (polite crawling)
        REQUEST_TIMEOUT    httpx timeout in seconds
        SCRAPER_VERSION    Semver string recorded in raw_scrapes
    """

    # --- Subclass must define these ---
    SOURCE_ID: str = ""
    SOURCE_NAME: str = ""
    BASE_URL: str = ""
    COUNTRY: str = ""
    COUNTRY_CODE: str = ""

    # --- Subclass may override these ---
    RATE_LIMIT_DELAY: float = 1.5
    REQUEST_TIMEOUT: float = 30.0
    SCRAPER_VERSION: str = "1.0.0"

    DEFAULT_HEADERS: dict[str, str] = {
        "User-Agent": (
            "Mederti-Scraper/1.0 (+https://mederti.com/bot; "
            "monitoring pharmaceutical shortages globally)"
        ),
        "Accept":          "application/json, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control":   "no-cache",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Initialisation
    # ─────────────────────────────────────────────────────────────────────────

    def __init__(self, db_client: Client | None = None) -> None:
        self.log = get_logger(f"mederti.scraper.{self.__class__.__name__}")
        # Accept an injected client for testing / dry-run; otherwise build one.
        self.db: Client = db_client if db_client is not None else get_supabase_client()
        self._last_request_time: float = 0.0

        if not all([self.SOURCE_ID, self.SOURCE_NAME, self.BASE_URL,
                    self.COUNTRY, self.COUNTRY_CODE]):
            raise ScraperError(
                f"{self.__class__.__name__} must define SOURCE_ID, SOURCE_NAME, "
                "BASE_URL, COUNTRY, and COUNTRY_CODE."
            )

    # ─────────────────────────────────────────────────────────────────────────
    # Abstract interface — subclasses implement these two methods
    # ─────────────────────────────────────────────────────────────────────────

    @abstractmethod
    def fetch(self) -> dict | list:
        """
        Fetch the raw data payload from the upstream source.
        Use self._get_json() or self._get() rather than calling httpx directly.
        Returns the raw parsed payload (dict or list).
        """

    @abstractmethod
    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform the raw source payload into a list of normalized shortage dicts.

        Required keys per dict:
            generic_name  str          Used to look up / create a drug record.
            start_date    str          ISO-8601 date, e.g. '2024-06-01'.
            status        str          'active' | 'resolved' | 'anticipated' | 'stale'
            raw_record    dict         The original source record (stored as raw_data).

        Optional keys (passed through to shortage_events if present):
            brand_names                 list[str]  for drug creation
            severity                    str
            reason                      str
            reason_category             str
            estimated_resolution_date   str | None
            end_date                    str | None
            source_url                  str
            notes                       str
        """

    # ─────────────────────────────────────────────────────────────────────────
    # HTTP helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _enforce_rate_limit(self) -> None:
        elapsed = time.monotonic() - self._last_request_time
        if elapsed < self.RATE_LIMIT_DELAY:
            time.sleep(self.RATE_LIMIT_DELAY - elapsed)
        self._last_request_time = time.monotonic()

    @with_exponential_backoff(
        max_attempts=3,
        base_delay=2.0,
        max_delay=30.0,
        exceptions=(httpx.HTTPError, httpx.TimeoutException, httpx.NetworkError),
    )
    def _get(self, url: str, params: dict | None = None, **kwargs) -> httpx.Response:
        """
        Rate-limited GET with exponential-backoff retry.
        Returns the raw httpx.Response (caller must call .json() / .text etc.).
        """
        self._enforce_rate_limit()
        self.log.debug("HTTP GET", extra={"url": url, "params": params})

        with httpx.Client(
            headers=self.DEFAULT_HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            response = client.get(url, params=params, **kwargs)
            response.raise_for_status()
            self.log.debug(
                "HTTP response",
                extra={
                    "url":        url,
                    "status":     response.status_code,
                    "bytes":      len(response.content),
                    "content_type": response.headers.get("content-type", ""),
                },
            )
            return response

    def _get_json(self, url: str, params: dict | None = None, **kwargs) -> Any:
        """Convenience: _get() + JSON decode."""
        return self._get(url, params=params, **kwargs).json()

    # ─────────────────────────────────────────────────────────────────────────
    # Content hashing
    # ─────────────────────────────────────────────────────────────────────────

    def _content_hash(self, payload: Any) -> str:
        serialised = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.md5(serialised).hexdigest()

    # ─────────────────────────────────────────────────────────────────────────
    # raw_scrapes table helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _log_raw_scrape(self, raw: Any, status: str = "processing") -> str:
        """
        Write an initial raw_scrapes row and return its id.
        If content_hash matches the most recent successful scrape for this
        source, the row is marked 'duplicate' immediately (no upsert needed).
        """
        content_hash = self._content_hash(raw)

        # Duplicate detection — same payload as last processed scrape?
        existing = (
            self.db.table("raw_scrapes")
            .select("id")
            .eq("data_source_id", self.SOURCE_ID)
            .eq("content_hash", content_hash)
            .eq("status", "processed")
            .limit(1)
            .execute()
        )
        if existing.data:
            status = "duplicate"
            self.log.info(
                "Source payload unchanged since last scrape",
                extra={"source": self.SOURCE_NAME, "content_hash": content_hash},
            )

        raw_json = raw if isinstance(raw, dict) else {"items": raw}
        result = (
            self.db.table("raw_scrapes")
            .insert({
                "data_source_id":       self.SOURCE_ID,
                "scraped_at":           datetime.now(timezone.utc).isoformat(),
                "raw_data":             raw_json,
                "content_hash":         content_hash,
                "status":               status,
                "scraper_version":      self.SCRAPER_VERSION,
                "processing_started_at": datetime.now(timezone.utc).isoformat(),
            })
            .execute()
        )
        raw_scrape_id: str = result.data[0]["id"]
        self.log.debug(
            "raw_scrapes row created",
            extra={"id": raw_scrape_id, "status": status},
        )
        return raw_scrape_id

    def _update_raw_scrape(
        self,
        raw_scrape_id: str,
        status: str,
        records_found: int | None = None,
        records_processed: int | None = None,
        error: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {
            "status":                   status,
            "processing_completed_at":  datetime.now(timezone.utc).isoformat(),
        }
        if records_found is not None:
            patch["records_found"] = records_found
        if records_processed is not None:
            patch["records_processed"] = records_processed
        if error:
            patch["error_message"] = error[:2000]  # Postgres TEXT is unlimited but guard anyway

        self.db.table("raw_scrapes").update(patch).eq("id", raw_scrape_id).execute()

    # ─────────────────────────────────────────────────────────────────────────
    # Drug resolution
    # ─────────────────────────────────────────────────────────────────────────

    def _find_or_create_drug(
        self,
        generic_name: str,
        brand_names: list[str] | None = None,
    ) -> str | None:
        """
        Resolve a drug UUID from the drugs table using a tiered lookup strategy:
          1. Exact match on generic_name_normalised (fast, most common)
          2. First-word prefix match (handles "amoxicillin trihydrate" → "amoxicillin")
          3. Create a minimal drug record so no shortage event is orphaned

        Returns the drug UUID, or None if generic_name is blank.
        """
        normalised = generic_name.strip().lower()
        if not normalised:
            return None

        # 1. Exact normalised match
        result = (
            self.db.table("drugs")
            .select("id")
            .eq("generic_name_normalised", normalised)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]

        # 2. Prefix / first-word match
        #    Handles multi-salt names like "amoxicillin trihydrate" or
        #    "amoxicillin; clavulanate potassium"
        first_word = normalised.split()[0].rstrip(";,")
        if len(first_word) >= 4:  # avoid noise matches on very short tokens
            result = (
                self.db.table("drugs")
                .select("id, generic_name")
                .ilike("generic_name_normalised", f"{first_word}%")
                .limit(5)
                .execute()
            )
            if result.data:
                matched = result.data[0]
                self.log.debug(
                    "Drug matched by prefix",
                    extra={
                        "query":   normalised,
                        "matched": matched["generic_name"],
                        "drug_id": matched["id"],
                    },
                )
                return matched["id"]

        # 3. Auto-create minimal record — shortage data is too valuable to discard
        self.log.warning(
            "Drug not in registry — auto-creating minimal record",
            extra={
                "generic_name": generic_name,
                "source":       self.SOURCE_NAME,
            },
        )
        insert_result = (
            self.db.table("drugs")
            .insert({
                "generic_name":        generic_name.strip().title(),
                "brand_names":         brand_names or [],
                "therapeutic_category": f"Auto-created by {self.SOURCE_NAME} scraper",
            })
            .execute()
        )
        new_id: str = insert_result.data[0]["id"]
        self.log.info(
            "Auto-created drug record",
            extra={"drug_id": new_id, "generic_name": generic_name},
        )
        return new_id

    # ─────────────────────────────────────────────────────────────────────────
    # Deterministic shortage_id
    # ─────────────────────────────────────────────────────────────────────────

    def _shortage_id(self, drug_id: str, start_date: str) -> str:
        """
        Replicates the Postgres trigger formula from 001_initial_schema.sql:
            md5(drug_id || '|' || data_source_id || '|' || country_code || '|' || start_date)

        WARNING: If you change this formula, update set_shortage_id() in the
        migration as well, otherwise duplicate events will be inserted.
        """
        raw = f"{drug_id}|{self.SOURCE_ID}|{self.COUNTRY_CODE}|{start_date}"
        return hashlib.md5(raw.encode()).hexdigest()

    # ─────────────────────────────────────────────────────────────────────────
    # Upsert
    # ─────────────────────────────────────────────────────────────────────────

    def upsert(self, events: list[dict]) -> dict[str, int]:
        """
        For each normalized shortage dict:
          1. Resolve drug_id (find or create)
          2. Compute deterministic shortage_id
          3. Check existing row for status/severity change detection
          4. Upsert into shortage_events using ON CONFLICT (shortage_id)
          5. If status or severity changed, log to shortage_status_log

        Returns counts: {"upserted": n, "skipped": n, "status_changes": n}
        """
        counts = {"upserted": 0, "skipped": 0, "status_changes": 0}

        for ev in events:
            try:
                drug_id = self._find_or_create_drug(
                    ev.get("generic_name", ""),
                    ev.get("brand_names"),
                )
                if not drug_id:
                    self.log.warning(
                        "Skipping event — blank generic_name",
                        extra={"event_keys": list(ev.keys())},
                    )
                    counts["skipped"] += 1
                    continue

                start_date = ev.get("start_date") or date.today().isoformat()
                shortage_id = self._shortage_id(drug_id, start_date)

                # ── Pre-fetch existing row for change detection ───────────────
                existing_resp = (
                    self.db.table("shortage_events")
                    .select("id, status, severity")
                    .eq("shortage_id", shortage_id)
                    .limit(1)
                    .execute()
                )
                existing: dict | None = (
                    existing_resp.data[0] if existing_resp.data else None
                )

                new_status = ev.get("status", "active")

                # Auto-set end_date when transitioning to resolved
                end_date = ev.get("end_date")
                if new_status == "resolved" and not end_date:
                    # Use existing end_date if already set, otherwise today
                    if existing and existing.get("end_date"):
                        end_date = existing["end_date"]
                    else:
                        end_date = date.today().isoformat()

                record: dict[str, Any] = {
                    "shortage_id":              shortage_id,
                    "drug_id":                  drug_id,
                    "data_source_id":           self.SOURCE_ID,
                    "country":                  self.COUNTRY,
                    "country_code":             self.COUNTRY_CODE,
                    "status":                   new_status,
                    "severity":                 ev.get("severity"),
                    "reason":                   ev.get("reason"),
                    "reason_category":          ev.get("reason_category"),
                    "start_date":               start_date,
                    "end_date":                 end_date,
                    "estimated_resolution_date": ev.get("estimated_resolution_date"),
                    "last_verified_at":         datetime.now(timezone.utc).isoformat(),
                    "source_url":               ev.get("source_url", self.BASE_URL),
                    "raw_data":                 ev.get("raw_record", {}),
                    "notes":                    ev.get("notes"),
                }

                # ── New optional columns (migration 009) ─────────────
                if ev.get("affected_countries") is not None:
                    record["affected_countries"] = ev["affected_countries"]
                if ev.get("available_alternatives") is not None:
                    record["available_alternatives"] = ev["available_alternatives"]
                if ev.get("source_confidence_score") is not None:
                    record["source_confidence_score"] = ev["source_confidence_score"]

                (
                    self.db.table("shortage_events")
                    .upsert(record, on_conflict="shortage_id")
                    .execute()
                )
                counts["upserted"] += 1

                # ── Log status/severity changes for alert dispatch ─────────────
                if existing:
                    old_status   = existing.get("status")
                    old_severity = existing.get("severity")
                    new_severity = record.get("severity")

                    if old_status != new_status or old_severity != new_severity:
                        try:
                            self.db.table("shortage_status_log").insert({
                                "shortage_event_id": existing["id"],
                                "drug_id":           drug_id,
                                "old_status":        old_status,
                                "new_status":        new_status,
                                "old_severity":      old_severity,
                                "new_severity":      new_severity,
                            }).execute()
                            counts["status_changes"] += 1
                            self.log.info(
                                "Status change logged",
                                extra={
                                    "drug_id":      drug_id,
                                    "old_status":   old_status,
                                    "new_status":   new_status,
                                    "old_severity": old_severity,
                                    "new_severity": new_severity,
                                },
                            )
                        except Exception as log_exc:
                            # Don't fail the upsert if change logging fails
                            self.log.warning(
                                "Could not log status change",
                                extra={"error": str(log_exc), "drug_id": drug_id},
                            )

            except Exception as exc:
                self.log.error(
                    "Failed to upsert shortage event",
                    extra={
                        "error":        str(exc),
                        "generic_name": ev.get("generic_name"),
                        "start_date":   ev.get("start_date"),
                    },
                )
                counts["skipped"] += 1

        return counts

    # ─────────────────────────────────────────────────────────────────────────
    # Orchestrator
    # ─────────────────────────────────────────────────────────────────────────

    def run(self) -> dict[str, Any]:
        """
        Full scrape lifecycle.  Returns a summary dict that callers (cron jobs,
        CLI, orchestrators) can log, alert on, or store.
        """
        started_at = datetime.now(timezone.utc)
        self.log.info(
            "Scrape started",
            extra={"source": self.SOURCE_NAME, "url": self.BASE_URL},
        )

        raw_scrape_id: str | None = None
        summary: dict[str, Any] = {
            "source":            self.SOURCE_NAME,
            "started_at":        started_at.isoformat(),
            "status":            "failed",
            "records_found":     0,
            "records_processed": 0,
            "skipped":           0,
            "error":             None,
        }

        try:
            # ── 1. Fetch ──────────────────────────────────────────────────────
            raw = self.fetch()

            # ── 2. Log raw scrape ─────────────────────────────────────────────
            raw_scrape_id = self._log_raw_scrape(raw)

            # Early exit for duplicate (unchanged payload)
            scrape_row = (
                self.db.table("raw_scrapes")
                .select("status")
                .eq("id", raw_scrape_id)
                .single()
                .execute()
            )
            if scrape_row.data and scrape_row.data["status"] == "duplicate":
                summary["status"] = "duplicate"
                self.log.info(
                    "Skipping normalisation — payload unchanged",
                    extra={"source": self.SOURCE_NAME},
                )
                # Still refresh last_verified_at so records don't go stale.
                # Also re-activate any records that went stale while the
                # scraper was returning duplicate payloads.
                now_iso = datetime.now(timezone.utc).isoformat()
                try:
                    # Refresh active/anticipated records
                    self.db.table("shortage_events").update({
                        "last_verified_at": now_iso,
                    }).eq("data_source_id", self.SOURCE_ID).in_(
                        "status", ["active", "anticipated"]
                    ).execute()
                    # Re-activate stale records (they were active before
                    # mark_stale_shortages() demoted them)
                    self.db.table("shortage_events").update({
                        "status": "active",
                        "last_verified_at": now_iso,
                    }).eq("data_source_id", self.SOURCE_ID).eq(
                        "status", "stale"
                    ).execute()
                    self.log.info(
                        "Refreshed last_verified_at and re-activated stale records (duplicate payload)",
                        extra={"source": self.SOURCE_NAME},
                    )
                except Exception as refresh_exc:
                    self.log.warning(
                        "Could not refresh last_verified_at on duplicate",
                        extra={"error": str(refresh_exc), "source": self.SOURCE_NAME},
                    )
                return summary

            # ── 3. Normalize ──────────────────────────────────────────────────
            events = self.normalize(raw)
            summary["records_found"] = len(events)
            self.log.info(
                "Normalisation complete",
                extra={"source": self.SOURCE_NAME, "records": len(events)},
            )

            # ── 4. Upsert ─────────────────────────────────────────────────────
            counts = self.upsert(events)
            summary.update({
                "status":            "success",
                "records_processed": counts["upserted"],
                "skipped":           counts["skipped"],
                "status_changes":    counts.get("status_changes", 0),
            })

            # ── 5. Mark raw scrape processed ──────────────────────────────────
            self._update_raw_scrape(
                raw_scrape_id,
                status="processed",
                records_found=len(events),
                records_processed=counts["upserted"],
            )

        except Exception as exc:
            summary["error"] = str(exc)
            self.log.error(
                "Scrape failed",
                extra={"source": self.SOURCE_NAME, "error": str(exc)},
                exc_info=True,
            )
            if raw_scrape_id:
                self._update_raw_scrape(raw_scrape_id, status="failed", error=str(exc))

        finally:
            finished_at = datetime.now(timezone.utc)
            summary["finished_at"] = finished_at.isoformat()
            summary["duration_s"]  = round(
                (finished_at - started_at).total_seconds(), 2
            )
            self.log.info("Scrape finished", extra=summary)

            # Update last_scraped_at on the data source (even for duplicates)
            if summary["status"] != "failed":
                try:
                    self.db.table("data_sources").update({
                        "last_scraped_at": finished_at.isoformat(),
                    }).eq("id", self.SOURCE_ID).execute()
                except Exception as ts_exc:
                    self.log.warning(
                        "Could not update last_scraped_at",
                        extra={"error": str(ts_exc), "source": self.SOURCE_NAME},
                    )

        return summary
