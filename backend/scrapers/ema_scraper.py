"""
EMA Medicine Shortages Scraper
────────────────────────────────
Source:  European Medicines Agency — Medicines Shortages (ESMP)
URL:     https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/
         medicine-shortages-availability-issues/public-information-medicine-shortages

Data source (confirmed 2026-02-22):
    EMA publishes a daily-refreshed flat-file dump (updated at 06:00 and 18:00
    Amsterdam time) in two formats:

    XLSX (confirmed live — primary target):
        https://www.ema.europa.eu/en/documents/report/medicines-output-shortages-report_en.xlsx

    JSON (parallel file — tried first; falls back to XLSX if unavailable):
        https://www.ema.europa.eu/en/documents/report/shortages-output-json-report_en.json

    No authentication required.  No pagination — the entire dataset is one file.

Known EMA XLSX/JSON field names (probe 2026-02-22, confirmed via ESMP API spec):
    international_non_proprietary_name_inn_or_common_name  → INN / generic name
    medicine_affected                                       → brand name
    shortage_status                                         → Ongoing / Resolved
    shortage_start_date                                     → ISO date
    shortage_end_date                                       → ISO date or blank
    reason_for_shortage / root_cause                        → cause category
    marketing_authorisation_holder                          → MAH company
    affected_countries                                      → list of ISO codes

    Actual column names are confirmed at runtime and may vary; field resolution
    is done via a priority-ordered alias map.

Data source UUID:  10000000-0000-0000-0000-000000000005  (EMA, EU)
Country:           European Union
Country code:      EU
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

import httpx
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class EMAScraper(BaseScraper):
    """Scraper for EMA ESMP medicine shortage flat-file exports."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000005"
    SOURCE_NAME:  str = "European Medicines Agency — Medicines Shortages"
    BASE_URL:     str = "https://www.ema.europa.eu"
    COUNTRY:      str = "European Union"
    COUNTRY_CODE: str = "EU"

    RATE_LIMIT_DELAY: float = 2.0   # single bulk download; polite delay before it

    JSON_URL: str = (
        "https://www.ema.europa.eu/en/documents/report/"
        "shortages-output-json-report_en.json"
    )
    XLSX_URL: str = (
        "https://www.ema.europa.eu/en/documents/report/"
        "medicines-output-shortages-report_en.xlsx"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Column-name aliases  (ordered by confidence — first match wins)
    # ─────────────────────────────────────────────────────────────────────────

    _INN_ALIASES: list[str] = [
        "international_non_proprietary_name_inn_or_common_name",
        "inn_or_common_name", "inn", "active_substance",
        "active substance", "inn or common name",
        "International Non-Proprietary Name (INN) or Common Name",
    ]
    _MEDICINE_ALIASES: list[str] = [
        "medicine_affected", "medicine affected", "medicine name",
        "medicine_name", "product_name", "product name",
        "Name of the medicine",
    ]
    _STATUS_ALIASES: list[str] = [
        "supply_shortage_status",                          # confirmed JSON field name
        "shortage_status", "shortage status", "status",
        "Status", "Shortage Status",
    ]
    _START_ALIASES: list[str] = [
        "start_of_shortage_date",                          # confirmed JSON field name
        "shortage_start_date", "shortage start date", "start date",
        "start_date", "Start date", "Shortage start date",
    ]
    _END_ALIASES: list[str] = [
        "expected_resolution_date",                        # confirmed JSON field name
        "shortage_end_date", "shortage end date", "end date",
        "end_date", "End date", "Shortage end date",
    ]
    _REASON_ALIASES: list[str] = [
        "root_cause_s_of_shortage",                        # confirmed JSON field name (plural)
        "root_cause_of_shortage", "root_cause",
        "reason_for_shortage", "reason for shortage",
        "shortage_reason", "Reason for shortage", "Root cause", "Cause",
    ]
    _MAH_ALIASES: list[str] = [
        "marketing_authorisation_holder_s",                # confirmed JSON field name (plural)
        "marketing_authorisation_holder", "marketing authorisation holder",
        "mah", "MAH", "holder", "Marketing Authorisation Holder",
    ]
    _COUNTRIES_ALIASES: list[str] = [
        "eu_eea_countries_affected",                       # likely JSON field name
        "affected_countries", "affected countries", "countries",
        "Countries affected", "Affected countries",
        "Member States concerned",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # Status / reason mappings
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "ongoing":    "active",
        "resolved":   "resolved",
        "closed":     "resolved",
        "current":    "active",
        "monitoring": "active",
    }

    _REASON_MAP: dict[str, str] = {
        "manufacturing capacity":      "manufacturing_issue",
        "manufacturing delays":        "manufacturing_issue",
        "quality issues":              "manufacturing_issue",
        "quality":                     "manufacturing_issue",
        "demand increase":             "demand_surge",
        "increased demand":            "demand_surge",
        "raw material":                "raw_material",
        "raw material supply":         "raw_material",
        "supply chain":                "supply_chain",
        "distribution":                "supply_chain",
        "discontinuation":             "discontinuation",
        "business decision":           "discontinuation",
        "regulatory":                  "regulatory_action",
        "other":                       "unknown",
        "mfg_capacity":                "manufacturing_issue",
        "raw_material":                "raw_material",
        "demand_increase":             "demand_surge",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Try the JSON flat file first; fall back to XLSX if unavailable.
        Returns a flat list of raw record dicts.
        """
        # ── Attempt 1: JSON endpoint ──────────────────────────────────────────
        try:
            response = self._get(self.JSON_URL)
            ct = response.headers.get("content-type", "")
            if "json" in ct or response.content[:1] in (b"[", b"{"):
                data = response.json()
                records = data if isinstance(data, list) else (
                    data.get("results") or data.get("data") or
                    data.get("items") or data.get("shortages") or
                    list(data.values())[0] if isinstance(data, dict) else []
                )
                if records:
                    self.log.info(
                        "EMA JSON fetch complete",
                        extra={"records": len(records), "source": "json"},
                    )
                    return records
        except Exception as exc:
            self.log.info(
                "EMA JSON endpoint unavailable — falling back to XLSX",
                extra={"error": str(exc)},
            )

        # ── Attempt 2: XLSX file ──────────────────────────────────────────────
        return self._fetch_xlsx()

    def _fetch_xlsx(self) -> list[dict]:
        """Download the EMA shortage XLSX and return a list of row dicts."""
        import openpyxl  # imported here so the dep is optional for non-EMA scrapers

        response = self._get(self.XLSX_URL)
        wb = openpyxl.load_workbook(io.BytesIO(response.content), read_only=True)
        ws = wb.active

        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []

        # First non-empty row is the header
        header_row = rows[0]
        # Strip whitespace and None from headers
        headers = [str(h).strip() if h is not None else f"col_{i}"
                   for i, h in enumerate(header_row)]

        self.log.info(
            "EMA XLSX columns",
            extra={"columns": headers, "source": "xlsx"},
        )

        records = []
        for row in rows[1:]:
            if not any(v is not None and str(v).strip() for v in row):
                continue  # skip blank rows
            record = {}
            for h, v in zip(headers, row):
                record[h] = v if v is not None else ""
            records.append(record)

        wb.close()
        self.log.info(
            "EMA XLSX fetch complete",
            extra={"records": len(records), "source": "xlsx"},
        )
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else raw.get("results", [])
        self.log.info(
            "Normalising EMA records",
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
                    "Failed to normalise EMA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        keys = {k.strip().lower(): k for k in rec}  # lower→original key map

        def get(*aliases: str) -> str:
            for alias in aliases:
                # Try exact
                if alias in rec:
                    return str(rec[alias]).strip()
                # Try lower-cased key map
                v = keys.get(alias.lower())
                if v and rec[v] is not None:
                    return str(rec[v]).strip()
            return ""

        # ── Generic name (INN) ────────────────────────────────────────────────
        generic_name = get(*self._INN_ALIASES)
        if not generic_name:
            generic_name = get(*self._MEDICINE_ALIASES)
        if not generic_name:
            return None

        # ── Brand name ────────────────────────────────────────────────────────
        medicine = get(*self._MEDICINE_ALIASES)
        brand_names = [medicine] if medicine and medicine.lower() != generic_name.lower() else []

        # ── Status ────────────────────────────────────────────────────────────
        raw_status = get(*self._STATUS_ALIASES).lower()
        status = self._STATUS_MAP.get(raw_status, "active")

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_date(get(*self._START_ALIASES))
        if not start_date:
            # first_published_date (DD/MM/YYYY) is a reliable fallback
            start_date = self._parse_date(get("first_published_date"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()
        end_date = self._parse_date(get(*self._END_ALIASES)) if status == "resolved" else None
        estimated_resolution = self._parse_date(get(*self._END_ALIASES)) if status != "resolved" else None

        # ── Reason ────────────────────────────────────────────────────────────
        raw_reason = get(*self._REASON_ALIASES)
        reason_category = self._map_reason(raw_reason)

        # ── MAH / manufacturer ────────────────────────────────────────────────
        mah = get(*self._MAH_ALIASES)

        # ── Affected countries ────────────────────────────────────────────────
        raw_countries = get(*self._COUNTRIES_ALIASES)
        if isinstance(rec.get(next((k for a in self._COUNTRIES_ALIASES
                                    for k in [a] if k in rec), None), None), list):
            countries_str = ", ".join(str(c) for c in rec[next(
                k for a in self._COUNTRIES_ALIASES for k in [a] if k in rec)])
        else:
            countries_str = raw_countries

        # ── Severity: EMA shortages are all significant ───────────────────────
        severity = "high" if status == "active" else "low"

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        if mah:
            notes_parts.append(f"MAH: {mah}")
        if countries_str:
            notes_parts.append(f"Affected countries: {countries_str}")
        notes: str | None = "\n".join(notes_parts) or None

        # ── Source URL ────────────────────────────────────────────────────────
        shortage_url = get("shortage_url")
        source_url = shortage_url or (
            "https://www.ema.europa.eu/en/human-regulatory-overview/"
            "post-authorisation/medicine-shortages-availability-issues/"
            "public-information-medicine-shortages"
        )

        return {
            "generic_name":              generic_name,
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
            "raw_record":                dict(rec),
        }

    def _map_reason(self, raw: str) -> str:
        if not raw:
            return "unknown"
        lower = raw.lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return "unknown"

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        if not raw or not str(raw).strip() or str(raw).strip() in ("-", "N/A", ""):
            return None
        try:
            # Handle Excel date serial numbers (openpyxl sometimes returns datetime)
            if isinstance(raw, datetime):
                return raw.date().isoformat()
            dt = dtparser.parse(str(raw).strip())
            return dt.date().isoformat()
        except (ValueError, OverflowError):
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
        print("=" * 60)

        scraper = EMAScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")
        if raw:
            first = raw[0]
            print(f"── Column names: {list(first.keys())[:10]} ...")

        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            from collections import Counter
            print("\n── Status breakdown:")
            for k, v in sorted(Counter(e["status"] for e in events).items()):
                print(f"   {k:25s} {v}")
            print("\n── Severity breakdown:")
            for k, v in sorted(Counter(e.get("severity") for e in events).items()):
                print(f"   {str(k):12s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = EMAScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
