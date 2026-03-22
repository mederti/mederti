"""
Greece EOF National Organisation for Medicines — Drug Shortages Scraper
───────────────────────────────────────────────────────────────────────
Source:  EOF — Ethnikos Organismos Farmakon (National Organisation for Medicines)
URL:     https://www.eof.gr/eparkeia-agoras/

EOF publishes a PDF listing pharmaceutical products with limited availability.
The PDF is updated periodically and contains a table with columns:
    Barcode | Περιγραφή | ATC | Δραστική ουσία | Τρόπος Διάθεσης |
    Κάτοχος άδειας | Ημ. έναρξης | Ημ. λήξης | Αιτία | Εναλλακτικές

This scraper:
  1. GETs the shortage landing page at /eparkeia-agoras/
  2. Finds the PDF link containing ΛΙΣΤΑ-ΦΑΡΜΑΚΕΥΤΙΚΩΝ-ΣΚΕΥΑΣΜΑΤΩΝ-ΠΕΡΙΟΡΙΣΜΕΝΗΣ-ΔΙΑΘΕΣΙΜΟΤΗΤΑΣ
  3. Downloads and parses the PDF with pdfplumber
  4. Returns structured records

Key Greek terms:
    έλλειψη / elleipsi      = shortage           → status: active
    ανάκληση / anaklisi      = recall             → status: active
    αναστολή / anastoli      = suspension         → status: active
    διαθέσιμο / diathesimo   = available          → status: resolved
    αναμένεται / anamenete   = expected/pending   → status: anticipated
    φάρμακο / farmako        = drug/medicine
    δραστική ουσία           = active substance (INN)
    εμπορική ονομασία        = trade name

Data source UUID:  10000000-0000-0000-0000-000000000050
Country:           Greece
Country code:      GR
Confidence:        82/100 (official national regulator)

Cron:  Every 24 hours (EOF updates infrequently)
"""

from __future__ import annotations

import io
import re
import urllib.parse
from datetime import date, datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class GreeceEOFScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000050"
    SOURCE_NAME: str  = "National Organisation for Medicines — Drug Shortages"
    BASE_URL: str     = "https://www.eof.gr/eparkeia-agoras/"
    COUNTRY: str      = "Greece"
    COUNTRY_CODE: str = "GR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0   # PDF can be large
    SCRAPER_VERSION: str    = "2.0.0"

    # PDF link pattern — the shortage list PDF
    _SHORTAGE_PDF_PATTERN: str = (
        "ΛΙΣΤΑ-ΦΑΡΜΑΚΕΥΤΙΚΩΝ-ΣΚΕΥΑΣΜΑΤΩΝ-ΠΕΡΙΟΡΙΣΜΕΝΗΣ-ΔΙΑΘΕΣΙΜΟΤΗΤΑΣ"
    )

    # Canonical column keys used internally
    _COL_BARCODE      = "barcode"
    _COL_DESCRIPTION  = "description"
    _COL_ATC          = "atc"
    _COL_SUBSTANCE    = "substance"
    _COL_DISPENSING   = "dispensing"
    _COL_MAH          = "mah"
    _COL_START_DATE   = "start_date"
    _COL_END_DATE     = "end_date"
    _COL_REASON       = "reason"
    _COL_ALTERNATIVES = "alternatives"

    # Map raw header substrings to canonical column names
    _HEADER_MAP: dict[str, str] = {
        "barcode":      _COL_BARCODE,
        "περιγραφή":    _COL_DESCRIPTION,
        "περιγραφη":    _COL_DESCRIPTION,
        "atc":          _COL_ATC,
        "δραστική":     _COL_SUBSTANCE,
        "δραστικη":     _COL_SUBSTANCE,
        "τρόπος":       _COL_DISPENSING,
        "τροπος":       _COL_DISPENSING,
        "κάτοχος":      _COL_MAH,
        "κατοχος":      _COL_MAH,
        "έναρξη":       _COL_START_DATE,
        "εναρξη":       _COL_START_DATE,
        "λήξη":         _COL_END_DATE,
        "ληξη":         _COL_END_DATE,
        "αιτία":        _COL_REASON,
        "αιτια":        _COL_REASON,
        "εναλλακτικ":   _COL_ALTERNATIVES,
    }

    # Greek reason keywords → canonical reason_category
    _REASON_MAP: dict[str, str] = {
        "παραγωγ":                 "manufacturing_issue",
        "κατασκευ":                "manufacturing_issue",
        "ποιοτικ":                 "manufacturing_issue",
        "ποιότητ":                 "manufacturing_issue",
        "πρώτη ύλη":               "raw_material",
        "πρωτη υλη":               "raw_material",
        "δραστική ουσία":          "raw_material",
        "δραστικη ουσια":          "raw_material",
        "ζήτηση":                  "demand_surge",
        "ζητηση":                  "demand_surge",
        "αυξημέν":                 "demand_surge",
        "αυξημεν":                 "demand_surge",
        "εφοδιαστικ":              "supply_chain",
        "παγκόσμι":                "supply_chain",
        "παγκοσμι":                "supply_chain",
        "εισαγωγ":                 "distribution",
        "διανομ":                  "distribution",
        "καθυστέρηση":             "supply_chain",
        "καθυστερηση":             "supply_chain",
        "απόσυρση":                "discontinuation",
        "αποσυρση":                "discontinuation",
        "διακοπή":                 "discontinuation",
        "διακοπη":                 "discontinuation",
        "ρυθμιστικ":               "regulatory_action",
        "κανονιστικ":              "regulatory_action",
        "ανάκληση":                "regulatory_action",
        "ανακληση":                "regulatory_action",
        "εμπορικ":                 "commercial",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the EOF shortage PDF:
        1. GET the landing page at /eparkeia-agoras/
        2. Find the shortage list PDF link
        3. Download and parse the PDF with pdfplumber
        4. Return rows as list[dict]
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        # Step 1: Get the landing page
        try:
            resp = self._get(self.BASE_URL)
        except Exception as exc:
            raise ScraperError(f"Failed to fetch EOF landing page: {exc}") from exc

        soup = BeautifulSoup(resp.text, "html.parser")

        # Step 2: Find the shortage PDF link
        pdf_url = self._find_shortage_pdf_link(soup)
        if not pdf_url:
            raise ScraperError(
                "Could not find shortage PDF link on EOF page. "
                f"Pattern: {self._SHORTAGE_PDF_PATTERN}"
            )

        self.log.info("Found shortage PDF link", extra={"pdf_url": pdf_url[:120]})

        # Step 3: Download and parse the PDF
        records = self._download_and_parse_pdf(pdf_url)

        self.log.info(
            "EOF fetch complete",
            extra={"total_records": len(records), "pdf_url": pdf_url[:120]},
        )
        return records

    def _find_shortage_pdf_link(self, soup: BeautifulSoup) -> str | None:
        """Find the shortage list PDF URL from the landing page."""
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Check both the raw href and URL-decoded version
            decoded = urllib.parse.unquote(href)
            if (self._SHORTAGE_PDF_PATTERN in decoded
                    or self._SHORTAGE_PDF_PATTERN in href):
                if href.startswith("/"):
                    return f"https://www.eof.gr{href}"
                if href.startswith("http"):
                    return href
                return f"https://www.eof.gr/{href}"
        return None

    def _download_and_parse_pdf(self, pdf_url: str) -> list[dict]:
        """Download a PDF and extract table rows using pdfplumber."""
        try:
            import pdfplumber
        except ImportError:
            raise ScraperError(
                "pdfplumber is required for the Greece EOF scraper. "
                "Install it with: pip install pdfplumber"
            )

        try:
            resp = self._get(pdf_url)
        except Exception as exc:
            raise ScraperError(f"Failed to download PDF: {exc}") from exc

        self.log.info("PDF downloaded", extra={"bytes": len(resp.content)})

        records: list[dict] = []
        col_names: list[str] | None = None

        try:
            pdf = pdfplumber.open(io.BytesIO(resp.content))
        except Exception as exc:
            raise ScraperError(f"Failed to open PDF: {exc}") from exc

        try:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                if not tables:
                    continue

                for table in tables:
                    for row_idx, row in enumerate(table):
                        if not row or all(cell is None for cell in row):
                            continue

                        # Clean cells: collapse whitespace, strip
                        cleaned = [
                            re.sub(r'\s+', ' ', (cell or "").strip())
                            for cell in row
                        ]

                        # Detect header row (contains "Barcode")
                        if any("Barcode" in c for c in cleaned if c):
                            col_names = self._map_headers(cleaned)
                            continue

                        # Skip title rows (only first cell has content)
                        if sum(1 for c in cleaned if c) <= 1:
                            continue

                        # Skip rows before we have identified the headers
                        if col_names is None:
                            continue

                        # Build record dict
                        rec: dict[str, str] = {"_source_url": pdf_url}
                        for i, cell in enumerate(cleaned):
                            if i < len(col_names):
                                rec[col_names[i]] = cell
                            else:
                                rec[f"col_{i}"] = cell

                        # Only keep rows that have a substance or description
                        if (rec.get(self._COL_SUBSTANCE)
                                or rec.get(self._COL_DESCRIPTION)):
                            records.append(rec)

            self.log.info(
                "PDF parsed",
                extra={
                    "pages": len(pdf.pages),
                    "records": len(records),
                    "columns": col_names,
                },
            )
        finally:
            pdf.close()

        return records

    def _map_headers(self, raw_headers: list[str]) -> list[str]:
        """Map raw PDF header text to canonical column names."""
        mapped: list[str] = []
        for h in raw_headers:
            h_lower = h.lower()
            found = False
            for key, col_name in self._HEADER_MAP.items():
                if key in h_lower:
                    mapped.append(col_name)
                    found = True
                    break
            if not found:
                safe = re.sub(r'[^a-z0-9_]', '_', h_lower)[:30] if h else f"col_{len(mapped)}"
                mapped.append(safe)
        return mapped

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize EOF PDF records into standard shortage event dicts."""
        self.log.info(
            "Normalising EOF records",
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
                    "Failed to normalise EOF record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single EOF PDF record to a normalised shortage event dict."""
        source_url = rec.pop("_source_url", self.BASE_URL)

        # -- Drug name: use active substance (INN) --
        generic_name = (rec.get(self._COL_SUBSTANCE) or "").strip()
        if not generic_name:
            return None

        # -- Brand / trade name from product description --
        description = (rec.get(self._COL_DESCRIPTION) or "").strip()
        brand_name = ""
        if description:
            # Extract brand name: first word(s) before dosage form abbreviation
            # e.g. "CYTOTEC TABLET 200MCG/TAB BTX42" → "CYTOTEC"
            m = re.match(
                r'^([A-Z][A-Z0-9/\- ]*?)(?:\s+(?:TABLET|TAB|CAP|GR\.CAP|F\.C\.TAB|'
                r'CON\.R\.TAB|SOL|INJ|SUSP|CR\.TAB|MOD\.R\.TAB|EY\.DRO|OR\.SOL|'
                r'C\.TAB|AMP|VIAL|CREAM|OINT|PATCH|SPRAY|INHALER|PD\.SOL|'
                r'SOL\.INF|SOL\.INJ|SOL\.PER|LYO|PREFILLED|SUPP|SYR|'
                r'NASPR|EF\.TAB|PS\.INJ|XR\.TAB|PR\.TAB|M\.R\.TAB|'
                r'EAR|OPH|ORAL|RECT|VAG|TOPICAL|NASAL|CUT|PD|'
                r'\d+\s*MG|\d+\s*MCG|\d+\s*G/|\d+\s*ML|BT))',
                description,
                re.IGNORECASE,
            )
            if m:
                brand_name = m.group(1).strip()
            else:
                parts = description.split()
                if parts:
                    brand_name = parts[0]

        brand_names = (
            [brand_name]
            if brand_name and brand_name.upper() != generic_name.upper()
            else []
        )

        # -- ATC code --
        atc_code = (rec.get(self._COL_ATC) or "").strip()

        # -- Shortage reason --
        raw_reason = (rec.get(self._COL_REASON) or "").strip()
        reason_category = self._map_reason(raw_reason)

        # -- Dates --
        raw_start = rec.get(self._COL_START_DATE)
        start_date = self._parse_date(raw_start) or today

        raw_end = rec.get(self._COL_END_DATE)
        end_date = self._parse_date(raw_end)

        # -- Status: resolved if end_date is in the past --
        status = "active"
        if end_date:
            try:
                end_dt = date.fromisoformat(end_date)
                if end_dt < date.today():
                    status = "resolved"
            except ValueError:
                pass

        # -- Marketing authorization holder --
        mah = (rec.get(self._COL_MAH) or "").strip()

        # -- Dispensing type --
        dispensing = (rec.get(self._COL_DISPENSING) or "").strip()

        # -- Alternatives --
        alternatives = (rec.get(self._COL_ALTERNATIVES) or "").strip()

        # -- Barcode --
        barcode = (rec.get(self._COL_BARCODE) or "").strip()

        # -- Build notes --
        notes_parts: list[str] = []
        if description:
            notes_parts.append(f"Product: {description}")
        if atc_code:
            notes_parts.append(f"ATC: {atc_code}")
        if mah:
            notes_parts.append(f"MAH: {mah}")
        if dispensing:
            notes_parts.append(f"Dispensing: {dispensing}")
        if raw_reason:
            notes_parts.append(f"Reason (GR): {raw_reason}")
        if alternatives:
            notes_parts.append(f"Alternatives: {alternatives}")
        if barcode:
            notes_parts.append(f"Barcode: {barcode}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "medium",
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "source_url":                source_url,
            "notes":                     notes,
            "source_confidence_score":   82,
            "raw_record":                rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map Greek reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
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

        # Try Greek/European date formats: DD/MM/YY, DD/MM/YYYY, DD.MM.YYYY
        for pattern, fmt in [
            (r"^\d{2}/\d{2}/\d{2}$",   "%d/%m/%y"),
            (r"^\d{2}/\d{2}/\d{4}$",   "%d/%m/%Y"),
            (r"^\d{2}\.\d{2}\.\d{4}$", "%d.%m.%Y"),
            (r"^\d{2}-\d{2}-\d{4}$",   "%d-%m-%Y"),
            (r"^\d{4}-\d{2}-\d{2}$",   "%Y-%m-%d"),
        ]:
            if re.match(pattern, raw_str):
                try:
                    return datetime.strptime(raw_str, fmt).date().isoformat()
                except ValueError:
                    pass

        # Fallback to dateutil
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str, dayfirst=True)
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
        print("Fetches live EOF Greece data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = GreeceEOFScraper(db_client=MagicMock())

        print("\n-- Fetching from EOF Greece ...")
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

            # Show sample drug names
            print("\n-- Sample drug names (first 10):")
            for e in events[:10]:
                brand = e["brand_names"][0] if e["brand_names"] else "-"
                print(f"   {e['generic_name']:30s} [{brand}] ({e['status']}) start={e['start_date']}")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = GreeceEOFScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
