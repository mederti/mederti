"""
Hong Kong Drug Office Drug Shortage Scraper
--------------------------------------------
Source:  Hong Kong Department of Health - Drug Office
URL:     https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/home.html

The Drug Office publishes drug shortage notifications and circulars on its
healthcare providers page. This scraper fetches the main page, identifies
shortage-related notices/circulars, follows links to individual notices,
and extracts drug shortage information from each notice page.

Data source UUID:  10000000-0000-0000-0000-000000000045
Country:           Hong Kong
Country code:      HK
Confidence:        80/100 (government regulatory source)

Cron:  Every 24 hours (Drug Office updates infrequently)
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urljoin

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class HKDrugOfficeScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000045"
    SOURCE_NAME: str  = "Hong Kong Department of Health — Drug Office"
    BASE_URL: str     = "https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/home.html"
    COUNTRY: str      = "Hong Kong"
    COUNTRY_CODE: str = "HK"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Known landing pages for shortage-related content
    SHORTAGE_PAGES: list[str] = [
        "https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/news_informations/drug_safety.html",
        "https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/news_informations/shortage.html",
        "https://www.drugoffice.gov.hk/eps/do/en/healthcare_providers/news_informations.html",
    ]

    # Keywords that indicate a shortage-related notice
    SHORTAGE_KEYWORDS: list[str] = [
        "shortage", "short supply", "supply disruption", "unavailable",
        "out of stock", "limited supply", "supply problem", "discontinu",
        "recall", "withdrawn", "suspend",
    ]

    # Reason keyword mapping specific to HK Drug Office
    _REASON_MAP: dict[str, str] = {
        "manufacturing":      "manufacturing_issue",
        "production":         "manufacturing_issue",
        "quality":            "manufacturing_issue",
        "gmp":                "manufacturing_issue",
        "contamination":      "manufacturing_issue",
        "supply chain":       "supply_chain",
        "supply disruption":  "supply_chain",
        "global shortage":    "supply_chain",
        "logistics":          "supply_chain",
        "demand":             "demand_surge",
        "increased demand":   "demand_surge",
        "discontinu":         "discontinuation",
        "withdraw":           "discontinuation",
        "regulatory":         "regulatory_action",
        "suspend":            "regulatory_action",
        "raw material":       "raw_material",
        "ingredient":         "raw_material",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch drug shortage notices from the HK Drug Office website.

        Strategy:
        1. Try dedicated shortage pages first.
        2. Fall back to the main healthcare providers page.
        3. Parse each page for shortage-related links and follow them.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        records: list[dict] = []

        # Try each known shortage page
        for page_url in self.SHORTAGE_PAGES:
            try:
                page_records = self._fetch_page(page_url)
                records.extend(page_records)
                self.log.info(
                    "Fetched shortage page",
                    extra={"url": page_url, "records": len(page_records)},
                )
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch shortage page",
                    extra={"url": page_url, "error": str(exc)},
                )

        # If no records from specific pages, try the main healthcare providers page
        if not records:
            self.log.info("No records from shortage pages, trying main page")
            try:
                page_records = self._fetch_page(self.BASE_URL)
                records.extend(page_records)
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch main page",
                    extra={"url": self.BASE_URL, "error": str(exc)},
                )

        # Deduplicate by notice URL
        seen_urls: set[str] = set()
        unique_records: list[dict] = []
        for rec in records:
            url = rec.get("notice_url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique_records.append(rec)
            elif not url:
                unique_records.append(rec)

        self.log.info(
            "HK Drug Office fetch complete",
            extra={"total_records": len(unique_records)},
        )
        return unique_records

    def _fetch_page(self, page_url: str) -> list[dict]:
        """
        Fetch a single page and extract shortage notices.

        Parses the HTML for links to individual shortage notices/circulars,
        then follows each link to extract detailed information.
        """
        from bs4 import BeautifulSoup

        resp = self._get(page_url)
        soup = BeautifulSoup(resp.text, "html.parser")

        records: list[dict] = []

        # Look for links containing shortage-related keywords
        all_links = soup.find_all("a", href=True)
        shortage_links: list[tuple[str, str]] = []

        for link in all_links:
            link_text = link.get_text(strip=True).lower()
            href = link["href"]

            # Check if link text contains shortage keywords
            is_shortage = any(kw in link_text for kw in self.SHORTAGE_KEYWORDS)
            if is_shortage:
                full_url = urljoin(page_url, href)
                shortage_links.append((full_url, link.get_text(strip=True)))

        self.log.info(
            "Found shortage links",
            extra={"page": page_url, "links": len(shortage_links)},
        )

        # Follow each shortage link to get details
        for link_url, link_title in shortage_links:
            try:
                notice_records = self._parse_notice(link_url, link_title)
                records.extend(notice_records)
            except Exception as exc:
                self.log.warning(
                    "Failed to parse notice",
                    extra={"url": link_url, "error": str(exc)},
                )

        # Also parse inline content on the page itself (tables, lists)
        inline_records = self._parse_inline_content(soup, page_url)
        records.extend(inline_records)

        return records

    def _parse_notice(self, notice_url: str, notice_title: str) -> list[dict]:
        """
        Fetch and parse an individual shortage notice page.
        Returns a list of raw record dicts (one per drug mentioned).
        """
        from bs4 import BeautifulSoup

        resp = self._get(notice_url)
        soup = BeautifulSoup(resp.text, "html.parser")

        records: list[dict] = []

        # Extract the main content area
        content = soup.find("div", {"class": re.compile(r"content|article|main", re.I)})
        if not content:
            content = soup.find("body")

        if not content:
            return records

        # Try to find a date in the notice
        notice_date = self._extract_date_from_page(soup)

        # Look for tables with drug information
        tables = content.find_all("table")
        for table in tables:
            table_records = self._parse_table(table, notice_url, notice_title, notice_date)
            records.extend(table_records)

        # If no table records, try to extract drug names from paragraphs/lists
        if not records:
            text_content = content.get_text(" ", strip=True)
            # Look for drug names in the text (capitalized words that look like drug names)
            record = {
                "title":       notice_title,
                "notice_url":  notice_url,
                "date":        notice_date,
                "text":        text_content[:2000],
                "source_page": "notice",
            }
            records.append(record)

        return records

    def _parse_table(
        self,
        table: Any,
        notice_url: str,
        notice_title: str,
        notice_date: str | None,
    ) -> list[dict]:
        """Parse an HTML table for drug shortage data."""
        records: list[dict] = []

        rows = table.find_all("tr")
        if len(rows) < 2:
            return records

        # Extract headers
        header_row = rows[0]
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]

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

            row_dict["notice_url"] = notice_url
            row_dict["title"] = notice_title
            row_dict["date"] = notice_date
            row_dict["source_page"] = "table"
            records.append(row_dict)

        return records

    def _parse_inline_content(self, soup: Any, page_url: str) -> list[dict]:
        """
        Parse inline content (lists, paragraphs) from a page that may contain
        drug shortage notices directly (not behind links).
        """
        records: list[dict] = []

        # Look for list items that mention shortage keywords
        list_items = soup.find_all("li")
        for item in list_items:
            text = item.get_text(strip=True).lower()
            is_shortage = any(kw in text for kw in self.SHORTAGE_KEYWORDS)
            if is_shortage:
                # Try to find a date and drug name
                item_text = item.get_text(strip=True)
                item_link = item.find("a", href=True)
                link_url = urljoin(page_url, item_link["href"]) if item_link else page_url

                records.append({
                    "title":       item_text[:300],
                    "notice_url":  link_url,
                    "date":        self._extract_date_from_text(item_text),
                    "text":        item_text,
                    "source_page": "inline",
                })

        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize HK Drug Office records into standard shortage event dicts."""
        self.log.info(
            "Normalising HK Drug Office records",
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
                    "Failed to normalise HK Drug Office record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single HK Drug Office record to a normalised shortage event dict."""

        # -- Drug name extraction --
        generic_name = (
            rec.get("drug name")
            or rec.get("product name")
            or rec.get("name")
            or rec.get("generic name")
            or rec.get("medicine")
            or rec.get("column_0")
            or ""
        )

        # If no structured drug name, try to extract from title/text
        if not generic_name or not generic_name.strip():
            title = rec.get("title", "")
            generic_name = self._extract_drug_name_from_text(title)

        if isinstance(generic_name, str):
            generic_name = generic_name.strip()
        else:
            generic_name = str(generic_name).strip()

        if not generic_name:
            return None

        # -- Brand / trade name --
        brand_name = (
            rec.get("trade name")
            or rec.get("brand name")
            or rec.get("brand")
            or rec.get("column_1", "")
        )
        if isinstance(brand_name, str):
            brand_name = brand_name.strip()
        else:
            brand_name = str(brand_name).strip()

        brand_names = [brand_name] if brand_name and brand_name != generic_name else []

        # -- Reason --
        raw_reason = (
            rec.get("reason")
            or rec.get("cause")
            or rec.get("remarks")
            or ""
        )
        if isinstance(raw_reason, str):
            raw_reason = raw_reason.strip()
        else:
            raw_reason = str(raw_reason).strip()

        # If no explicit reason field, try to infer from text/title
        if not raw_reason:
            text = rec.get("text", "") or rec.get("title", "")
            raw_reason = self._infer_reason_from_text(text)

        reason_category = self._map_reason(raw_reason)

        # -- Start date --
        raw_date = (
            rec.get("date")
            or rec.get("effective date")
            or rec.get("start date")
            or rec.get("notice date")
        )
        start_date = self._parse_date(raw_date) or today

        # -- Status --
        raw_status = (
            rec.get("status")
            or rec.get("current status")
            or ""
        )
        status = self._determine_status(raw_status, rec)

        # -- Source URL --
        source_url = rec.get("notice_url") or self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        title = rec.get("title", "")
        if title:
            notes_parts.append(f"Notice: {title[:200]}")
        remarks = rec.get("remarks", "")
        if remarks:
            notes_parts.append(f"Remarks: {remarks[:200]}")
        manufacturer = rec.get("manufacturer") or rec.get("company") or ""
        if manufacturer:
            notes_parts.append(f"Manufacturer: {manufacturer}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             brand_names,
            "status":                  status,
            "severity":                "medium",
            "reason":                  raw_reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 80,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map HK Drug Office reason string to canonical reason_category."""
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
            if "resolved" in lower or "restored" in lower or "available" in lower:
                return "resolved"
            if "anticipated" in lower or "expected" in lower:
                return "anticipated"

        # Check text content for status hints
        text = (rec.get("text", "") or rec.get("title", "")).lower()
        if "resolved" in text or "restored" in text or "resumed" in text:
            return "resolved"
        if "anticipat" in text or "expect" in text:
            return "anticipated"

        return "active"

    def _extract_drug_name_from_text(self, text: str) -> str:
        """
        Attempt to extract a drug name from free-text notice titles.

        Looks for patterns like:
            "Shortage of Amoxicillin 500mg Capsules"
            "Supply disruption - Metformin HCl Tablets"
        """
        if not text:
            return ""

        # Pattern: "Shortage of <DRUG NAME>"
        match = re.search(
            r'(?:shortage|supply\s+(?:disruption|problem)|unavailab\w+)\s+(?:of\s+)?'
            r'([A-Z][a-zA-Z\s\-/]+?)(?:\s+\d|\s*$|\s*[-–])',
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()

        # Pattern: "<DRUG NAME> shortage/supply"
        match = re.search(
            r'([A-Z][a-zA-Z\s\-/]+?)\s+(?:shortage|supply|recall|withdraw)',
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()

        return ""

    def _infer_reason_from_text(self, text: str) -> str:
        """Try to infer a reason from notice text."""
        if not text:
            return ""
        lower = text.lower()
        for keyword in [
            "manufacturing", "production", "quality", "supply chain",
            "demand", "discontinu", "regulatory", "raw material",
            "contamination", "recall",
        ]:
            if keyword in lower:
                return keyword.title()
        return ""

    @staticmethod
    def _extract_date_from_page(soup: Any) -> str | None:
        """Try to find a publication date on the page."""
        # Look for common date patterns in meta tags
        for meta in soup.find_all("meta"):
            name = (meta.get("name") or meta.get("property") or "").lower()
            if "date" in name or "publish" in name:
                return HKDrugOfficeScraper._parse_date(meta.get("content"))

        # Look for date patterns in visible text
        body_text = soup.get_text(" ", strip=True)
        return HKDrugOfficeScraper._extract_date_from_text(body_text)

    @staticmethod
    def _extract_date_from_text(text: str) -> str | None:
        """Extract a date from free text using common patterns."""
        if not text:
            return None

        # Pattern: DD/MM/YYYY or DD-MM-YYYY
        match = re.search(r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})', text)
        if match:
            day, month, year = match.group(1), match.group(2), match.group(3)
            try:
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

        # Pattern: DD Month YYYY (e.g. "5 March 2026")
        match = re.search(
            r'(\d{1,2})\s+'
            r'(January|February|March|April|May|June|July|August|September|October|November|December)'
            r'\s+(\d{4})',
            text,
            re.IGNORECASE,
        )
        if match:
            try:
                from dateutil import parser as dtparser
                dt = dtparser.parse(match.group(0))
                return dt.date().isoformat()
            except (ValueError, ImportError):
                pass

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
        print("Fetches live HK Drug Office data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = HKDrugOfficeScraper(db_client=MagicMock())

        print("\n-- Fetching from HK Drug Office ...")
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

    scraper = HKDrugOfficeScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
