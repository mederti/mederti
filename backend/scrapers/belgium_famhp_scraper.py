"""
Belgium FAMHP Drug Supply Problem Scraper
─────────────────────────────────────────
Source:  Federal Agency for Medicines and Health Products (FAMHP)
        via the PharmaStatus public API
URL:    https://pharmastatus.be/api/packs/info/public

PharmaStatus is the official FAMHP platform that publishes real-time
medicine unavailability data for Belgium. This scraper fetches structured
JSON via the public REST API (no authentication required), filtering for
human-use medicines with status "unavailable" or "limited_availability".

The old FAMHP HTML page at famhp.be/en/human_use/medicines/medicines/supply_problems
returned 404 as of early 2026 after a site restructure. PharmaStatus
(pharmastatus.be) is now the canonical data source.

Data source UUID:  10000000-0000-0000-0000-000000000047
Country:           Belgium
Country code:      BE
Confidence:        90/100 (official regulator, structured JSON API)

Cron:  Every 24 hours
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import quote

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class BelgiumFamhpScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000047"
    SOURCE_NAME: str  = "Federal Agency for Medicines and Health Products — PharmaStatus"
    BASE_URL: str     = "https://pharmastatus.be/api/packs/info/public"
    COUNTRY: str      = "Belgium"
    COUNTRY_CODE: str = "BE"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT: float  = 90.0
    SCRAPER_VERSION: str    = "2.0.0"

    # Page size for the PharmaStatus API (server-side limit is 100)
    PAGE_SIZE: int = 100

    # PharmaStatus notification statuses we want
    SHORTAGE_STATUSES: list[str] = [
        "unavailable",
        "limited_availability",
        "interruption_commercialisation",
    ]

    # Map PharmaStatus notificationStatus -> Mederti status
    _STATUS_MAP: dict[str, str] = {
        "unavailable":                    "active",
        "limited_availability":           "active",
        "interruption_commercialisation": "active",
        "available":                      "resolved",
        "stop_commercialisation":         "resolved",
    }

    # Map PharmaStatus Dutch/English reason text -> reason_category
    _REASON_MAP: dict[str, str] = {
        "productie":            "manufacturing_issue",
        "production":           "manufacturing_issue",
        "manufacturing":        "manufacturing_issue",
        "fabrication":          "manufacturing_issue",
        "kwaliteit":            "manufacturing_issue",
        "quality":              "manufacturing_issue",
        "gmp":                  "manufacturing_issue",
        "grondstof":            "raw_material",
        "raw material":         "raw_material",
        "active substance":     "raw_material",
        "actief bestanddeel":   "raw_material",
        "vraag":                "demand_surge",
        "demand":               "demand_surge",
        "supply chain":         "supply_chain",
        "logisti":              "supply_chain",
        "distributie":          "distribution",
        "distribution":         "distribution",
        "stopzetting":          "discontinuation",
        "discontinu":           "discontinuation",
        "withdrawal":           "discontinuation",
        "regulatory":           "regulatory_action",
        "regulat":              "regulatory_action",
        "commerc":              "supply_chain",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch all currently unavailable / limited-availability human medicines
        from the PharmaStatus public API.

        The API supports pagination via startRow/endRow query params.
        We paginate through all results to get the complete list.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        all_records: list[dict] = []
        start_row = 1
        total_count: int | None = None

        search_filter = json.dumps({
            "notificationStatusARR": self.SHORTAGE_STATUSES,
            "usage": "human",
        })

        while True:
            end_row = start_row + self.PAGE_SIZE - 1

            params = {
                "startRow": str(start_row),
                "endRow": str(end_row),
                "searchSTR": search_filter,
                "language": "en",
            }

            self.log.debug(
                "Fetching PharmaStatus page",
                extra={"start_row": start_row, "end_row": end_row},
            )

            data = self._get_json(self.BASE_URL, params=params)

            if not data.get("success"):
                raise ScraperError(
                    f"PharmaStatus API returned success=false: {data}"
                )

            items = data.get("data", [])
            if total_count is None:
                total_count = data.get("count", 0)
                self.log.info(
                    "PharmaStatus reports total unavailable items",
                    extra={"total_count": total_count},
                )

            all_records.extend(items)

            # Check if we've fetched all records
            if not items or start_row + len(items) > total_count:
                break

            start_row += self.PAGE_SIZE

        self.log.info(
            "PharmaStatus fetch complete",
            extra={"records": len(all_records), "total_reported": total_count},
        )
        return all_records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize PharmaStatus records into standard shortage event dicts."""
        self.log.info(
            "Normalising PharmaStatus records",
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
                    "Failed to normalise PharmaStatus record",
                    extra={
                        "error": str(exc),
                        "packId": rec.get("packId"),
                        "prescriptionName": str(rec.get("prescriptionName", ""))[:100],
                    },
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single PharmaStatus pack record to a normalised shortage event dict."""

        # -- Drug name extraction --
        # activeSubstancesLongEn is a JSON-encoded list like '["Nivolumab"]'
        generic_name = ""
        for lang_key in ("activeSubstancesLongEn", "activeSubstancesLongFr", "activeSubstancesLongNl"):
            raw_substances = rec.get(lang_key, "")
            if raw_substances:
                try:
                    substances = json.loads(raw_substances)
                    if substances and isinstance(substances, list):
                        generic_name = "; ".join(s.strip() for s in substances if s.strip())
                        break
                except (json.JSONDecodeError, TypeError):
                    continue

        # Fallback: extract from ATC code (e.g. "L01FF01 Nivolumab")
        if not generic_name:
            atc = rec.get("atcCode", "")
            if atc and " " in atc:
                generic_name = atc.split(" ", 1)[1].strip()

        if not generic_name:
            return None

        # -- Brand / trade name from prescriptionName --
        brand_name = rec.get("prescriptionName", "").strip()
        # Extract just the brand portion (before dosage info)
        if brand_name:
            # e.g. "Opdivo 10 mg/ml inf. opl. (conc.) i.v. flac. 24 ml" -> "Opdivo"
            brand_short = re.split(r'\s+\d', brand_name, maxsplit=1)[0].strip()
            brand_names = [brand_short] if brand_short and brand_short.lower() != generic_name.lower() else []
        else:
            brand_names = []

        # -- Get the most relevant notification from notARR --
        notifications = rec.get("notARR", [])
        if not notifications:
            return None

        # Pick the first notification that is an active shortage
        notif = notifications[0]
        for n in notifications:
            ns = n.get("notificationStatus", "")
            if ns in ("unavailable", "limited_availability", "interruption_commercialisation"):
                notif = n
                break

        # -- Status --
        raw_status = notif.get("notificationStatus", "").lower()
        status = self._STATUS_MAP.get(raw_status, "active")

        # If none of the notifications are active shortage, skip
        if status == "resolved":
            return None

        # -- Severity based on impact score --
        impact = notif.get("impact", 0)
        if impact is None:
            impact = 0
        if impact >= 30:
            severity = "critical"
        elif impact >= 20:
            severity = "high"
        elif impact >= 10:
            severity = "medium"
        else:
            severity = "low"

        # -- Reason --
        raw_reason = (notif.get("notificationReason") or "").strip()
        reason_category = self._map_reason(raw_reason)

        # -- Dates --
        start_date = self._parse_iso_date(notif.get("startDate")) or today
        end_date_str = self._parse_iso_date(notif.get("endDate"))
        presumed_end = self._parse_iso_date(notif.get("presumedEndDate"))

        end_date = end_date_str if status == "resolved" else None
        estimated_resolution = presumed_end if status == "active" else None

        # -- Source URL (link to detail page on PharmaStatus) --
        pack_id = rec.get("packId")
        source_url = f"https://pharmastatus.be/human/medical-products/{pack_id}" if pack_id else self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        company = (rec.get("packCompanyName") or "").strip()
        if company:
            notes_parts.append(f"Company: {company}")
        auth_num = (rec.get("authorisationNumber") or "").strip()
        if auth_num:
            notes_parts.append(f"Auth: {auth_num}")
        atc = (rec.get("atcCode") or "").strip()
        if atc:
            notes_parts.append(f"ATC: {atc}")
        impact_str = (notif.get("impactString") or "").strip()
        if impact_str:
            notes_parts.append(f"Impact: {impact_str}")
        additional = notif.get("additionalInfo")
        if additional and str(additional).strip():
            notes_parts.append(f"Info: {str(additional).strip()[:200]}")
        cnk = (rec.get("cnkCode") or "").strip()
        if cnk:
            notes_parts.append(f"CNK: {cnk}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    raw_reason or None,
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
        """Map PharmaStatus reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    @staticmethod
    def _parse_iso_date(raw: Any) -> str | None:
        """Parse ISO-8601 datetime string to date string (YYYY-MM-DD)."""
        if raw is None:
            return None
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None", ""):
            return None

        # Handle ISO format like "2026-04-27T00:00:00.000Z"
        if "T" in raw_str:
            raw_str = raw_str[:10]

        # Validate YYYY-MM-DD
        iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', raw_str)
        if iso_match:
            return raw_str

        # Try European format DD/MM/YYYY or DD-MM-YYYY
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

        return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
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

        print("\n-- Fetching from PharmaStatus ...")
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
