"""
Israel Ministry of Health Drug Shortage Scraper
-------------------------------------------------
Source:  Israel Ministry of Health - Drug Registry
URL:     https://israeldrugs.health.gov.il/

The Israel MOH publishes drug shortage and availability information through
its drug registry portal. The site exposes a web API that returns JSON data
about drug shortages, supply problems, and availability updates.

This scraper attempts to use the site's REST API endpoints. If the API is
not available or has changed, it falls back to scraping the HTML pages for
shortage notices.

Data source UUID:  10000000-0000-0000-0000-000000000046
Country:           Israel
Country code:      IL
Confidence:        82/100 (official government drug registry)

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urljoin

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class IsraelMOHScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000046"
    SOURCE_NAME: str  = "Israel Ministry of Health — Drug Registry"
    BASE_URL: str     = "https://israeldrugs.health.gov.il/"
    COUNTRY: str      = "Israel"
    COUNTRY_CODE: str = "IL"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0  # Israeli gov sites can be slow
    SCRAPER_VERSION: str    = "1.0.0"

    # Known API endpoint patterns for the Israel drug registry
    API_ENDPOINTS: list[str] = [
        "https://israeldrugs.health.gov.il/GovServiceList.svc/GetShortages",
        "https://israeldrugs.health.gov.il/GovServiceList.svc/GetDrugShortageList",
        "https://israeldrugs.health.gov.il/GovServiceList.svc/GetDrugList",
        "https://israeldrugs.health.gov.il/api/shortages",
        "https://israeldrugs.health.gov.il/api/drugs/shortages",
        "https://israeldrugs.health.gov.il/api/drug-shortage",
    ]

    # Fallback HTML pages to scrape
    HTML_PAGES: list[str] = [
        "https://israeldrugs.health.gov.il/#!/drugShortage",
        "https://israeldrugs.health.gov.il/#!/allDrugShortage",
        "https://www.health.gov.il/English/Topics/Pharmaceuticals/drug_shortages/Pages/default.aspx",
    ]

    # Reason keyword mapping specific to Israel MOH
    _REASON_MAP: dict[str, str] = {
        "manufacturing":        "manufacturing_issue",
        "production":           "manufacturing_issue",
        "quality":              "manufacturing_issue",
        "gmp":                  "manufacturing_issue",
        "supply":               "supply_chain",
        "supply chain":         "supply_chain",
        "global shortage":      "supply_chain",
        "logistics":            "supply_chain",
        "import":               "distribution",
        "distribution":         "distribution",
        "demand":               "demand_surge",
        "discontinu":           "discontinuation",
        "withdraw":             "discontinuation",
        "cancel":               "discontinuation",
        "regulatory":           "regulatory_action",
        "raw material":         "raw_material",
        "active ingredient":    "raw_material",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch drug shortage data from the Israel MOH drug registry.

        Strategy:
        1. Try known REST API endpoints (JSON responses).
        2. Fall back to HTML page scraping if no API works.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        # Primary: Try API endpoints
        for endpoint in self.API_ENDPOINTS:
            try:
                records = self._fetch_api(endpoint)
                if records:
                    self.log.info(
                        "API endpoint successful",
                        extra={"endpoint": endpoint, "records": len(records)},
                    )
                    return records
            except Exception as exc:
                self.log.debug(
                    "API endpoint failed",
                    extra={"endpoint": endpoint, "error": str(exc)},
                )

        self.log.info("All API endpoints failed, falling back to HTML scraping")

        # Fallback: HTML page scraping
        records: list[dict] = []
        for page_url in self.HTML_PAGES:
            try:
                page_records = self._fetch_html(page_url)
                records.extend(page_records)
                if page_records:
                    self.log.info(
                        "HTML page fetch successful",
                        extra={"url": page_url, "records": len(page_records)},
                    )
            except Exception as exc:
                self.log.warning(
                    "HTML page fetch failed",
                    extra={"url": page_url, "error": str(exc)},
                )

        # Last resort: try the main page
        if not records:
            try:
                records = self._fetch_main_page()
            except Exception as exc:
                self.log.warning(
                    "Main page fetch failed",
                    extra={"url": self.BASE_URL, "error": str(exc)},
                )

        self.log.info(
            "Israel MOH fetch complete",
            extra={"total_records": len(records)},
        )
        return records

    def _fetch_api(self, endpoint: str) -> list[dict]:
        """
        Attempt to fetch shortage data from a JSON API endpoint.
        Returns a list of raw record dicts if successful.
        """
        self.log.debug("Trying API endpoint", extra={"url": endpoint})

        # Try GET first
        try:
            data = self._get_json(endpoint)
            return self._extract_api_records(data, endpoint)
        except Exception:
            pass

        # Some endpoints may need query parameters
        params_variants = [
            {"status": "shortage"},
            {"type": "shortage"},
            {"category": "shortage"},
            {"pageSize": "1000", "page": "1"},
        ]

        for params in params_variants:
            try:
                data = self._get_json(endpoint, params=params)
                records = self._extract_api_records(data, endpoint)
                if records:
                    return records
            except Exception:
                continue

        return []

    def _extract_api_records(self, data: Any, endpoint: str) -> list[dict]:
        """Extract records from various API response formats."""
        records: list[dict] = []

        if isinstance(data, list):
            # Direct array response
            for item in data:
                if isinstance(item, dict):
                    item["_api_endpoint"] = endpoint
                    records.append(item)

        elif isinstance(data, dict):
            # Look for common response wrapper keys
            for key in ("results", "data", "items", "rows", "drugs", "shortages",
                        "DrugShortageList", "GetDrugShortageListResult",
                        "GetShortagesResult", "d"):
                if key in data and isinstance(data[key], list):
                    for item in data[key]:
                        if isinstance(item, dict):
                            item["_api_endpoint"] = endpoint
                            records.append(item)
                    break
            else:
                # Check if the dict itself is a single record
                if any(k.lower() in str(data.keys()).lower()
                       for k in ["drug", "name", "shortage", "inn"]):
                    data["_api_endpoint"] = endpoint
                    records.append(data)

            # Handle pagination
            total_pages = data.get("totalPages") or data.get("pageCount") or 1
            if isinstance(total_pages, int) and total_pages > 1 and records:
                for page in range(2, min(total_pages + 1, 50)):  # Cap at 50 pages
                    try:
                        page_data = self._get_json(
                            endpoint,
                            params={"page": str(page), "pageSize": "100"},
                        )
                        page_records = self._extract_api_records(page_data, endpoint)
                        records.extend(page_records)
                    except Exception as exc:
                        self.log.debug(
                            f"Pagination page {page} failed",
                            extra={"error": str(exc)},
                        )
                        break

        return records

    def _fetch_html(self, page_url: str) -> list[dict]:
        """
        Fetch and parse an HTML page for shortage information.
        Handles both static HTML and Angular/SPA-rendered content hints.
        """
        from bs4 import BeautifulSoup

        resp = self._get(page_url)
        soup = BeautifulSoup(resp.text, "html.parser")

        records: list[dict] = []

        # Look for data tables
        tables = soup.find_all("table")
        for table in tables:
            table_records = self._parse_html_table(table, page_url)
            records.extend(table_records)

        # Look for structured list content
        if not records:
            records = self._parse_html_lists(soup, page_url)

        # Look for Angular/React data bindings that might contain data URLs
        if not records:
            api_urls = self._find_embedded_api_urls(resp.text)
            for api_url in api_urls:
                try:
                    full_url = urljoin(page_url, api_url)
                    data = self._get_json(full_url)
                    api_records = self._extract_api_records(data, full_url)
                    records.extend(api_records)
                    if api_records:
                        break
                except Exception:
                    continue

        return records

    def _parse_html_table(self, table: Any, page_url: str) -> list[dict]:
        """Parse an HTML table for drug shortage data."""
        records: list[dict] = []

        rows = table.find_all("tr")
        if len(rows) < 2:
            return records

        # Extract headers
        header_row = rows[0]
        headers = [th.get_text(strip=True).lower()
                    for th in header_row.find_all(["th", "td"])]

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if not cells:
                continue

            cell_values = [cell.get_text(strip=True) for cell in cells]
            row_dict: dict[str, str] = {}
            for i, val in enumerate(cell_values):
                if i < len(headers) and headers[i]:
                    row_dict[headers[i]] = val
                else:
                    row_dict[f"column_{i}"] = val

            row_dict["_source_url"] = page_url
            row_dict["_source_type"] = "html_table"
            records.append(row_dict)

        return records

    def _parse_html_lists(self, soup: Any, page_url: str) -> list[dict]:
        """Parse list-format content for shortage notices."""
        records: list[dict] = []

        # Look for div blocks or list items that contain drug info
        content_divs = soup.find_all(
            "div",
            {"class": re.compile(r"drug|shortage|item|card|result", re.I)},
        )

        for div in content_divs:
            text = div.get_text(" ", strip=True)
            if len(text) > 10:
                records.append({
                    "text":         text[:2000],
                    "_source_url":  page_url,
                    "_source_type": "html_div",
                })

        return records

    def _find_embedded_api_urls(self, html_text: str) -> list[str]:
        """Find API URLs embedded in JavaScript or Angular templates."""
        urls: list[str] = []

        # Look for common API URL patterns in JS
        patterns = [
            r'["\'](/(?:api|GovServiceList\.svc|services?)/[^"\']+)["\']',
            r'url\s*[:=]\s*["\']([^"\']+(?:shortage|drug)[^"\']*)["\']',
            r'endpoint\s*[:=]\s*["\']([^"\']+)["\']',
            r'apiUrl\s*[:=]\s*["\']([^"\']+)["\']',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, html_text, re.IGNORECASE)
            urls.extend(matches)

        return urls

    def _fetch_main_page(self) -> list[dict]:
        """
        Last-resort: fetch the main page and look for any shortage data or links.
        """
        from bs4 import BeautifulSoup

        resp = self._get(self.BASE_URL)
        soup = BeautifulSoup(resp.text, "html.parser")

        records: list[dict] = []

        # Try to find shortage-related links
        shortage_keywords = [
            "shortage", "supply", "machsor", "mehsar",  # Hebrew transliterations
        ]

        links = soup.find_all("a", href=True)
        for link in links:
            text = link.get_text(strip=True).lower()
            href = link["href"]
            if any(kw in text or kw in href.lower() for kw in shortage_keywords):
                full_url = urljoin(self.BASE_URL, href)
                try:
                    if full_url.endswith(".json") or "api" in full_url.lower():
                        data = self._get_json(full_url)
                        api_records = self._extract_api_records(data, full_url)
                        records.extend(api_records)
                    else:
                        page_records = self._fetch_html(full_url)
                        records.extend(page_records)
                except Exception as exc:
                    self.log.debug(
                        "Failed to follow shortage link",
                        extra={"url": full_url, "error": str(exc)},
                    )

        # Also look for embedded API URLs in page source
        api_urls = self._find_embedded_api_urls(resp.text)
        for api_url in api_urls:
            try:
                full_url = urljoin(self.BASE_URL, api_url)
                data = self._get_json(full_url)
                api_records = self._extract_api_records(data, full_url)
                records.extend(api_records)
            except Exception:
                continue

        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize Israel MOH records into standard shortage event dicts."""
        self.log.info(
            "Normalising Israel MOH records",
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
                    "Failed to normalise Israel MOH record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single Israel MOH record to a normalised shortage event dict."""

        # -- Drug name extraction (try API field names, then HTML field names) --
        # INN (International Nonproprietary Name) in Latin script is preferred
        generic_name = (
            rec.get("INN")
            or rec.get("inn")
            or rec.get("InternationalName")
            or rec.get("internationalName")
            or rec.get("GenericName")
            or rec.get("genericName")
            or rec.get("generic_name")
            or rec.get("DrugNameEng")
            or rec.get("drugNameEng")
            or rec.get("DrugName")
            or rec.get("drugName")
            or rec.get("Name")
            or rec.get("name")
            or rec.get("drug name")
            or rec.get("product name")
            or rec.get("column_0")
            or ""
        )

        # If name is in Hebrew, try Latin alternatives
        if generic_name and self._is_hebrew(generic_name):
            latin_name = (
                rec.get("DrugNameEng")
                or rec.get("drugNameEng")
                or rec.get("INN")
                or rec.get("inn")
                or rec.get("InternationalName")
                or ""
            )
            if latin_name and not self._is_hebrew(latin_name):
                generic_name = latin_name

        if isinstance(generic_name, str):
            generic_name = generic_name.strip()
        else:
            generic_name = str(generic_name).strip()

        # If still Hebrew or empty, try to extract from text
        if not generic_name or self._is_hebrew(generic_name):
            text = rec.get("text", "")
            extracted = self._extract_latin_drug_name(text)
            if extracted:
                generic_name = extracted
            elif not generic_name:
                return None

        if not generic_name:
            return None

        # -- Brand / trade name --
        brand_name = (
            rec.get("TradeName")
            or rec.get("tradeName")
            or rec.get("BrandName")
            or rec.get("brandName")
            or rec.get("trade name")
            or rec.get("brand name")
            or rec.get("column_1", "")
        )
        if isinstance(brand_name, str):
            brand_name = brand_name.strip()
        else:
            brand_name = str(brand_name).strip()

        brand_names = [brand_name] if brand_name and brand_name != generic_name else []

        # -- Reason --
        raw_reason = (
            rec.get("Reason")
            or rec.get("reason")
            or rec.get("ShortageReason")
            or rec.get("shortageReason")
            or rec.get("Cause")
            or rec.get("cause")
            or rec.get("remarks")
            or ""
        )
        if isinstance(raw_reason, str):
            raw_reason = raw_reason.strip()
        else:
            raw_reason = str(raw_reason).strip()

        reason_category = self._map_reason(raw_reason)

        # -- Start date --
        raw_date = (
            rec.get("StartDate")
            or rec.get("startDate")
            or rec.get("ShortageStartDate")
            or rec.get("shortageStartDate")
            or rec.get("Date")
            or rec.get("date")
            or rec.get("UpdateDate")
            or rec.get("updateDate")
            or rec.get("start date")
        )
        start_date = self._parse_date(raw_date) or today

        # -- End / estimated resolution date --
        raw_end_date = (
            rec.get("EndDate")
            or rec.get("endDate")
            or rec.get("ExpectedResolutionDate")
            or rec.get("expectedResolutionDate")
            or rec.get("EstimatedEndDate")
            or rec.get("estimatedEndDate")
        )
        end_date = self._parse_date(raw_end_date)

        # -- Status --
        raw_status = (
            rec.get("Status")
            or rec.get("status")
            or rec.get("ShortageStatus")
            or rec.get("shortageStatus")
            or ""
        )
        status = self._determine_status(raw_status, rec)

        # -- Registration number --
        reg_number = str(
            rec.get("RegistrationNumber")
            or rec.get("registrationNumber")
            or rec.get("RegNum")
            or rec.get("regNum")
            or rec.get("DrugRegNum")
            or ""
        ).strip()

        # -- Manufacturer --
        manufacturer = str(
            rec.get("Manufacturer")
            or rec.get("manufacturer")
            or rec.get("ManufacturerName")
            or rec.get("manufacturerName")
            or rec.get("Company")
            or ""
        ).strip()

        # -- Dosage form / strength --
        dosage_form = str(
            rec.get("DosageForm")
            or rec.get("dosageForm")
            or rec.get("Form")
            or rec.get("form")
            or ""
        ).strip()

        strength = str(
            rec.get("Strength")
            or rec.get("strength")
            or rec.get("Dosage")
            or rec.get("dosage")
            or ""
        ).strip()

        # -- Source URL --
        source_url = rec.get("_source_url") or rec.get("_api_endpoint") or self.BASE_URL

        # -- Build notes --
        notes_parts: list[str] = []
        if reg_number:
            notes_parts.append(f"Registration: {reg_number}")
        if manufacturer:
            notes_parts.append(f"Manufacturer: {manufacturer}")
        if dosage_form:
            notes_parts.append(f"Form: {dosage_form}")
        if strength:
            notes_parts.append(f"Strength: {strength}")
        if end_date:
            notes_parts.append(f"Expected resolution: {end_date}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "medium",
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "estimated_resolution_date": end_date,
            "source_url":                source_url,
            "notes":                     notes,
            "source_confidence_score":   82,
            "raw_record":                rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map Israel MOH reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    def _determine_status(self, raw_status: str, rec: dict) -> str:
        """Determine shortage status from raw data."""
        if raw_status:
            lower = raw_status.strip().lower()
            if "resolved" in lower or "ended" in lower or "available" in lower:
                return "resolved"
            if "anticipated" in lower or "expected" in lower or "planned" in lower:
                return "anticipated"
            if "active" in lower or "current" in lower or "ongoing" in lower:
                return "active"

        # Check text content
        text = (rec.get("text", "") or "").lower()
        if "resolved" in text or "ended" in text:
            return "resolved"

        return "active"

    @staticmethod
    def _is_hebrew(text: str) -> bool:
        """Check if text contains Hebrew characters."""
        if not text:
            return False
        hebrew_count = sum(1 for c in text if '\u0590' <= c <= '\u05FF')
        return hebrew_count > len(text) * 0.3

    @staticmethod
    def _extract_latin_drug_name(text: str) -> str:
        """Extract Latin-script drug name from mixed Hebrew/English text."""
        if not text:
            return ""
        # Look for sequences of Latin letters (possible drug names)
        matches = re.findall(r'[A-Za-z][A-Za-z\s\-]{3,}[A-Za-z]', text)
        if matches:
            # Return the longest match as it's most likely the full drug name
            return max(matches, key=len).strip()
        return ""

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
        if not raw_str or raw_str in ("-", "N/A", "null", "None", "0"):
            return None

        # Handle .NET JSON date format: /Date(1234567890000)/
        date_match = re.match(r'/Date\((\d+)\)/', raw_str)
        if date_match:
            timestamp_ms = int(date_match.group(1))
            dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
            return dt.date().isoformat()

        # Handle ISO format with timezone
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass

        # Handle DD/MM/YYYY (common in Israeli documents)
        match = re.match(r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})', raw_str)
        if match:
            day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
            try:
                return date(year, month, day).isoformat()
            except ValueError:
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
        print("Fetches live Israel MOH data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = IsraelMOHScraper(db_client=MagicMock())

        print("\n-- Fetching from Israel MOH ...")
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

    scraper = IsraelMOHScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
