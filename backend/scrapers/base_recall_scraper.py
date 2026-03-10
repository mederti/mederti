"""
BaseRecallScraper — abstract base class for all Mederti recall scrapers.

Independent from BaseScraper (does NOT inherit it).
Duplicates HTTP/drug-lookup utilities so recall scrapers can stand alone.

Dedup key (recall_id):
    MD5(SOURCE_ID | COUNTRY_CODE | announced_date | recall_ref)
where recall_ref = recall number if the source provides one, else
    MD5(generic_name[:50] | announced_date)

Lifecycle (run()):
    1. fetch()          → raw payload from upstream source
    2. normalize()      → list of recall dicts
    3. upsert()         → drug lookup + recalls upsert + linking + auto-shortages
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


class BaseRecallScraper(ABC):
    """
    Abstract base for all Mederti recall scrapers.

    Class-level constants (set in each subclass):
        SOURCE_ID      UUID matching data_sources.id
        SOURCE_NAME    Human-readable label
        BASE_URL       Primary URL being scraped
        COUNTRY        Full country name, e.g. "Australia"
        COUNTRY_CODE   ISO 3166-1 alpha-2, e.g. "AU"

    Subclasses may override:
        RATE_LIMIT_DELAY   Seconds between HTTP requests
        REQUEST_TIMEOUT    httpx timeout in seconds
    """

    SOURCE_ID: str = ""
    SOURCE_NAME: str = ""
    BASE_URL: str = ""
    COUNTRY: str = ""
    COUNTRY_CODE: str = ""

    RATE_LIMIT_DELAY: float = 1.5
    REQUEST_TIMEOUT: float = 30.0
    SCRAPER_VERSION: str = "1.0.0"

    DEFAULT_HEADERS: dict[str, str] = {
        "User-Agent": (
            "Mederti-Scraper/1.0 (+https://mederti.com/bot; "
            "monitoring pharmaceutical recalls globally)"
        ),
        "Accept":          "application/json, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control":   "no-cache",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Init
    # ─────────────────────────────────────────────────────────────────────────

    def __init__(self, db_client: Client | None = None) -> None:
        self.log = get_logger(f"mederti.recall.{self.__class__.__name__}")
        self.db: Client = db_client if db_client is not None else get_supabase_client()
        self._last_request_time: float = 0.0

        if not all([self.SOURCE_ID, self.SOURCE_NAME, self.BASE_URL,
                    self.COUNTRY, self.COUNTRY_CODE]):
            raise ValueError(
                f"{self.__class__.__name__} must define SOURCE_ID, SOURCE_NAME, "
                "BASE_URL, COUNTRY, and COUNTRY_CODE."
            )

    # ─────────────────────────────────────────────────────────────────────────
    # Abstract interface
    # ─────────────────────────────────────────────────────────────────────────

    @abstractmethod
    def fetch(self) -> dict | list:
        """Fetch the raw payload from the upstream source."""

    @abstractmethod
    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform raw source payload into a list of recall dicts.

        Required per dict:
            generic_name    str      drug name
            announced_date  str      ISO-8601 date

        Optional:
            recall_class    str      I | II | III | Unclassified
            recall_type     str      batch | product_wide | market_withdrawal
            brand_name      str
            manufacturer    str
            lot_numbers     list[str]
            reason          str
            reason_category str      contamination | mislabelling | subpotency |
                                     packaging | sterility | foreign_matter | other
            status          str      active | completed | ongoing
            completion_date str      ISO-8601 date
            press_release_url str
            confidence_score int     0-100
            recall_ref      str      unique ref for dedup (recall number)
            raw_record      dict     original source record
        """

    # ─────────────────────────────────────────────────────────────────────────
    # HTTP helpers (verbatim from BaseScraper)
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
        self._enforce_rate_limit()
        self.log.debug("HTTP GET", extra={"url": url, "params": params})
        with httpx.Client(
            headers=self.DEFAULT_HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            response = client.get(url, params=params, **kwargs)
            response.raise_for_status()
            return response

    def _get_json(self, url: str, params: dict | None = None, **kwargs) -> Any:
        return self._get(url, params=params, **kwargs).json()

    def _content_hash(self, payload: Any) -> str:
        serialised = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.md5(serialised).hexdigest()

    # ─────────────────────────────────────────────────────────────────────────
    # Dedup key
    # ─────────────────────────────────────────────────────────────────────────

    def _recall_id(self, announced_date: str, recall_ref: str) -> str:
        """MD5(SOURCE_ID | COUNTRY_CODE | announced_date | recall_ref)"""
        raw = f"{self.SOURCE_ID}|{self.COUNTRY_CODE}|{announced_date}|{recall_ref}"
        return hashlib.md5(raw.encode()).hexdigest()

    # ─────────────────────────────────────────────────────────────────────────
    # Drug resolution (verbatim from BaseScraper)
    # ─────────────────────────────────────────────────────────────────────────

    def _find_or_create_drug(
        self,
        generic_name: str,
        brand_names: list[str] | None = None,
    ) -> str | None:
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
        first_word = normalised.split()[0].rstrip(";,")
        if len(first_word) >= 4:
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
                    extra={"query": normalised, "matched": matched["generic_name"]},
                )
                return matched["id"]

        # 3. Auto-create minimal record
        self.log.warning(
            "Drug not in registry — auto-creating minimal record",
            extra={"generic_name": generic_name, "source": self.SOURCE_NAME},
        )
        insert_result = (
            self.db.table("drugs")
            .insert({
                "generic_name":         generic_name.strip().title(),
                "brand_names":          brand_names or [],
                "therapeutic_category": f"Auto-created by {self.SOURCE_NAME} scraper",
            })
            .execute()
        )
        new_id: str = insert_result.data[0]["id"]
        self.log.info("Auto-created drug record", extra={"drug_id": new_id, "generic_name": generic_name})
        return new_id

    # ─────────────────────────────────────────────────────────────────────────
    # Shortage auto-creation + linking
    # ─────────────────────────────────────────────────────────────────────────

    def _link_to_shortages(
        self,
        recall_uuid: str,
        drug_id: str,
        country_code: str,
        announced_date: str,
    ) -> int:
        """
        Link a recall to any existing shortage_events for the same drug+country.
        Returns the number of links created.
        """
        try:
            shortage_resp = (
                self.db.table("shortage_events")
                .select("id, start_date")
                .eq("drug_id", drug_id)
                .eq("country_code", country_code)
                .execute()
            )
            shortages = shortage_resp.data or []
        except Exception as exc:
            self.log.warning("Could not fetch shortages for linking", extra={"error": str(exc)})
            return 0

        linked = 0
        announced_dt = datetime.fromisoformat(announced_date)

        for s in shortages:
            start_raw = s.get("start_date")
            if not start_raw:
                continue
            try:
                start_dt = datetime.fromisoformat(str(start_raw))
            except ValueError:
                continue

            diff_days = (start_dt - announced_dt).days
            if diff_days > 1:
                link_type = "recall_caused_shortage"
            elif abs(diff_days) <= 30:
                link_type = "concurrent"
            else:
                link_type = "shortage_preceded_recall"

            try:
                self.db.table("recall_shortage_links").upsert(
                    {
                        "recall_id":   recall_uuid,
                        "shortage_id": s["id"],
                        "link_type":   link_type,
                    },
                    on_conflict="recall_id,shortage_id",
                ).execute()
                linked += 1
            except Exception as exc:
                self.log.debug("Link upsert skipped", extra={"error": str(exc)})

        return linked

    def _auto_create_shortage(self, drug_id: str, recall_uuid: str, recall: dict) -> bool:
        """
        If recall_class == 'I' and no active/anticipated shortage exists for
        drug_id + country_code, insert an anticipated shortage event.
        Returns True if a shortage was created.
        """
        country_code = self.COUNTRY_CODE
        announced_date = recall.get("announced_date", date.today().isoformat())

        # Check for existing active/anticipated shortage
        try:
            existing = (
                self.db.table("shortage_events")
                .select("id")
                .eq("drug_id", drug_id)
                .eq("country_code", country_code)
                .in_("status", ["active", "anticipated"])
                .limit(1)
                .execute()
            )
            if existing.data:
                return False
        except Exception:
            return False

        # Build deterministic shortage_id
        import hashlib as _hl
        shortage_id_raw = f"{drug_id}|{self.SOURCE_ID}|{country_code}|{announced_date}"
        shortage_id = _hl.md5(shortage_id_raw.encode()).hexdigest()

        try:
            self.db.table("shortage_events").upsert(
                {
                    "shortage_id":      shortage_id,
                    "drug_id":          drug_id,
                    "data_source_id":   self.SOURCE_ID,
                    "country":          self.COUNTRY,
                    "country_code":     country_code,
                    "status":           "anticipated",
                    "severity":         "high",
                    "reason_category":  "regulatory_action",
                    "start_date":       announced_date,
                    "source_url":       recall.get("press_release_url", self.BASE_URL),
                    "notes":            f"Auto-generated from Class I recall {recall_uuid}",
                    "last_verified_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="shortage_id",
            ).execute()
            self.log.info(
                "Auto-created anticipated shortage from Class I recall",
                extra={"drug_id": drug_id, "recall_uuid": recall_uuid},
            )
            return True
        except Exception as exc:
            self.log.warning("Auto-shortage creation failed", extra={"error": str(exc)})
            return False

    # ─────────────────────────────────────────────────────────────────────────
    # Upsert
    # ─────────────────────────────────────────────────────────────────────────

    def upsert(self, recalls: list[dict]) -> dict[str, int]:
        """
        For each recall dict:
          1. Resolve drug_id (find or create)
          2. Compute recall_id (MD5 dedup key)
          3. Upsert into recalls table
          4. Link to existing shortage_events
          5. Auto-create shortage if Class I + no active shortage

        Returns: {"upserted": n, "skipped": n, "linked": n, "auto_shortages": n}
        """
        counts = {"upserted": 0, "skipped": 0, "linked": 0, "auto_shortages": 0}

        for recall in recalls:
            try:
                generic_name = (recall.get("generic_name") or "").strip()
                if not generic_name:
                    counts["skipped"] += 1
                    continue

                drug_id = self._find_or_create_drug(
                    generic_name,
                    brand_names=[recall["brand_name"]] if recall.get("brand_name") else None,
                )

                announced_date = recall.get("announced_date") or date.today().isoformat()

                # Build dedup recall_ref
                recall_ref = recall.get("recall_ref") or hashlib.md5(
                    f"{generic_name[:50]}|{announced_date}".encode()
                ).hexdigest()
                recall_id = self._recall_id(announced_date, recall_ref)

                record: dict[str, Any] = {
                    "recall_id":        recall_id,
                    "drug_id":          drug_id,
                    "source_id":        self.SOURCE_ID,
                    "country_code":     self.COUNTRY_CODE,
                    "recall_class":     recall.get("recall_class"),
                    "recall_type":      recall.get("recall_type"),
                    "reason":           recall.get("reason"),
                    "reason_category":  recall.get("reason_category"),
                    "lot_numbers":      recall.get("lot_numbers") or [],
                    "manufacturer":     recall.get("manufacturer"),
                    "brand_name":       recall.get("brand_name"),
                    "generic_name":     generic_name,
                    "announced_date":   announced_date,
                    "completion_date":  recall.get("completion_date"),
                    "status":           recall.get("status", "active"),
                    "press_release_url": recall.get("press_release_url"),
                    "confidence_score": recall.get("confidence_score", 80),
                    "raw_data":         recall.get("raw_record", {}),
                }

                upsert_resp = (
                    self.db.table("recalls")
                    .upsert(record, on_conflict="recall_id")
                    .execute()
                )
                recall_uuid: str = upsert_resp.data[0]["id"]
                counts["upserted"] += 1

                # Link to existing shortage events
                if drug_id:
                    linked = self._link_to_shortages(
                        recall_uuid, drug_id, self.COUNTRY_CODE, announced_date
                    )
                    counts["linked"] += linked

                # Auto-create anticipated shortage for Class I recalls
                if recall.get("recall_class") == "I" and drug_id:
                    created = self._auto_create_shortage(drug_id, recall_uuid, recall)
                    if created:
                        counts["auto_shortages"] += 1

            except Exception as exc:
                self.log.error(
                    "Failed to upsert recall",
                    extra={"error": str(exc), "generic_name": recall.get("generic_name")},
                )
                counts["skipped"] += 1

        return counts

    # ─────────────────────────────────────────────────────────────────────────
    # Orchestrator
    # ─────────────────────────────────────────────────────────────────────────

    def run(self) -> dict[str, Any]:
        """Full recall scrape lifecycle. Returns a summary dict."""
        started_at = datetime.now(timezone.utc)
        self.log.info("Recall scrape started", extra={"source": self.SOURCE_NAME})

        summary: dict[str, Any] = {
            "source":            self.SOURCE_NAME,
            "started_at":        started_at.isoformat(),
            "status":            "failed",
            "records_found":     0,
            "records_processed": 0,
            "skipped":           0,
            "linked":            0,
            "auto_shortages":    0,
            "error":             None,
        }

        try:
            raw = self.fetch()
            recalls = self.normalize(raw)
            summary["records_found"] = len(recalls)
            self.log.info("Normalisation complete", extra={"source": self.SOURCE_NAME, "records": len(recalls)})

            counts = self.upsert(recalls)
            summary.update({
                "status":            "success",
                "records_processed": counts["upserted"],
                "skipped":           counts["skipped"],
                "linked":            counts["linked"],
                "auto_shortages":    counts["auto_shortages"],
            })

        except Exception as exc:
            summary["error"] = str(exc)
            self.log.error("Recall scrape failed", extra={"source": self.SOURCE_NAME, "error": str(exc)}, exc_info=True)

        finally:
            finished_at = datetime.now(timezone.utc)
            summary["finished_at"] = finished_at.isoformat()
            summary["duration_s"] = round((finished_at - started_at).total_seconds(), 2)
            self.log.info("Recall scrape finished", extra=summary)

        return summary
