"""
UAE MOHAP Drug Shortage Scraper
-------------------------------
Source:  Ministry of Health and Prevention UAE - Drug Shortage Notifications
URL:     https://www.mohap.gov.ae/

The UAE Ministry of Health and Prevention (MOHAP) publishes drug-related
notices including shortage notifications and supply disruption alerts on
their website. Content is bilingual (English/Arabic).

Data source UUID:  10000000-0000-0000-0000-000000000055
Country:           United Arab Emirates
Country code:      AE
Confidence:        73/100

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class UAEMOHAPScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000055"
    SOURCE_NAME: str  = "Ministry of Health and Prevention UAE \u2014 Drug Shortage Notifications"
    BASE_URL: str     = "https://www.mohap.gov.ae/"
    COUNTRY: str      = "United Arab Emirates"
    COUNTRY_CODE: str = "AE"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Pharmaceutical notices / circulars page
    NOTICES_URL: str = "https://www.mohap.gov.ae/en/services/pharmacy"

    # Known MOHAP shortage reasons -> reason_category
    _REASON_MAP: dict[str, str] = {
        "manufacturing issue":       "manufacturing_issue",
        "manufacturing delay":       "manufacturing_issue",
        "production issue":          "manufacturing_issue",
        "production delay":          "manufacturing_issue",
        "supply chain":              "supply_chain",
        "supply disruption":         "supply_chain",
        "import delay":              "supply_chain",
        "import issue":              "supply_chain",
        "global shortage":           "supply_chain",
        "raw material":              "raw_material",
        "raw material shortage":     "raw_material",
        "api shortage":              "raw_material",
        "demand increase":           "demand_surge",
        "increased demand":          "demand_surge",
        "high demand":               "demand_surge",
        "distribution":              "distribution",
        "distribution issue":        "distribution",
        "logistics":                 "distribution",
        "regulatory":                "regulatory_action",
        "registration":              "regulatory_action",
        "recall":                    "regulatory_action",
        "withdrawal":                "regulatory_action",
        "discontinuation":           "discontinuation",
        "discontinued":              "discontinuation",
        "market withdrawal":         "discontinuation",
    }

    # Keywords indicating drug shortage / supply issues
    _SHORTAGE_KEYWORDS: list[str] = [
        "shortage",
        "supply",
        "unavailable",
        "unavailability",
        "disruption",
        "discontinue",
        "recall",
        "withdraw",
        "pharmaceutical",
        "drug",
        "medicine",
        "medication",
        "stock",
        "out of stock",
    ]

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch MOHAP drug shortage notices.

        Strategy:
        1. GET the MOHAP pharmaceutical notices page.
        2. Parse HTML with BeautifulSoup for notice items.
        3. Filter for drug shortage / supply related notices.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.NOTICES_URL,
        })

        records: list[dict] = []

        try:
            resp = self._get(self.NOTICES_URL)
            records = self._parse_notices_page(resp.text)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch MOHAP notices page",
                extra={"error": str(exc), "url": self.NOTICES_URL},
            )
            raise ScraperError(f"MOHAP fetch failed: {exc}") from exc

        self.log.info(
            "MOHAP fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_notices_page(self, html: str) -> list[dict]:
        """Parse the MOHAP notices page HTML for shortage-related notices."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        # Look for notice/announcement list items
        # MOHAP uses various structures for their notices
        notice_elements = (
            soup.select(".news-item")
            or soup.select(".announcement-item")
            or soup.select(".circular-item")
            or soup.select("article")
            or soup.select(".card")
            or soup.select(".list-group-item")
            or soup.select("table tbody tr")
        )

        if not notice_elements:
            # Fallback: look for links containing shortage-related keywords
            notice_elements = soup.find_all("a", href=True)

        for el in notice_elements:
            text = el.get_text(separator=" ", strip=True)
            text_lower = text.lower()

            # Filter: only keep notices related to drug shortages
            if not any(kw in text_lower for kw in self._SHORTAGE_KEYWORDS):
                continue

            # Extract link
            link = None
            if el.name == "a":
                link = el.get("href", "")
            else:
                link_tag = el.find("a", href=True)
                if link_tag:
                    link = link_tag.get("href", "")

            if link and not link.startswith("http"):
                link = f"https://www.mohap.gov.ae{link}"

            # Extract date if present
            raw_date = None
            date_el = el.find(class_=re.compile(r"date|time|publish", re.IGNORECASE))
            if date_el:
                raw_date = date_el.get_text(strip=True)
            else:
                # Try to find a date pattern (DD/MM/YYYY, DD-MM-YYYY, or YYYY-MM-DD)
                date_match = re.search(
                    r'(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})', text
                )
                if date_match:
                    raw_date = date_match.group(0)

            records.append({
                "title": text[:500],
                "url": link or self.NOTICES_URL,
                "date": raw_date,
                "raw_text": text,
            })

        self.log.info(
            "Parsed MOHAP notices",
            extra={"total_elements": len(notice_elements), "shortage_notices": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize MOHAP records into standard shortage event dicts."""
        self.log.info(
            "Normalising MOHAP records",
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
                    "Failed to normalise MOHAP record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single MOHAP record to a normalised shortage event dict."""
        title = rec.get("title", "").strip()
        raw_text = rec.get("raw_text", "").strip()

        if not title:
            return None

        # -- Drug name extraction --
        generic_name = self._extract_drug_name(title)
        if not generic_name:
            generic_name = self._extract_drug_name(raw_text)
        if not generic_name:
            # Use the title itself as the drug reference
            generic_name = title[:100]

        # -- Brand names --
        brand_names: list[str] = []
        brand = self._extract_brand_name(raw_text)
        if brand and brand != generic_name:
            brand_names.append(brand)

        # -- Reason extraction --
        raw_reason = self._extract_reason(raw_text)
        reason_category = self._map_reason(raw_reason)

        # -- Start date --
        raw_date = rec.get("date")
        start_date = self._parse_date(raw_date) or today

        # -- Status --
        status = self._determine_status(raw_text)

        # -- Source URL --
        source_url = rec.get("url") or self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        if raw_reason:
            notes_parts.append(f"Reason: {raw_reason}")
        notes_parts.append(f"Title: {title[:200]}")
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
            "source_confidence_score": 73,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map MOHAP reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    def _determine_status(self, text: str) -> str:
        """Determine shortage status from notice text."""
        lower = text.lower()
        if any(w in lower for w in ("resolved", "restored", "available again", "resumed")):
            return "resolved"
        if any(w in lower for w in ("anticipated", "expected", "upcoming", "potential")):
            return "anticipated"
        return "active"

    def _extract_drug_name(self, text: str) -> str:
        """
        Extract a drug name (INN) from MOHAP notice text.

        Looks for uppercase or capitalized drug name patterns typical
        in English pharmaceutical notices.
        """
        # Look for words that look like drug names (capitalized Latin sequences)
        # Drug names are typically in title case or uppercase
        matches = re.findall(
            r'\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*)\b', text
        )
        # Filter out common English/contextual words
        stopwords = {
            "Ministry", "Health", "Prevention", "Drug", "Shortage",
            "Notice", "Notification", "Circular", "Alert", "Update",
            "United", "Arab", "Emirates", "UAE", "MOHAP", "The",
            "Pharmaceutical", "Product", "Supply", "Available",
            "Important", "Urgent", "Information", "Please", "Dear",
        }
        for match in matches:
            if match not in stopwords and len(match) > 2:
                return match
        return ""

    def _extract_brand_name(self, text: str) -> str:
        """Extract brand/trade name from text if present."""
        # Look for text in quotes or parentheses
        quoted = re.search(r'["\u201c]([^"\u201d]+)["\u201d]', text)
        if quoted:
            return quoted.group(1).strip()
        paren = re.search(r'\(([A-Za-z][A-Za-z\s]+)\)', text)
        if paren:
            return paren.group(1).strip()
        return ""

    def _extract_reason(self, text: str) -> str:
        """Extract shortage reason from notice text."""
        lower = text.lower()

        reason_phrases = {
            "manufacturing issue":   "Manufacturing issue",
            "manufacturing delay":   "Manufacturing delay",
            "production issue":      "Production issue",
            "supply chain":          "Supply chain disruption",
            "supply disruption":     "Supply disruption",
            "import delay":          "Import delay",
            "global shortage":       "Global shortage",
            "raw material":          "Raw material shortage",
            "increased demand":      "Increased demand",
            "high demand":           "High demand",
            "distribution issue":    "Distribution issue",
            "logistics":             "Logistics issue",
            "recall":                "Product recall",
            "regulatory":            "Regulatory action",
            "discontinuation":       "Discontinuation",
            "discontinued":          "Discontinuation",
        }

        for phrase, english in reason_phrases.items():
            if phrase in lower:
                return english

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
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None

        # ISO format: YYYY-MM-DD
        iso_match = re.match(r'(\d{4})-(\d{1,2})-(\d{1,2})', raw_str)
        if iso_match:
            year, month, day = iso_match.groups()
            try:
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

        # DD/MM/YYYY or DD-MM-YYYY
        dmy_match = re.match(r'(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})', raw_str)
        if dmy_match:
            day, month, year = dmy_match.groups()
            try:
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

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
        print("Fetches live MOHAP data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = UAEMOHAPScraper(db_client=MagicMock())

        print("\n-- Fetching from MOHAP ...")
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

    scraper = UAEMOHAPScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
