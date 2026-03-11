"""
CDSCO India Not-of-Standard-Quality Drug Alerts Scraper (UPSTREAM SIGNAL)
--------------------------------------------------------------------------
Source:  CDSCO — Not of Standard Quality Drug Alerts
URL:     https://cdsco.gov.in/opencms/opencms/en/Notifications/nsq-drugs/

The Central Drugs Standard Control Organisation (CDSCO) publishes monthly
reports listing drugs found to be "Not of Standard Quality" (NSQ). These
reports are typically PDF files containing batch-level test results.

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
    BASE_URL: str     = "https://cdsco.gov.in/opencms/opencms/en/Notifications/nsq-drugs/"
    COUNTRY: str      = "India"
    COUNTRY_CODE: str = "IN"

    RATE_LIMIT_DELAY: float = 3.0   # Be polite to Indian gov servers
    REQUEST_TIMEOUT: float  = 90.0  # PDFs can be large and slow
    SCRAPER_VERSION: str    = "1.0.0"

    # Patterns for extracting drug information from PDF text
    _DRUG_LINE_PATTERN = re.compile(
        r'(\d+)\.\s+'          # Serial number
        r'(.+?)\s+'            # Drug name
        r'B\.?\s*No\.?\s*[:.]?\s*'  # Batch number prefix
        r'([A-Z0-9\-/]+)',     # Batch number
        re.IGNORECASE,
    )

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch CDSCO NSQ drug data.

        Strategy:
        1. GET the NSQ drugs notification page.
        2. Parse HTML for links to monthly PDF reports.
        3. Download the most recent PDF(s).
        4. Extract text from PDFs using pdfplumber.
        5. Return raw records extracted from PDF text.
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        resp = self._get(self.BASE_URL)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Find PDF links on the page
        pdf_links = self._find_pdf_links(soup)
        self.log.info(
            "Found PDF links on page",
            extra={"count": len(pdf_links)},
        )

        if not pdf_links:
            self.log.warning("No PDF links found on CDSCO NSQ page")
            return []

        # Download and parse the most recent PDFs (limit to latest 3)
        records: list[dict] = []
        for pdf_info in pdf_links[:3]:
            try:
                pdf_records = self._fetch_and_parse_pdf(pdf_info)
                records.extend(pdf_records)
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch/parse PDF",
                    extra={
                        "url": pdf_info.get("url", ""),
                        "error": str(exc),
                    },
                )

        self.log.info(
            "CDSCO fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _find_pdf_links(self, soup) -> list[dict]:
        """Find links to monthly NSQ PDF reports on the page."""
        pdf_links: list[dict] = []
        seen_urls: set[str] = set()

        for link in soup.select("a[href]"):
            href = link.get("href", "")

            # Look for PDF links
            if not href.lower().endswith(".pdf"):
                continue

            # Normalise URL
            if href.startswith("/"):
                href = f"https://cdsco.gov.in{href}"
            elif not href.startswith("http"):
                href = f"https://cdsco.gov.in/opencms/opencms/en/Notifications/nsq-drugs/{href}"

            if href in seen_urls:
                continue
            seen_urls.add(href)

            title = link.get_text(strip=True)

            # Try to extract month/year from the title or URL
            month_year = self._extract_month_year(title) or self._extract_month_year(href)

            pdf_links.append({
                "url": href,
                "title": title,
                "month_year": month_year,
            })

        # Sort by most recent first if we can determine dates
        pdf_links.sort(
            key=lambda x: x.get("month_year") or "",
            reverse=True,
        )

        return pdf_links

    def _extract_month_year(self, text: str) -> str | None:
        """Extract month/year reference from text like 'January 2026' or 'Jan-2026'."""
        months = {
            "january": "01", "february": "02", "march": "03", "april": "04",
            "may": "05", "june": "06", "july": "07", "august": "08",
            "september": "09", "october": "10", "november": "11", "december": "12",
            "jan": "01", "feb": "02", "mar": "03", "apr": "04",
            "jun": "06", "jul": "07", "aug": "08",
            "sep": "09", "oct": "10", "nov": "11", "dec": "12",
        }
        text_lower = text.lower()
        for month_name, month_num in months.items():
            if month_name in text_lower:
                # Find a 4-digit year near the month name
                year_match = re.search(r'(20\d{2})', text)
                if year_match:
                    return f"{year_match.group(1)}-{month_num}"
        return None

    def _fetch_and_parse_pdf(self, pdf_info: dict) -> list[dict]:
        """Download a PDF and extract drug records from it."""
        try:
            import pdfplumber
        except ImportError:
            self.log.error(
                "pdfplumber not installed — required for CDSCO PDF parsing. "
                "Install with: pip install pdfplumber"
            )
            return []

        import io

        url = pdf_info["url"]
        self.log.info("Downloading PDF", extra={"url": url})

        resp = self._get(url)

        records: list[dict] = []
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            self.log.info(
                "PDF opened",
                extra={"pages": len(pdf.pages), "url": url},
            )

            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    # Try table extraction first (CDSCO PDFs are often tabular)
                    tables = page.extract_tables()
                    if tables:
                        for table in tables:
                            page_records = self._parse_table(
                                table, pdf_info, page_num
                            )
                            records.extend(page_records)
                    else:
                        # Fall back to text extraction
                        text = page.extract_text()
                        if text:
                            page_records = self._parse_text(
                                text, pdf_info, page_num
                            )
                            records.extend(page_records)
                except Exception as exc:
                    self.log.warning(
                        "Failed to parse PDF page",
                        extra={
                            "url": url,
                            "page": page_num,
                            "error": str(exc),
                        },
                    )

        self.log.info(
            "PDF parsing complete",
            extra={"url": url, "records": len(records)},
        )
        return records

    def _parse_table(self, table: list[list], pdf_info: dict, page_num: int) -> list[dict]:
        """Parse a table extracted from a PDF page."""
        records: list[dict] = []

        if not table or len(table) < 2:
            return records

        # First row is typically headers
        headers = [str(cell or "").strip().lower() for cell in table[0]]

        # Try to identify key columns
        name_col = self._find_column(headers, ["name of drug", "drug name", "name", "product"])
        batch_col = self._find_column(headers, ["batch no", "b.no", "batch", "lot"])
        mfr_col = self._find_column(headers, ["manufacturer", "mfr", "firm", "company"])
        reason_col = self._find_column(headers, ["reason", "nsq reason", "not of standard quality", "result"])

        for row in table[1:]:
            if not row or all(cell is None or str(cell).strip() == "" for cell in row):
                continue

            drug_name = ""
            if name_col is not None and name_col < len(row):
                drug_name = str(row[name_col] or "").strip()

            # If we can't find a name column, try the second column (common layout)
            if not drug_name and len(row) > 1:
                drug_name = str(row[1] or "").strip()

            if not drug_name or len(drug_name) < 3:
                continue

            batch_no = ""
            if batch_col is not None and batch_col < len(row):
                batch_no = str(row[batch_col] or "").strip()

            manufacturer = ""
            if mfr_col is not None and mfr_col < len(row):
                manufacturer = str(row[mfr_col] or "").strip()

            reason = ""
            if reason_col is not None and reason_col < len(row):
                reason = str(row[reason_col] or "").strip()

            records.append({
                "drug_name": drug_name,
                "batch_no": batch_no,
                "manufacturer": manufacturer,
                "reason": reason,
                "pdf_url": pdf_info["url"],
                "pdf_title": pdf_info.get("title", ""),
                "month_year": pdf_info.get("month_year", ""),
                "page_num": page_num,
                "source": "table",
            })

        return records

    @staticmethod
    def _find_column(headers: list[str], candidates: list[str]) -> int | None:
        """Find the index of a column matching any of the candidate strings."""
        for idx, header in enumerate(headers):
            for candidate in candidates:
                if candidate in header:
                    return idx
        return None

    def _parse_text(self, text: str, pdf_info: dict, page_num: int) -> list[dict]:
        """Parse free text from a PDF page to extract drug records."""
        records: list[dict] = []

        for line in text.split("\n"):
            line = line.strip()
            if not line or len(line) < 10:
                continue

            # Try structured pattern: serial number, drug name, batch number
            match = self._DRUG_LINE_PATTERN.search(line)
            if match:
                drug_name = match.group(2).strip()
                batch_no = match.group(3).strip()

                # Clean up drug name (remove trailing batch info)
                drug_name = re.sub(r'\s+B\.?\s*No\.?.*$', '', drug_name, flags=re.IGNORECASE).strip()

                if drug_name and len(drug_name) >= 3:
                    records.append({
                        "drug_name": drug_name,
                        "batch_no": batch_no,
                        "manufacturer": "",
                        "reason": "Not of Standard Quality",
                        "pdf_url": pdf_info["url"],
                        "pdf_title": pdf_info.get("title", ""),
                        "month_year": pdf_info.get("month_year", ""),
                        "page_num": page_num,
                        "source": "text",
                    })

        return records

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
