"""
EMA (European Medicines Agency) Shortage Scraper (Railway)
Fetches the EMA ESMP shortage flat-file (JSON preferred, XLSX fallback).

Source JSON: https://www.ema.europa.eu/en/documents/report/shortages-output-json-report_en.json
Source XLSX: https://www.ema.europa.eu/en/documents/report/medicines-output-shortages-report_en.xlsx
"""
from __future__ import annotations

import io
import json
import logging
import re
import requests
from datetime import datetime, date, timezone
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

JSON_URL = (
    "https://www.ema.europa.eu/en/documents/report/"
    "shortages-output-json-report_en.json"
)
XLSX_URL = (
    "https://www.ema.europa.eu/en/documents/report/"
    "medicines-output-shortages-report_en.xlsx"
)
SOURCE_URL = (
    "https://www.ema.europa.eu/en/human-regulatory-overview/"
    "post-authorisation/medicine-shortages-availability-issues/"
    "public-information-medicine-shortages"
)

# ── Column alias maps (first match wins) ────────────────────────────────
INN_ALIASES = [
    "international_non_proprietary_name_inn_or_common_name",
    "inn_or_common_name", "inn", "active_substance",
    "active substance", "inn or common name",
]
STATUS_ALIASES = [
    "supply_shortage_status", "shortage_status", "shortage status", "status",
]
START_ALIASES = [
    "start_of_shortage_date", "shortage_start_date", "shortage start date",
    "start date", "start_date", "first_published_date",
]
END_ALIASES = [
    "expected_resolution_date", "shortage_end_date", "shortage end date",
    "end date", "end_date",
]
REASON_ALIASES = [
    "root_cause_s_of_shortage", "root_cause_of_shortage", "root_cause",
    "reason_for_shortage", "reason for shortage", "shortage_reason",
]

# ── Status / severity maps ──────────────────────────────────────────────
ACTIVE_STATUSES = {"ongoing", "current", "monitoring", ""}
RESOLVED_STATUSES = {"resolved", "closed"}


class EMAShortageScraper(BaseScraper):
    scraper_name = "ema_shortage"
    country      = "EU"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching EMA shortages...")

        raw_records = self._fetch_json() or self._fetch_xlsx()
        if not raw_records:
            log.error("EMA: No records from JSON or XLSX")
            return []

        log.info(f"  EMA raw records: {len(raw_records)}")

        records = []
        for item in raw_records:
            rec = self._process_record(item)
            if rec:
                records.append(rec)

        log.info(f"  Matched {len(records)} records to ingredients")
        return records

    def _fetch_json(self) -> list[dict] | None:
        """Try the JSON flat file first."""
        try:
            r = requests.get(JSON_URL, timeout=60, headers={
                "User-Agent": "Mederti-Scraper/1.0",
            })
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if "json" in ct or r.content[:1] in (b"[", b"{"):
                data = r.json()
                if isinstance(data, list):
                    records = data
                elif isinstance(data, dict):
                    records = (
                        data.get("results") or data.get("data") or
                        data.get("items") or data.get("shortages") or
                        list(data.values())[0] if data else []
                    )
                    if not isinstance(records, list):
                        records = []
                else:
                    records = []
                if records:
                    log.info(f"  EMA JSON: {len(records)} records")
                    return records
        except Exception as e:
            log.info(f"  EMA JSON unavailable ({e}), falling back to XLSX")
        return None

    def _fetch_xlsx(self) -> list[dict]:
        """Download and parse the EMA XLSX shortage file."""
        import openpyxl

        r = requests.get(XLSX_URL, timeout=60, headers={
            "User-Agent": "Mederti-Scraper/1.0",
        })
        r.raise_for_status()

        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            wb.close()
            return []

        headers = [str(h).strip() if h is not None else f"col_{i}"
                   for i, h in enumerate(rows[0])]
        log.info(f"  EMA XLSX columns: {headers[:8]}...")

        records = []
        for row in rows[1:]:
            if not any(v is not None and str(v).strip() for v in row):
                continue
            rec = {}
            for h, v in zip(headers, row):
                rec[h] = v if v is not None else ""
            records.append(rec)

        wb.close()
        log.info(f"  EMA XLSX: {len(records)} records")
        return records

    def _process_record(self, item: dict) -> dict | None:
        """Convert a single EMA record to a drug_availability record."""
        keys_lower = {k.strip().lower(): k for k in item}

        def get(*aliases: str) -> str:
            for alias in aliases:
                if alias in item:
                    v = item[alias]
                    return str(v).strip() if v is not None else ""
                orig = keys_lower.get(alias.lower())
                if orig and item.get(orig) is not None:
                    return str(item[orig]).strip()
            return ""

        # ── Generic name (INN) ───────────────────────────────────────────
        generic_name = get(*INN_ALIASES)
        if not generic_name:
            return None

        # ── Skip resolved ────────────────────────────────────────────────
        raw_status = get(*STATUS_ALIASES).lower()
        if raw_status in RESOLVED_STATUSES:
            return None

        # ── Ingredient lookup ────────────────────────────────────────────
        ingredient_id = self.lookup_ingredient_id(generic_name.lower().strip())
        if not ingredient_id:
            log.debug(f"  No ingredient match for: {generic_name}")
            return None

        # ── Severity ─────────────────────────────────────────────────────
        severity = "high"  # EMA shortages are all centrally-authorised

        # ── Expected resolution ──────────────────────────────────────────
        expected = self._parse_date(get(*END_ALIASES))

        # ── Reason ───────────────────────────────────────────────────────
        reason = get(*REASON_ALIASES) or None

        return {
            "product_id":         None,
            "ingredient_id":      ingredient_id,
            "country":            "EU",
            "status":             "shortage",
            "severity":           severity,
            "shortage_reason":    reason,
            "expected_resolution": expected,
            "source_agency":      "EMA",
            "source_url":         SOURCE_URL,
            "last_verified_at":   self.now_iso(),
        }

    @staticmethod
    def _parse_date(raw) -> str | None:
        """Parse various date formats to ISO-8601."""
        if not raw or not str(raw).strip() or str(raw).strip() in ("-", "N/A", ""):
            return None
        try:
            if isinstance(raw, datetime):
                return raw.date().isoformat()
            # Try common formats
            val = str(raw).strip()
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y", "%B %Y"):
                try:
                    return datetime.strptime(val, fmt).date().isoformat()
                except ValueError:
                    continue
            # Last resort: dateutil
            from dateutil import parser as dtparser
            return dtparser.parse(val).date().isoformat()
        except (ValueError, OverflowError):
            return None
