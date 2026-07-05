"""
CDSCO India Not-of-Standard-Quality Drug Alerts Scraper (UPSTREAM SIGNAL)
--------------------------------------------------------------------------
Source:  CDSCO — Not of Standard Quality Drug Alerts
Portal:  https://cdscoonline.gov.in/CDSCO/viewPublicNSQDrug
Data:    https://cdscoonline.gov.in/CDSCO/publicNsqDrugTable  (DataTables JSON, no auth)

The Central Drugs Standard Control Organisation (CDSCO) publishes monthly
reports listing drugs found to be "Not of Standard Quality" (NSQ), i.e.
batch-level test failures. The old opencms Notifications page is now a JS
shell with no server-rendered links; the live data is served as JSON from
the cdscoonline portal (see `fetch()`).

This is an UPSTREAM SIGNAL scraper: NSQ findings in India often precede
formal shortage events in downstream markets because Indian manufacturers
supply a large share of global generic drug production. A drug failing
quality testing may lead to batch recalls, production halts, or supply
disruptions internationally.

Data source UUID:  10000000-0000-0000-0000-000000000052
Country:           India
Country code:      IN
Confidence:        75/100 (official government lab results)
Source tier:       3 (upstream signal, not a direct shortage declaration)

Cron:  Every 24 hours (monthly PDF release, but we check daily)
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class IndiaCDSCOScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000052"
    SOURCE_NAME: str  = "CDSCO — Not of Standard Quality Drug Alerts"
    # The opencms Notifications page is now a JS shell that server-renders no
    # PDF links. The real data lives on a separate portal behind a DataTables
    # JSON endpoint (no auth/cookie). BASE_URL is kept for reference/source_url.
    BASE_URL: str     = "https://cdsco.gov.in/opencms/opencms/en/Notifications/nsq-drugs/"
    DATA_URL: str     = "https://cdscoonline.gov.in/CDSCO/publicNsqDrugTable"
    SOURCE_PAGE: str  = "https://cdscoonline.gov.in/CDSCO/viewPublicNSQDrug"
    COUNTRY: str      = "India"
    COUNTRY_CODE: str = "IN"

    RATE_LIMIT_DELAY: float = 3.0   # Be polite to Indian gov servers
    REQUEST_TIMEOUT: float  = 90.0  # PDFs can be large and slow
    SCRAPER_VERSION: str    = "2.0.0"

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch CDSCO NSQ drug data from the cdscoonline DataTables JSON endpoint.

        The opencms Notifications page (BASE_URL) is now a JS shell that
        server-renders no PDF links, so it always returned 0 records. The real
        data lives on a separate portal, cdscoonline.gov.in, behind a
        DataTables JSON endpoint (DATA_URL) that needs no auth or cookie.

        Fields per row: str_product_name, str_batch_no, str_manufactured_by,
        str_nsq_result, dt_reporting_month_year (e.g. "APR-2026").
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.DATA_URL,
        })

        payload = self._get_json(self.DATA_URL)

        # DataTables responses vary: {"data": [...]}, {"aaData": [...]}, or a bare list.
        if isinstance(payload, dict):
            rows = payload.get("data") or payload.get("aaData") or []
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []

        self.log.info("CDSCO rows received", extra={"count": len(rows)})

        records: list[dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue

            drug_name = str(row.get("str_product_name") or "").strip()
            if not drug_name:
                continue

            raw_month = str(row.get("dt_reporting_month_year") or "").strip()  # e.g. "APR-2026"

            records.append({
                "drug_name":    drug_name,
                "batch_no":     str(row.get("str_batch_no") or "").strip(),
                "manufacturer": str(row.get("str_manufactured_by") or "").strip(),
                "reason":       str(row.get("str_nsq_result") or "").strip(),
                "pdf_url":      self.SOURCE_PAGE,
                "pdf_title":    (f"NSQ Drug Alerts {raw_month}").strip(),
                "month_year":   self._convert_month_year(raw_month),
                "page_num":     None,
                "source":       "json",
            })

        self.log.info(
            "CDSCO fetch complete",
            extra={"records": len(records)},
        )
        return records

    @staticmethod
    def _convert_month_year(raw: str | None) -> str | None:
        """Convert a CDSCO reporting month like 'APR-2026' to 'YYYY-MM'."""
        if not raw:
            return None
        months = {
            "jan": "01", "feb": "02", "mar": "03", "apr": "04",
            "may": "05", "jun": "06", "jul": "07", "aug": "08",
            "sep": "09", "oct": "10", "nov": "11", "dec": "12",
        }
        m = re.match(r'^([A-Za-z]{3,})[-\s]+(\d{4})$', raw.strip())
        if not m:
            return None
        month_num = months.get(m.group(1)[:3].lower())
        if not month_num:
            return None
        return f"{m.group(2)}-{month_num}"

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize CDSCO records into standard shortage event dicts."""
        self.log.info(
            "Normalising CDSCO records",
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
                    "Failed to normalise CDSCO record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single CDSCO record to a normalised shortage event dict."""
        drug_name = str(rec.get("drug_name") or "").strip()
        if not drug_name:
            return None

        # Clean drug name: remove dosage forms and strengths for generic matching
        generic_name = self._clean_drug_name(drug_name)
        if not generic_name:
            return None

        # Build reason
        raw_reason = str(rec.get("reason") or "Not of Standard Quality").strip()
        reason_category = map_reason_category(raw_reason)
        # NSQ findings are manufacturing/quality issues by default
        if reason_category == "unknown":
            reason_category = "manufacturing_issue"

        # Parse start date from month_year or use today
        start_date = self._parse_month_year_date(rec.get("month_year")) or today

        # Build notes
        notes_parts: list[str] = []
        batch_no = str(rec.get("batch_no") or "").strip()
        if batch_no:
            notes_parts.append(f"Batch: {batch_no}")
        manufacturer = str(rec.get("manufacturer") or "").strip()
        if manufacturer:
            notes_parts.append(f"Manufacturer: {manufacturer}")
        pdf_title = str(rec.get("pdf_title") or "").strip()
        if pdf_title:
            notes_parts.append(f"Report: {pdf_title}")
        if raw_reason and raw_reason != "Not of Standard Quality":
            notes_parts.append(f"NSQ reason: {raw_reason}")
        notes = "; ".join(notes_parts) or None

        source_url = rec.get("pdf_url") or self.BASE_URL

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             [],
            "status":                  "active",
            "severity":                "medium",
            "reason":                  raw_reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 75,
            "raw_record":              rec,
            # Upstream signal fields
            "is_upstream_signal":      True,
            "source_tier":             3,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _clean_drug_name(name: str) -> str:
        """
        Clean a drug name from CDSCO NSQ reports.

        Examples:
            "Amoxicillin Capsules IP 500mg" -> "Amoxicillin"
            "Metformin Hydrochloride Tablets IP 500 mg" -> "Metformin Hydrochloride"
            "Paracetamol IP B.No. XYZ123" -> "Paracetamol"
        """
        if not name:
            return name

        # Remove batch numbers and everything after
        name = re.sub(r'\s+B\.?\s*No\.?.*$', '', name, flags=re.IGNORECASE).strip()

        # Remove dosage forms and strengths
        name = re.split(
            r'\s+(?:Tablets?|Capsules?|Injection|Solution|Suspension|Syrup|'
            r'Cream|Ointment|Drops?|Inhaler|Powder|Gel|Eye|Ear|Nasal|'
            r'I\.?P\.?|B\.?P\.?|U\.?S\.?P\.?)\b',
            name,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip()

        # Remove trailing strength patterns
        name = re.sub(
            r'\s+\d+[\.,]?\d*\s*(?:mg|g|ml|mcg|iu|%|µg|mcg/ml|mg/ml).*$',
            '',
            name,
            flags=re.IGNORECASE,
        ).strip()

        return name.strip() if len(name.strip()) >= 3 else ""

    @staticmethod
    def _parse_month_year_date(month_year: str | None) -> str | None:
        """Convert a 'YYYY-MM' string to the first day of that month as ISO date."""
        if not month_year:
            return None
        match = re.match(r'^(\d{4})-(\d{2})$', month_year)
        if match:
            return f"{match.group(1)}-{match.group(2)}-01"
        return None

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass
        return None


# -------------------------------------------------------------------------
# Standalone entrypoint
# -------------------------------------------------------------------------

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
        print("Fetches live CDSCO data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = IndiaCDSCOScraper(db_client=MagicMock())

        print("\n-- Fetching from CDSCO ...")
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

            # Show upstream signal fields
            upstream_count = sum(1 for e in events if e.get("is_upstream_signal"))
            print(f"\n-- Upstream signals: {upstream_count}/{len(events)}")
            tier_counts = Counter(e.get("source_tier") for e in events)
            print("-- Source tier breakdown:")
            for k, v in sorted(tier_counts.items()):
                print(f"   Tier {k}: {v}")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = IndiaCDSCOScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
