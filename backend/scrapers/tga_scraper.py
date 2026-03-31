"""
TGA Medicine Shortages Scraper
──────────────────────────────
Source:  Therapeutic Goods Administration (Australia)
API:     https://apps.tga.gov.au/Prod/msi/search?shortagetype=All
Docs:    https://www.tga.gov.au/resources/resource/shortages-and-discontinuations

Confirmed response format (probed 2026-02-22):
    The endpoint returns text/html (1.7 MB). All shortage data is SSR-embedded
    as a JavaScript variable in the page:

        tabularData = {"headers": [...], "records": [...]}

    Extraction: regex to locate "tabularData = " then json.JSONDecoder.raw_decode()
    to avoid pulling the entire page into a regex capture group.

    Confirmed record fields:
        active_ingredients  str   e.g. "amoxicillin trihydrate"
        active_joined       str   cleaner joined form (may be absent)
        artg_numb           str   ARTG registration number
        atc_level1          str   e.g. "Anti-infectives for systemic use"
        trade_names         str | list[str]
        shortage_start      str   "DD MMM YYYY"  e.g. "01 Jan 2013"
        shortage_end        str | null  "DD MMM YYYY"
        last_updated        str   "DD MMM YYYY"
        deleted_date        str | null
        sorting_date        str
        dose_form           str
        other_ingredients   list
        status              str   "C" | "R" | "D"
        availability        str   e.g. "Unavailable"
        shortage_impact     str   severity level: "High" | "Medium" | "Low" | "Critical"
                                  OR free-text (handle both)
        tga_shortage_management_action      str  HTML
        tga_shortage_management_action_raw  str  plain text (may be absent)
        patient_impact      str   (may be absent in some records)
        Sponsor_Name        str | null

Status codes:
    C  → active      (Current shortage)
    R  → resolved    (Resolved shortage)
    D  → resolved    (Discontinued — reason_category=discontinuation)

Date formats used by TGA:
    All dates appear as "DD MMM YYYY" e.g. "01 Jan 2013", "31 Dec 2026"
    dateutil.parser.parse(dayfirst=True) handles this correctly.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class TGAScraper(BaseScraper):
    """Scraper for the TGA Medicine Shortages Information (MSI) database."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000003"
    SOURCE_NAME:  str = "Therapeutic Goods Administration — Medicine Shortages"
    BASE_URL:     str = "https://apps.tga.gov.au/Prod/msi/search"
    COUNTRY:      str = "Australia"
    COUNTRY_CODE: str = "AU"

    # TGA is polite about scraping; 2 s gives comfortable headroom
    RATE_LIMIT_DELAY: float = 2.0

    # ─────────────────────────────────────────────────────────────────────────
    # Status mapping
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "C": "active",
        "R": "resolved",
        "D": "active",     # Discontinued — product withdrawn; still an active supply disruption
        "A": "resolved",   # Archived — old record, no longer relevant
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Reason-category keyword detection
    # Applied to: shortage_impact + patient_impact + tga_shortage_management_action_raw
    # Evaluated in order — first match wins.
    # ─────────────────────────────────────────────────────────────────────────

    _REASON_RULES: list[tuple[str, list[str]]] = [
        ("discontinuation",    ["discontinu", "ceased production", "no longer available",
                                "withdrawn from market", "permanently"]),
        ("manufacturing_issue",["manufactur", "production issue", "batch", "recall",
                                "contamination", "gmp", "quality"]),
        ("raw_material",       ["raw material", "api shortage", "active pharmaceutical ingredient",
                                "active substance shortage"]),
        ("supply_chain",       ["supply chain", "freight", "logistics", "import",
                                "export", "distributor", "transport", "warehouse"]),
        ("demand_surge",       ["demand", "increased use", "increase in orders",
                                "pandemic", "seasonal", "surge"]),
        ("regulatory_action",  ["regulatory", "tga action", "licence", "suspended",
                                "cancelled", "compliance", "recall"]),
        ("distribution",       ["wholesaler", "distribution centre", "supply agreement"]),
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # Severity keyword detection
    # Applied to: shortage_impact + patient_impact
    # ─────────────────────────────────────────────────────────────────────────

    _CRITICAL_KEYWORDS: list[str] = [
        "no alternative", "no suitable alternative", "life-saving",
        "life threatening", "critical medicine", "emergency",
        "insulin", "adrenaline", "epinephrine",
    ]
    _HIGH_KEYWORDS: list[str] = [
        "significant impact", "hospital", "intravenous", "injection",
        "parenteral", "limited alternative", "specialist",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    # Regex locates the start of the embedded tabularData JS object.
    # We intentionally don't capture the whole value here — instead we let
    # json.JSONDecoder.raw_decode() consume exactly the JSON object from that
    # position, which is both faster and handles arbitrary nesting correctly.
    _TABULAR_DATA_RE = re.compile(r"tabularData\s*=\s*", re.IGNORECASE)

    def fetch(self) -> dict:
        """
        GET https://apps.tga.gov.au/Prod/msi/search?shortagetype=All

        The endpoint returns an HTML page (~1.7 MB) with all shortage records
        embedded as a server-rendered JavaScript variable:

            tabularData = {"headers": [...], "records": [...]}

        We extract that JSON object from the HTML and return it as a dict.
        """
        self.log.info("Fetching TGA shortage HTML page", extra={"url": self.BASE_URL})
        response = self._get(self.BASE_URL, params={"shortagetype": "All"})
        html = response.text

        match = self._TABULAR_DATA_RE.search(html)
        if not match:
            raise ValueError(
                "Could not locate 'tabularData' in TGA response HTML. "
                "The page structure may have changed — scraper needs updating."
            )

        json_start = match.end()
        try:
            decoder = json.JSONDecoder()
            payload, _ = decoder.raw_decode(html, json_start)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Found 'tabularData' marker but failed to parse the JSON object: {exc}"
            ) from exc

        record_count = len(payload.get("records", []))
        self.log.info(
            "tabularData extracted from HTML",
            extra={"records": record_count, "keys": list(payload.keys())},
        )
        return payload

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform the TGA API payload into a list of shortage dicts ready for
        BaseScraper.upsert().
        """
        records = self._extract_records(raw)
        self.log.info(
            "Normalising TGA records",
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
                    "Failed to normalise TGA record",
                    extra={
                        "error":    str(exc),
                        "artg":     rec.get("artg_numb"),
                        "medicine": rec.get("trade_names"),
                    },
                )

        self.log.info(
            "Normalisation done",
            extra={
                "total":     len(records),
                "normalised": len(normalised),
                "skipped":   skipped,
            },
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _extract_records(self, raw: dict | list) -> list[dict]:
        """Pull the record list from whatever shape the API returns."""
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            # Confirmed shape: {"headers": [...], "records": [...]}
            if "records" in raw:
                return raw["records"]
            # Fallback: look for any list value
            for val in raw.values():
                if isinstance(val, list) and val and isinstance(val[0], dict):
                    return val
        return []

    def _normalise_record(self, rec: dict) -> dict | None:
        """
        Map a single TGA record to the internal shortage dict format.
        Returns None if the record should be discarded (e.g. blank drug name).
        """
        # ── Generic / active ingredient ──────────────────────────────────────
        # active_joined is a cleaner pre-joined version; fall back to active_ingredients
        generic_name: str = (
            rec.get("active_joined")
            or rec.get("active_ingredients")
            or ""
        ).strip()

        if not generic_name:
            return None   # Can't link to a drug — discard

        # ── Brand / trade name ───────────────────────────────────────────────
        brand_names = self._extract_brand_names(rec.get("trade_names"))
        brand_name_str = brand_names[0] if brand_names else None

        # ── Status ───────────────────────────────────────────────────────────
        raw_status = (rec.get("status") or "C").upper().strip()
        status = self._STATUS_MAP.get(raw_status, "active")

        # ── Dates ────────────────────────────────────────────────────────────
        start_date  = self._parse_date(rec.get("shortage_start"))
        shortage_end = self._parse_date(rec.get("shortage_end"))

        if not start_date:
            # Fall back to last_updated if shortage_start is blank
            start_date = self._parse_date(rec.get("last_updated"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        # For current shortages, shortage_end is the *estimated* resolution date.
        # For resolved ones, it is the *actual* end date.
        end_date:                  str | None = shortage_end if status == "resolved" else None
        estimated_resolution_date: str | None = shortage_end if status == "active"   else None

        # ── Text fields ───────────────────────────────────────────────────────
        # shortage_impact: may be a severity label ("High") OR free-text reason
        shortage_impact = (rec.get("shortage_impact") or "").strip()
        patient_impact  = (rec.get("patient_impact")  or "").strip()
        mgmt_action_raw = (rec.get("tga_shortage_management_action_raw") or "").strip()
        availability    = (rec.get("availability") or "").strip()

        # ── Severity ─────────────────────────────────────────────────────────
        # Must be done before reason so we know if shortage_impact was used as severity
        severity = self._infer_severity(status, shortage_impact, patient_impact, generic_name, availability)

        # ── Reason / reason_category ─────────────────────────────────────────
        # If shortage_impact was a bare severity label, it's not useful as a reason.
        # Prefer patient_impact or mgmt_action_raw for the human-readable reason.
        si_is_severity_label = shortage_impact.lower() in self._DIRECT_SEVERITY_MAP

        if raw_status == "D":
            reason_category = "discontinuation"
            reason = (
                (patient_impact or mgmt_action_raw or None)
                if not si_is_severity_label
                else "Product discontinued / no longer available on the Australian market."
            )
        else:
            reason_text_for_category = " ".join(
                filter(None, [shortage_impact, patient_impact, mgmt_action_raw])
            )
            reason_category = self._infer_reason_category(
                "" if si_is_severity_label else shortage_impact,
                patient_impact,
                mgmt_action_raw,
            )
            # Override: discontinued products always get discontinuation category
            if raw_status == "D":
                reason_category = "discontinuation"
            # Prefer free-text fields for reason — availability is a status field,
            # not a reason, so it is stored in notes instead.
            reason = (
                patient_impact
                or (None if si_is_severity_label else shortage_impact)
                or None
            )

        # ── Notes ─────────────────────────────────────────────────────────────
        # Combine patient impact + management action + availability into notes.
        # availability ("Available", "Unavailable", "Currently being sourced…")
        # is TGA product-level status — informative context, not a shortage reason.
        notes_parts: list[str] = []
        if availability:
            notes_parts.append(f"TGA availability: {availability}")
        if patient_impact:
            notes_parts.append(f"Patient impact: {patient_impact}")
        if mgmt_action_raw:
            notes_parts.append(f"TGA guidance: {mgmt_action_raw}")
        notes = "\n\n".join(notes_parts) or None

        # ── Source URL — deep-link to ARTG entry if available ────────────────
        artg = rec.get("artg_numb")
        source_url = (
            f"https://apps.tga.gov.au/Prod/msi/search?artgNumber={artg}"
            if artg
            else self.BASE_URL
        )

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
            "estimated_resolution_date":  estimated_resolution_date,
            "source_url":                 source_url,
            "notes":                      notes,
            # Original record stored in raw_data
            "raw_record": {
                "artg_numb":    artg,
                "trade_names":  brand_name_str,
                "sponsor":      rec.get("Sponsor_Name"),
                "dose_form":    rec.get("dose_form"),
                "atc_level1":   rec.get("atc_level1"),
                "status":       raw_status,
                "shortage_start": rec.get("shortage_start"),
                "shortage_end":   rec.get("shortage_end"),
                "last_updated":   rec.get("last_updated"),
                "availability":   rec.get("availability"),
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Field-level helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_brand_names(raw: Any) -> list[str]:
        """Normalise trade_names to a clean list of strings."""
        if raw is None:
            return []
        if isinstance(raw, str):
            # May be a comma/semicolon-separated string
            parts = re.split(r"[,;]", raw)
            return [p.strip() for p in parts if p.strip()]
        if isinstance(raw, list):
            return [str(item).strip() for item in raw if str(item).strip()]
        return [str(raw).strip()]

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """
        Parse a TGA date string into ISO-8601 (YYYY-MM-DD).

        TGA uses two formats:
          shortage_start / last_updated : "DD-MM-YYYY"  e.g. "03-01-2024"
          shortage_end                  : "DD MMM YYYY" e.g. "31 Dec 2026"

        dayfirst=True is essential to avoid MM-DD-YYYY misinterpretation.
        """
        if not raw or not raw.strip():
            return None
        try:
            dt = dtparser.parse(raw.strip(), dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, OverflowError):
            return None

    def _infer_reason_category(
        self,
        shortage_impact: str,
        patient_impact: str,
        mgmt_action: str,
    ) -> str:
        combined = f"{shortage_impact} {patient_impact} {mgmt_action}".lower()

        for category, keywords in self._REASON_RULES:
            if any(kw in combined for kw in keywords):
                return category

        return "unknown"

    # TGA shortage_impact can be a direct severity label — check these first.
    _DIRECT_SEVERITY_MAP: dict[str, str] = {
        "critical": "critical",
        "high":     "high",
        "medium":   "medium",
        "low":      "low",
    }

    def _infer_severity(
        self,
        status: str,
        shortage_impact: str,
        patient_impact: str,
        generic_name: str,
        availability: str = "",
    ) -> str:
        """
        Derive a severity level.

        PRIORITY ORDER:
        1. Availability status (most reliable — reflects actual supply)
        2. TGA's shortage_impact direct label
        3. Keyword detection on free-text fields

        Availability ALWAYS overrides shortage_impact because TGA often marks
        a product as "Low" impact but "Unavailable" — pharmacists need to see
        the actual availability, not the bureaucratic impact assessment.
        """
        if status == "resolved":
            return "low"

        # 1. Availability is the primary signal — always takes precedence
        avail = (availability or "").lower().strip()
        if avail in ("unavailable", "not available", "discontinued", "emergency supply only"):
            return "critical"
        if avail in ("limited", "very limited", "limited availability", "restricted",
                     "reduction in supply until supply is exhausted"):
            return "high"

        # 2. Direct label match from shortage_impact
        direct = shortage_impact.strip().lower()
        if direct in self._DIRECT_SEVERITY_MAP:
            return self._DIRECT_SEVERITY_MAP[direct]

        # 3. Keyword scan on free-text fields
        combined = f"{shortage_impact} {patient_impact} {generic_name}".lower()
        if any(kw in combined for kw in self._CRITICAL_KEYWORDS):
            return "critical"
        if any(kw in combined for kw in self._HIGH_KEYWORDS):
            return "high"

        # 4. If availability says "available", it's low severity
        if avail in ("available", "in stock"):
            return "low"

        return "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone test entrypoint
#
# Usage:
#   cp .env.example .env && fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
#   python -m backend.scrapers.tga_scraper
#
# In DRY_RUN mode (MEDERTI_DRY_RUN=1) the scraper fetches and normalises but
# does NOT write to Supabase — useful for local testing without a DB.
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        # ── Dry-run: inject a no-op DB client so no credentials are needed ────
        # Only fetch() and normalize() are called — no DB reads or writes occur.
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live TGA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        # Pass mock directly — avoids any call to get_supabase_client()
        scraper = TGAScraper(db_client=MagicMock())

        print("\n── Fetching from TGA API …")
        raw = scraper.fetch()
        records = scraper._extract_records(raw)
        print(f"── Raw records received : {len(records)}")

        print("── Normalising records …")
        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            print("\n── Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            # Status breakdown
            from collections import Counter
            status_counts = Counter(e["status"] for e in events)
            severity_counts = Counter(e.get("severity") for e in events)
            reason_counts = Counter(e.get("reason_category") for e in events)
            print("\n── Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:12s} {v}")
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

    scraper = TGAScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
