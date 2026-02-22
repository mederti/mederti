"""
FDA Drug Shortages Scraper
──────────────────────────
Source:  U.S. Food and Drug Administration — Drug Shortages
API:     https://api.fda.gov/drug/shortages.json  (openFDA)
Docs:    https://open.fda.gov/apis/drug/drugshortages/

Confirmed response format (probed 2026-02-22):
    Pure JSON REST API. Paginated with max 100 records per request.

    GET https://api.fda.gov/drug/shortages.json?limit=100&skip=0

    Response shape:
        {
          "meta": {
            "results": {"skip": 0, "limit": 100, "total": 1742}
          },
          "results": [
            {
              "generic_name":          "Fentanyl Citrate Injection",
              "company_name":          "Fresenius Kabi USA, LLC",
              "status":                "Current",
              "presentation":          "Fentanyl Citrate ... 0.05 mg/1 mL (NDC ...)",
              "package_ndc":           "63323-806-05",
              "dosage_form":           "Injection",
              "therapeutic_category":  ["Analgesia/Addiction", "Pediatric"],
              "update_type":           "Revised",
              "update_date":           "02/05/2026",
              "initial_posting_date":  "01/01/2012",
              "shortage_reason":       "Other",
              "availability":          "Unavailable",
              "related_info":          "Next release February 2026...",
              "openfda": {
                "brand_name":          ["FENTANYL CITRATE"],
                "manufacturer_name":   ["Fresenius Kabi USA, LLC"],
                "substance_name":      ["FENTANYL CITRATE"],
                "route":               ["INTRAMUSCULAR", "INTRAVENOUS"],
                "rxcui":               [...],
                ...
              }
            }, ...
          ]
        }

Status values:
    "Current"            → active
    "To Be Discontinued" → active  (reason_category = discontinuation)
    "Resolved"           → resolved

Pagination:
    limit = 100 (API max), skip increments by 100 per page.
    meta.results.total tells us the full record count.
    ~1,742 records → ~18 pages.

Rate limits (openFDA, without API key):
    40 req/min → ~1.5 s between requests (default RATE_LIMIT_DELAY).
    Set FDA_API_KEY env var to unlock 240 req/min.

Date format: MM/DD/YYYY  (US format — dateutil dayfirst=False)
"""

from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class FDAScraper(BaseScraper):
    """Scraper for the openFDA Drug Shortages database."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000001"
    SOURCE_NAME:  str = "U.S. Food and Drug Administration — Drug Shortages"
    BASE_URL:     str = "https://api.fda.gov/drug/shortages.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    # openFDA allows 40 req/min without a key; 1.5 s is safely under that.
    # With FDA_API_KEY in the environment we could lower this, but 1.5 s is
    # fine even for ~18 pages (~27 s total).
    RATE_LIMIT_DELAY: float = 1.5

    _PAGE_SIZE: int = 100   # openFDA hard maximum

    # ─────────────────────────────────────────────────────────────────────────
    # Status mapping
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "Current":             "active",
        "To Be Discontinued":  "active",    # ongoing; reason_category flags discontinuation
        "Resolved":            "resolved",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Shortage-reason mapping  (FDA shortage_reason → internal reason_category)
    # ─────────────────────────────────────────────────────────────────────────

    _REASON_MAP: dict[str, str] = {
        "Manufacturing Delays":           "manufacturing_issue",
        "Manufacturing delays":           "manufacturing_issue",
        "Quality Issues":                 "manufacturing_issue",
        "Demand Increase":                "demand_surge",
        "Increased Demand":               "demand_surge",
        "Raw Material Supply":            "raw_material",
        "Raw Materials":                  "raw_material",
        "Supply Chain Issues":            "supply_chain",
        "Supply Chain":                   "supply_chain",
        "Discontinuation":                "discontinuation",
        "Business Decision":              "discontinuation",
        "Regulatory Action":              "regulatory_action",
        "Other":                          "unknown",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Severity heuristics (FDA has no direct severity field)
    # ─────────────────────────────────────────────────────────────────────────

    _CRITICAL_DRUG_KEYWORDS: list[str] = [
        "insulin", "epinephrine", "adrenaline", "vasopressin", "norepinephrine",
        "dopamine", "atropine", "adenosine", "sodium bicarbonate",
        "calcium gluconate", "potassium chloride", "dextrose", "naloxone",
        "morphine", "fentanyl", "propofol", "midazolam", "vecuronium",
        "succinylcholine", "rocuronium", "nitroglycerin",
    ]
    _HIGH_DRUG_KEYWORDS: list[str] = [
        "injection", "infusion", "intravenous", "parenteral",
        "antibiotic", "antifungal", "chemotherapy", "oncology",
        "heparin", "warfarin", "enoxaparin",
        "amphotericin", "vancomycin", "meropenem", "piperacillin",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Paginate through the openFDA drug shortages endpoint, accumulating all
        records into a single list.  Returns the list directly (no wrapper dict
        needed — BaseScraper._extract_records() handles list inputs).
        """
        api_key = os.environ.get("FDA_API_KEY", "").strip()
        all_records: list[dict] = []
        skip = 0
        total: int | None = None
        page_count = 0

        while True:
            params: dict[str, Any] = {"limit": self._PAGE_SIZE, "skip": skip}
            if api_key:
                params["api_key"] = api_key

            response = self._get(self.BASE_URL, params=params)
            data: dict = response.json()

            if total is None:
                total = data["meta"]["results"]["total"]
                pages = math.ceil(total / self._PAGE_SIZE)
                self.log.info(
                    "FDA API metadata",
                    extra={"total": total, "pages": pages, "url": self.BASE_URL},
                )

            batch: list[dict] = data.get("results", [])
            all_records.extend(batch)
            page_count += 1

            self.log.debug(
                "Fetched FDA page",
                extra={
                    "page":        page_count,
                    "skip":        skip,
                    "batch_size":  len(batch),
                    "accumulated": len(all_records),
                    "total":       total,
                },
            )

            skip += self._PAGE_SIZE
            if skip >= total or not batch:
                break

        self.log.info(
            "FDA fetch complete",
            extra={"records": len(all_records), "pages": page_count},
        )
        return all_records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform the FDA API payload into shortage dicts ready for
        BaseScraper.upsert().
        """
        records = raw if isinstance(raw, list) else raw.get("results", [])
        self.log.info(
            "Normalising FDA records",
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
                    "Failed to normalise FDA record",
                    extra={
                        "error":        str(exc),
                        "generic_name": rec.get("generic_name"),
                        "ndc":          rec.get("package_ndc"),
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
        Map a single FDA openFDA record to the internal shortage dict format.
        Returns None if the record should be discarded (e.g. blank drug name).
        """
        openfda: dict = rec.get("openfda") or {}

        # ── Generic name ──────────────────────────────────────────────────────
        # FDA generic_name often includes the dosage form, e.g.
        # "Fentanyl Citrate Injection".  Strip the dosage form suffix so drug
        # lookups match against the cleaner canonical name (e.g. "Fentanyl Citrate").
        raw_generic: str = (rec.get("generic_name") or "").strip()
        if not raw_generic:
            return None

        dosage_form: str = (rec.get("dosage_form") or "").strip()
        generic_name = self._clean_generic_name(raw_generic, dosage_form)

        # ── Brand names ───────────────────────────────────────────────────────
        # openfda.brand_name is a list; title-case it for consistency.
        raw_brands: list[str] = openfda.get("brand_name") or []
        brand_names = [b.title() for b in raw_brands if b.strip()]

        # ── Status ────────────────────────────────────────────────────────────
        raw_status: str = (rec.get("status") or "Current").strip()
        status = self._STATUS_MAP.get(raw_status, "active")

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_date(rec.get("initial_posting_date"))
        if not start_date:
            start_date = self._parse_date(rec.get("update_date"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        # For resolved/discontinued records, use the relevant closing date.
        closing_date = self._parse_date(
            rec.get("discontinued_date") or rec.get("change_date")
        )
        end_date: str | None = closing_date if status == "resolved" else None

        # ── Reason / reason_category ──────────────────────────────────────────
        fda_reason: str = (rec.get("shortage_reason") or "").strip()

        if raw_status == "To Be Discontinued":
            reason_category = "discontinuation"
        else:
            reason_category = self._REASON_MAP.get(fda_reason, "unknown")

        # related_info is the main free-text field (availability notes, ETA, etc.)
        related_info: str | None = (rec.get("related_info") or "").strip() or None
        resolved_note: str | None = (rec.get("resolved_note") or "").strip() or None

        # Use related_info as the human-readable reason.
        # Fall back to the raw FDA reason label if related_info is blank.
        reason: str | None = related_info or (fda_reason if fda_reason != "Other" else None)

        # ── Severity ──────────────────────────────────────────────────────────
        availability: str = (rec.get("availability") or "").strip()
        severity = self._infer_severity(status, availability, generic_name, raw_generic)

        # ── Therapeutic category ──────────────────────────────────────────────
        # FDA provides an array; join for storage in notes.
        therapeutic_cats: list[str] = rec.get("therapeutic_category") or []
        therapeutic_str: str | None = "; ".join(therapeutic_cats) or None

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        if therapeutic_str:
            notes_parts.append(f"Therapeutic category: {therapeutic_str}")
        if availability:
            notes_parts.append(f"Availability: {availability}")
        if related_info:
            notes_parts.append(related_info)
        if resolved_note:
            notes_parts.append(f"Resolution note: {resolved_note}")
        notes: str | None = "\n\n".join(notes_parts) or None

        # ── Source URL ────────────────────────────────────────────────────────
        # openFDA has no per-drug deep-link; point to the FDA search portal.
        source_url = "https://www.accessdata.fda.gov/scripts/drugshortages/"

        return {
            # Drug resolution
            "generic_name":               generic_name,
            "brand_names":                brand_names,
            # Shortage event fields
            "status":                     status,
            "severity":                   severity,
            "reason":                     reason,
            "reason_category":            reason_category,
            "start_date":                 start_date,
            "end_date":                   end_date,
            "estimated_resolution_date":  None,  # FDA does not provide this
            "source_url":                 source_url,
            "notes":                      notes,
            # Original record stored verbatim
            "raw_record": {
                "package_ndc":           rec.get("package_ndc"),
                "presentation":          rec.get("presentation"),
                "dosage_form":           dosage_form or None,
                "company_name":          rec.get("company_name"),
                "status":                raw_status,
                "shortage_reason":       fda_reason or None,
                "availability":          availability or None,
                "therapeutic_category":  therapeutic_cats or None,
                "initial_posting_date":  rec.get("initial_posting_date"),
                "update_date":           rec.get("update_date"),
                "update_type":           rec.get("update_type"),
                "discontinued_date":     rec.get("discontinued_date"),
                "change_date":           rec.get("change_date"),
                "substance_name":        openfda.get("substance_name"),
                "route":                 openfda.get("route"),
                "rxcui":                 openfda.get("rxcui"),
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Field-level helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _clean_generic_name(name: str, dosage_form: str) -> str:
        """
        Strip the dosage form suffix appended by FDA to generic_name.

        Examples:
            "Fentanyl Citrate Injection", "Injection"
                → "Fentanyl Citrate"
            "Methylphenidate Transdermal Film, Extended Release", "Transdermal Film"
                → "Methylphenidate"
            "Amoxicillin Capsule", "Capsule"
                → "Amoxicillin"

        If the dosage form is not found at the end, the name is returned as-is.
        """
        if not dosage_form:
            return name.strip()

        # Strip trailing ", <dosage_form>" or " <dosage_form>"
        suffix = dosage_form.strip()
        lower_name = name.lower()
        lower_suffix = suffix.lower()

        if lower_name.endswith(lower_suffix):
            cleaned = name[: -len(suffix)].rstrip(" ,").strip()
            if cleaned:
                return cleaned

        return name.strip()

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """
        Parse an FDA date string (MM/DD/YYYY) into ISO-8601 (YYYY-MM-DD).
        dateutil handles MM/DD/YYYY correctly with dayfirst=False.
        """
        if not raw or not raw.strip():
            return None
        try:
            dt = dtparser.parse(raw.strip(), dayfirst=False)
            return dt.date().isoformat()
        except (ValueError, OverflowError):
            return None

    def _infer_severity(
        self,
        status: str,
        availability: str,
        generic_name: str,
        raw_generic: str,
    ) -> str:
        """
        Derive a severity level for an FDA shortage event.

        FDA has no direct severity field, so we infer it from:
          1. Resolved shortages → 'low' (historical, no current impact)
          2. Keyword match on generic_name for life-critical drugs → 'critical'
          3. Availability status → 'Unavailable' is worse than 'Limited'
          4. Dosage-form keywords (injection/parenteral) → bump up to 'high'
          5. Default → 'medium'
        """
        if status == "resolved":
            return "low"

        combined = f"{generic_name} {raw_generic}".lower()

        # Life-critical drugs
        if any(kw in combined for kw in self._CRITICAL_DRUG_KEYWORDS):
            return "critical"

        # Availability-driven
        avail_lower = availability.lower()
        if "unavailable" in avail_lower:
            # Fully unavailable + high-risk dosage form/drug class
            if any(kw in combined for kw in self._HIGH_DRUG_KEYWORDS):
                return "critical"
            return "high"

        if "limited" in avail_lower:
            if any(kw in combined for kw in self._HIGH_DRUG_KEYWORDS):
                return "high"
            return "medium"

        return "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
#
# Usage:
#   python -m backend.scrapers.fda_scraper              # live run (DB writes)
#   MEDERTI_DRY_RUN=1 python -m backend.scrapers.fda_scraper  # dry run
#
# Optional env var: FDA_API_KEY  (openFDA key → 240 req/min vs 40/min)
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
        print("Fetches live FDA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = FDAScraper(db_client=MagicMock())

        print("\n── Fetching from FDA openFDA API …")
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

    scraper = FDAScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
