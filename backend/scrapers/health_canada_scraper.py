"""
Health Canada Drug Shortages Scraper
─────────────────────────────────────
Source:  Health Canada — Drug Shortages Database
Site:    https://healthproductshortages.ca  (moved from drugshortagescanada.ca)
Export:  https://healthproductshortages.ca/search/export  (POST, no auth required)

Confirmed response format (probed 2026-02-22):
    POST /search/export with form-encoded parameters returns a ZIP file
    containing shortage_report_export.csv.

    ZIP → CSV structure:
        Row 1: Disclaimer banner (skip)
        Row 2: Column headers
        Row 3+: Data rows

    Confirmed CSV columns:
        Report ID, Drug Identification Number, Report Type,
        Brand name, Company Name, Common or Proper name,
        Ingredients, Strength(s), Packaging size,
        Route of administration, Shortage status, Dosage form(s),
        ATC Code, ATC description,
        Anticipated start date, Actual start date,
        Estimated end date, Actual end date,
        Reason, Date Created, Date Updated, Tier 3

Status values:
    "Actual shortage"      → active
    "Anticipated shortage" → anticipated
    "Avoided shortage"     → resolved  (never materialised)
    "Resolved"             → resolved

Reason values (Health Canada standardised strings):
    "Disruption of the manufacture of the drug."                → manufacturing_issue
    "Demand increase for the drug."                             → demand_surge
    "Shortage of an active ingredient."                         → raw_material
    "Shortage of an inactive ingredient or component."          → raw_material
    "Delay in shipping of the drug."                            → supply_chain
    "Requirements related to complying with good manufacturing
     practices."                                                → manufacturing_issue
    "Other (Please describe in comments)"                       → unknown

Tier 3:
    "Yes" = High clinical priority (life-saving; no or limited alternative).
    Used to elevate severity to "critical".

Dates: ISO 8601 (YYYY-MM-DD), already parsed — no conversion needed.

ATC codes: Present in the export — excellent for future drug enrichment.

Status filters fetched:
    active_confirmed      → "Actual shortage"    (~1,771 records)
    anticipated_shortage  → "Anticipated shortage" (~75 records)
    (resolved is ~22,000 records and times out on export; skip for now)
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper
from backend.utils.retry import with_exponential_backoff


class HealthCanadaScraper(BaseScraper):
    """Scraper for the Health Canada Drug Shortages Database."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000002"
    SOURCE_NAME:  str = "Health Canada — Drug Shortages Database"
    BASE_URL:     str = "https://healthproductshortages.ca"
    COUNTRY:      str = "Canada"
    COUNTRY_CODE: str = "CA"

    EXPORT_URL:   str = "https://healthproductshortages.ca/search/export"

    # Export is a POST that generates a ZIP — give it a longer timeout.
    EXPORT_TIMEOUT: float = 120.0

    # Status filters to include in the export request (one POST per filter).
    _EXPORT_STATUSES: list[str] = [
        "active_confirmed",
        "anticipated_shortage",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # Status mapping
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "Actual shortage":      "active",
        "Anticipated shortage": "anticipated",
        "Avoided shortage":     "resolved",
        "Resolved":             "resolved",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Reason mapping  (HC uses full English sentences)
    # ─────────────────────────────────────────────────────────────────────────

    _REASON_MAP: dict[str, str] = {
        "Disruption of the manufacture of the drug.":
            "manufacturing_issue",
        "Demand increase for the drug.":
            "demand_surge",
        "Shortage of an active ingredient.":
            "raw_material",
        "Shortage of an inactive ingredient or component.":
            "raw_material",
        "Delay in shipping of the drug.":
            "supply_chain",
        "Requirements related to complying with good manufacturing practices.":
            "manufacturing_issue",
        "Other (Please describe in comments)":
            "unknown",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        POST to the Health Canada bulk CSV export endpoint for each status
        filter and combine the results.

        Each POST returns a ZIP file containing shortage_report_export.csv.
        No authentication required.
        """
        all_records: list[dict] = []

        for status_filter in self._EXPORT_STATUSES:
            records = self._fetch_export(status_filter)
            self.log.info(
                "Fetched HC export page",
                extra={
                    "status_filter": status_filter,
                    "records":       len(records),
                },
            )
            all_records.extend(records)

        self.log.info(
            "HC fetch complete",
            extra={"total_records": len(all_records)},
        )
        return all_records

    @with_exponential_backoff(
        max_attempts=3,
        base_delay=3.0,
        max_delay=60.0,
        exceptions=(httpx.HTTPError, httpx.TimeoutException, httpx.NetworkError),
    )
    def _fetch_export(self, status_filter: str) -> list[dict]:
        """
        POST to /search/export, receive ZIP, extract CSV, parse into dicts.
        Row 1 of the CSV is a disclaimer; row 2 is the real header row.
        """
        self._enforce_rate_limit()

        form_data = {
            "filter_types[]":         "shortages",
            "filter_statuses[]":      status_filter,
            "export[filter_types]":   "shortages",
            "export[filter_statuses]": status_filter,
        }

        self.log.debug(
            "Posting to HC export endpoint",
            extra={"url": self.EXPORT_URL, "status_filter": status_filter},
        )

        with httpx.Client(
            headers=self.DEFAULT_HEADERS,
            timeout=self.EXPORT_TIMEOUT,
            follow_redirects=True,
        ) as client:
            response = client.post(self.EXPORT_URL, data=form_data)
            response.raise_for_status()

        self.log.debug(
            "HC export response",
            extra={
                "status":       response.status_code,
                "content_type": response.headers.get("content-type", ""),
                "bytes":        len(response.content),
            },
        )

        # ── Unzip ─────────────────────────────────────────────────────────
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            csv_name = zf.namelist()[0]
            raw_csv = zf.read(csv_name).decode("utf-8-sig")

        # ── Skip disclaimer row, parse from header row onward ──────────────
        # Row 1: '"Shortage reports","DISCLAIMER: ..."'
        # Row 2: '"Report ID","Drug Identification Number",...'
        # Row 3+: data
        lines = raw_csv.splitlines()
        csv_body = "\n".join(lines[1:])  # drop disclaimer

        reader = csv.DictReader(io.StringIO(csv_body))
        return list(reader)

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform the Health Canada CSV records into shortage dicts ready for
        BaseScraper.upsert().
        """
        records: list[dict] = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising HC records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(records)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise HC record",
                    extra={
                        "error":     str(exc),
                        "report_id": rec.get("Report ID"),
                        "din":       rec.get("Drug Identification Number"),
                    },
                )

        self.log.info(
            "Normalisation done",
            extra={
                "total":      len(records),
                "normalised": len(normalised),
                "skipped":    skipped,
            },
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        """
        Map a single Health Canada CSV row to the internal shortage dict format.
        Returns None if the record should be discarded (e.g. blank drug name).
        """
        # ── Generic name ─────────────────────────────────────────────────────
        # "Ingredients" contains INN names (e.g. "ADEFOVIR DIPIVOXIL").
        # For multi-ingredient drugs: "AMLODIPINE; TELMISARTAN".
        # We use the first ingredient as the canonical generic name for matching
        # (the drug lookup prefix-matches against the first word).
        ingredients_raw: str = (rec.get("Ingredients") or "").strip()
        common_name:     str = (rec.get("Common or Proper name") or "").strip()

        if ingredients_raw:
            first_ingredient = ingredients_raw.split(";")[0].strip()
            generic_name = first_ingredient.title()
        elif common_name:
            generic_name = common_name.title()
        else:
            return None  # no usable drug name — discard

        # ── Brand name ────────────────────────────────────────────────────────
        brand_raw = (rec.get("Brand name") or "").strip()
        brand_names = [brand_raw.title()] if brand_raw else []

        # ── Status ────────────────────────────────────────────────────────────
        hc_status: str = (rec.get("Shortage status") or "").strip()
        status = self._STATUS_MAP.get(hc_status, "active")

        # ── Dates (already ISO 8601 — no parsing needed) ──────────────────────
        actual_start     = self._as_date(rec.get("Actual start date"))
        anticipated_start = self._as_date(rec.get("Anticipated start date"))
        estimated_end    = self._as_date(rec.get("Estimated end date"))
        actual_end       = self._as_date(rec.get("Actual end date"))

        # Prefer actual start; fall back to anticipated; then date created
        start_date = (
            actual_start
            or anticipated_start
            or self._as_date(rec.get("Date Created"))
            or datetime.now(timezone.utc).date().isoformat()
        )

        end_date: str | None = actual_end if status == "resolved" else None
        estimated_resolution_date: str | None = (
            estimated_end if status in ("active", "anticipated") else None
        )

        # ── Reason / reason_category ──────────────────────────────────────────
        hc_reason: str = (rec.get("Reason") or "").strip()
        reason_category = self._REASON_MAP.get(hc_reason, "unknown")
        reason: str | None = (
            hc_reason if hc_reason and hc_reason != "Other (Please describe in comments)" else None
        )

        # ── Severity ──────────────────────────────────────────────────────────
        tier3: bool   = (rec.get("Tier 3") or "No").strip().lower() == "yes"
        route: str    = (rec.get("Route of administration") or "").upper()
        atc_desc: str = (rec.get("ATC description") or "").upper()
        severity = self._infer_severity(status, tier3, route, atc_desc, generic_name)

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        atc_code = (rec.get("ATC Code") or "").strip()
        if atc_code:
            notes_parts.append(f"ATC: {atc_code} — {atc_desc.title()}")
        if rec.get("Strength(s)"):
            notes_parts.append(f"Strength: {rec['Strength(s)']}")
        if route:
            notes_parts.append(f"Route: {route.title()}")
        if tier3:
            notes_parts.append("Tier 3: Yes (high clinical priority — no or limited alternatives)")
        notes: str | None = "\n".join(notes_parts) or None

        # ── Source URL ────────────────────────────────────────────────────────
        report_id = (rec.get("Report ID") or "").strip()
        source_url = (
            f"https://healthproductshortages.ca/shortage/{report_id}"
            if report_id
            else self.BASE_URL
        )

        return {
            # Drug resolution
            "generic_name":  generic_name,
            "brand_names":   brand_names,
            # Shortage event fields
            "status":                    status,
            "severity":                  severity,
            "reason":                    reason,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                source_url,
            "notes":                     notes,
            # Original record stored verbatim
            "raw_record": {
                "report_id":         report_id or None,
                "din":               (rec.get("Drug Identification Number") or "").strip() or None,
                "brand_name":        brand_raw or None,
                "company_name":      (rec.get("Company Name") or "").strip() or None,
                "common_proper_name": common_name or None,
                "ingredients":       ingredients_raw or None,
                "strength":          (rec.get("Strength(s)") or "").strip() or None,
                "dosage_form":       (rec.get("Dosage form(s)") or "").strip() or None,
                "route":             route or None,
                "atc_code":          atc_code or None,
                "atc_description":   atc_desc.title() or None,
                "shortage_status":   hc_status or None,
                "anticipated_start": rec.get("Anticipated start date") or None,
                "actual_start":      rec.get("Actual start date") or None,
                "estimated_end":     rec.get("Estimated end date") or None,
                "actual_end":        rec.get("Actual end date") or None,
                "reason":            hc_reason or None,
                "tier3":             rec.get("Tier 3") or None,
                "date_created":      rec.get("Date Created") or None,
                "date_updated":      rec.get("Date Updated") or None,
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Field-level helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _as_date(raw: str | None) -> str | None:
        """
        Validate and return a HC date string (already YYYY-MM-DD).
        Returns None for blank / malformed values.
        """
        if not raw:
            return None
        stripped = raw.strip()
        if len(stripped) == 10 and stripped[4] == "-" and stripped[7] == "-":
            return stripped
        return None

    def _infer_severity(
        self,
        status: str,
        tier3: bool,
        route: str,
        atc_desc: str,
        generic_name: str,
    ) -> str:
        """
        Derive a severity level for a Health Canada shortage event.

        Priority order:
          1. Resolved shortages → 'low' (historical context only)
          2. Tier 3 = Yes → 'critical' (HC's own high-impact flag)
          3. Parenteral / injectable route → 'high'
          4. Life-critical ATC classes → 'high'
          5. Default → 'medium'
        """
        if status == "resolved":
            return "low"

        if tier3:
            return "critical"

        combined = f"{route} {atc_desc} {generic_name}".lower()

        if any(kw in combined for kw in [
            "intravenous", "parenteral", "infusion", "injection",
        ]):
            return "high"

        if any(kw in combined for kw in [
            "insulin", "antidiabetic", "cardiac", "antineoplastic",
            "blood glucose", "immunosuppressant", "transplant",
            "antiinfective", "antibacterial", "antifungal",
        ]):
            return "high"

        return "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
#
# Usage:
#   python -m backend.scrapers.health_canada_scraper        # live run (DB writes)
#   MEDERTI_DRY_RUN=1 python -m backend.scrapers.health_canada_scraper
#
# No API key or account required — uses public CSV export endpoint.
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
        print("Fetches live HC data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = HealthCanadaScraper(db_client=MagicMock())

        print("\n── Fetching from Health Canada export endpoint …")
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")

        print("── Normalising records …")
        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            print("\n── Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            from collections import Counter

            status_counts   = Counter(e["status"] for e in events)
            severity_counts = Counter(e.get("severity") for e in events)
            reason_counts   = Counter(e.get("reason_category") for e in events)

            print("\n── Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:25s} {v}")
            print("\n── Severity breakdown:")
            for k, v in sorted(severity_counts.items()):
                print(f"   {str(k):12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # ── Live run ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)

    scraper = HealthCanadaScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
