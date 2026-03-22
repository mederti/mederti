"""
Belgium FAMHP Drug Supply Problem Scraper
─────────────────────────────────────────
Source:  Federal Agency for Medicines and Health Products (FAMHP)
API:     https://pharmastatus.be/api/packs/info/public
URL:     https://pharmastatus.be

Belgium migrated shortage data to PharmaStatus (pharmastatus.be), a dedicated
platform with a public REST API. This scraper fetches active unavailabilities
via the JSON API, paginates through results (100 per page), and normalises
each entry into the standard Mederti shortage event format.

Data source UUID:  10000000-0000-0000-0000-000000000047
Country:           Belgium
Country code:      BE
Confidence:        90/100 (official structured JSON API)

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class BelgiumFamhpScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000047"
    SOURCE_NAME: str  = "Federal Agency for Medicines and Health Products — PharmaStatus"
    BASE_URL: str     = "https://pharmastatus.be"
    API_URL: str      = "https://pharmastatus.be/api/packs/info/public"
    COUNTRY: str      = "Belgium"
    COUNTRY_CODE: str = "BE"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "2.0.0"
    PAGE_SIZE: int          = 100

    # PharmaStatus notification statuses to fetch
    ACTIVE_STATUSES: list[str] = [
        "unavailable",
        "limited_availability",
        "interruption_commercialisation",
    ]

    # Severity from PharmaStatus impact score
    @staticmethod
    def _impact_to_severity(impact: Any) -> str:
        try:
            score = float(impact)
        except (TypeError, ValueError):
            return "medium"
        if score >= 30:
            return "critical"
        if score >= 20:
            return "high"
        if score >= 10:
            return "medium"
        return "low"

    # Reason keywords -> reason_category
    _REASON_MAP: dict[str, str] = {
        "manufacturing":        "manufacturing_issue",
        "production":           "manufacturing_issue",
        "quality":              "manufacturing_issue",
        "gmp":                  "manufacturing_issue",
        "raw material":         "raw_material",
        "active substance":     "raw_material",
        "demand":               "demand_surge",
        "supply chain":         "supply_chain",
        "logistics":            "supply_chain",
        "distribution":         "distribution",
        "discontinu":           "discontinuation",
        "withdrawal":           "discontinuation",
        "regulatory":           "regulatory_action",
        "commercial":           "supply_chain",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch active drug unavailabilities from the PharmaStatus public API.
        Paginates through all results (100 per page).
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.API_URL,
        })

        all_records: list[dict] = []
        start_row = 0

        while True:
            params = {
                "startRow": start_row,
                "endRow": start_row + self.PAGE_SIZE,
            }

            resp = self._get(self.API_URL, params=params)
            data = resp.json()

            rows = data.get("data") or data.get("rows") or []
            if not rows:
                break

            all_records.extend(rows)
            self.log.info(
                "PharmaStatus page fetched",
                extra={"start_row": start_row, "page_records": len(rows), "total_so_far": len(all_records)},
            )

            # Check if we've got all records — totalRows is per-row
            total = rows[0].get("totalRows", 0) if rows else 0
            if len(all_records) >= total or len(rows) < self.PAGE_SIZE:
                break

            start_row += self.PAGE_SIZE
            self._enforce_rate_limit()

        self.log.info(
            "PharmaStatus fetch complete",
            extra={"total_records": len(all_records)},
        )
        return all_records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize PharmaStatus records into standard shortage event dicts."""
        self.log.info(
            "Normalising FAMHP records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0
        today = date.today().isoformat()

        for rec in raw:
            try:
                result = self._normalise_record(rec, today)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise FAMHP record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """
        Convert a single PharmaStatus API record to normalised shortage events.

        Each record (pack) may have multiple notifications in notARR.
        We take the most recent active notification if one exists.
        """
        import json as _json

        # -- Drug name extraction --
        # activeSubstancesLongEn is a JSON string like '["Lorazepam"]'
        generic_name = ""
        for lang in ("En", "Fr", "Nl"):
            raw_subs = rec.get(f"activeSubstancesLong{lang}") or ""
            if raw_subs:
                try:
                    subs_list = _json.loads(raw_subs) if isinstance(raw_subs, str) else raw_subs
                    if isinstance(subs_list, list) and subs_list:
                        generic_name = ", ".join(str(s) for s in subs_list)
                        break
                except (ValueError, TypeError):
                    pass

        # Fallback: extract from atcCode field (e.g. "N05BA06 Lorazepam")
        if not generic_name:
            atc_raw = rec.get("atcCode") or ""
            parts = atc_raw.split(" ", 1)
            if len(parts) == 2:
                generic_name = parts[1].strip()

        if not generic_name:
            return None

        # -- Brand name from prescriptionName --
        brand_name = (rec.get("prescriptionName") or "").strip()
        brand_names = [brand_name] if brand_name else []

        # -- Find the most relevant notification from notARR --
        notifications = rec.get("notARR") or []
        active_notif = None
        for notif in notifications:
            ns = (notif.get("notificationStatus") or "").lower()
            if ns in ("unavailable", "limited_availability", "interruption_commercialisation",
                       "stop_commercialisation"):
                active_notif = notif
                break
        # If no active notification, take the first one
        if not active_notif and notifications:
            active_notif = notifications[0]
        if not active_notif:
            active_notif = {}

        # -- Status --
        notif_status = (active_notif.get("notificationStatus") or "").lower()
        if notif_status in ("unavailable", "limited_availability", "interruption_commercialisation",
                             "stop_commercialisation"):
            status = "active"
        elif notif_status in ("available",):
            status = "resolved"
        else:
            status = "active"

        # -- Severity from impact score --
        severity = self._impact_to_severity(active_notif.get("impact"))

        # -- Reason --
        raw_reason = (active_notif.get("notificationReason") or "").strip()
        additional = (active_notif.get("additionalInfo") or "").strip()
        reason_text = additional if additional else raw_reason
        reason_category = self._map_reason(reason_text)

        # -- Dates --
        start_date = self._parse_date(active_notif.get("startDate")) or today
        presumed_end = self._parse_date(active_notif.get("presumedEndDate"))
        end_date = self._parse_date(active_notif.get("endDate")) if status == "resolved" else None
        estimated_resolution = presumed_end if status == "active" else None

        # -- Source URL --
        pack_id = rec.get("packId")
        source_url = f"{self.BASE_URL}/detail/{pack_id}" if pack_id else self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        company = (rec.get("packCompanyName") or "").strip()
        if company:
            notes_parts.append(f"Company: {company}")
        atc = (rec.get("atcCode") or "").strip()
        if atc:
            notes_parts.append(f"ATC: {atc}")
        auth_nr = (rec.get("authorisationNumber") or "").strip()
        if auth_nr:
            notes_parts.append(f"Auth: {auth_nr}")
        if reason_text:
            notes_parts.append(f"Reason: {reason_text[:150]}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    reason_text or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution,
            "source_url":                source_url,
            "notes":                     notes,
            "source_confidence_score":   90,
            "raw_record":                rec,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _map_reason(self, raw: str) -> str:
        """Map FAMHP reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return map_reason_category(raw)

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None", ""):
            return None

        # ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
        if "T" in raw_str:
            raw_str = raw_str[:10]
        iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', raw_str)
        if iso_match:
            return raw_str

        # European format DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
        eu_match = re.match(
            r'^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$', raw_str
        )
        if eu_match:
            day, month, year = eu_match.groups()
            if len(year) == 2:
                year = f"20{year}"
            try:
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

        # Fallback: dateutil parser
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str, dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass

        return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live PharmaStatus data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = BelgiumFamhpScraper(db_client=MagicMock())

        print("\n-- Fetching from PharmaStatus API ...")
        raw = scraper.fetch()
        print(f"-- Raw records received : {len(raw)}")

        print("-- Normalising records ...")
        events = scraper.normalize(raw)
        print(f"-- Normalised events    : {len(events)}")

        if events:
            print("\n-- Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            from collections import Counter

            status_counts   = Counter(e["status"] for e in events)
            severity_counts = Counter(e.get("severity") for e in events)
            reason_counts   = Counter(e.get("reason_category") for e in events)

            print("\n-- Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:25s} {v}")
            print("\n-- Severity breakdown:")
            for k, v in sorted(severity_counts.items()):
                print(f"   {str(k):12s} {v}")
            print("\n-- Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):30s} {v}")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = BelgiumFamhpScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
