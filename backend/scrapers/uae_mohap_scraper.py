"""
UAE MOHAP / EDE Drug Shortage Scraper
--------------------------------------
Source:  Ministry of Health and Prevention UAE + Emirates Drug Establishment
URL:     https://www.mohap.gov.ae/ , https://www.ede.gov.ae/

MOHAP transferred pharmaceutical regulatory services to the Emirates Drug
Establishment (EDE) in late 2025.  This scraper now pulls news from both
the EDE news page and MOHAP media-centre, filtering for pharmaceutical
supply / shortage / recall / availability notices.

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
    BASE_URL: str     = "https://www.ede.gov.ae/"
    COUNTRY: str      = "United Arab Emirates"
    COUNTRY_CODE: str = "AE"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "2.0.0"

    # EDE news page (primary — EDE took over drug regulation from MOHAP)
    EDE_NEWS_URL: str = "https://www.ede.gov.ae/en/news"

    # MOHAP media centre news (secondary — still publishes health news)
    MOHAP_NEWS_URL: str = (
        "https://mohap.gov.ae/en/digital-participation/media-center/news"
    )

    # MOHAP pharmaceutical-product withdrawal notices
    MOHAP_WITHDRAWAL_URL: str = (
        "https://mohap.gov.ae/en/w/"
        "ministry-of-health-and-prevention-withdraws-pharmaceutical-"
        "products-due-to-non-compliance-with-approved-specifications"
    )

    # Known MOHAP/EDE shortage reasons -> reason_category
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
        "non-compliance":            "regulatory_action",
        "discontinuation":           "discontinuation",
        "discontinued":              "discontinuation",
        "market withdrawal":         "discontinuation",
        "monopoly":                  "supply_chain",
        "stockpile":                 "supply_chain",
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
        "monopoly",
        "stockpile",
        "availability",
        "secure",
        "manufacturing",
        "production",
    ]

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch drug shortage / pharmaceutical supply notices from:
          1. EDE news page (ede.gov.ae)
          2. MOHAP media-centre news
          3. MOHAP pharmaceutical withdrawal page
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "urls": [self.EDE_NEWS_URL, self.MOHAP_NEWS_URL],
        })

        records: list[dict] = []

        # 1. EDE news
        try:
            resp = self._get(self.EDE_NEWS_URL)
            ede_records = self._parse_news_page(
                resp.text,
                base_domain="https://www.ede.gov.ae",
                source_label="EDE",
            )
            records.extend(ede_records)
            self.log.info("EDE news parsed", extra={"records": len(ede_records)})
        except Exception as exc:
            self.log.warning(
                "Failed to fetch EDE news page",
                extra={"error": str(exc), "url": self.EDE_NEWS_URL},
            )

        # 2. MOHAP media-centre news
        try:
            resp = self._get(self.MOHAP_NEWS_URL)
            mohap_records = self._parse_news_page(
                resp.text,
                base_domain="https://mohap.gov.ae",
                source_label="MOHAP",
            )
            records.extend(mohap_records)
            self.log.info("MOHAP news parsed", extra={"records": len(mohap_records)})
        except Exception as exc:
            self.log.warning(
                "Failed to fetch MOHAP news page",
                extra={"error": str(exc), "url": self.MOHAP_NEWS_URL},
            )

        # 3. MOHAP withdrawal notice page
        try:
            resp = self._get(self.MOHAP_WITHDRAWAL_URL)
            withdrawal_records = self._parse_withdrawal_page(resp.text)
            records.extend(withdrawal_records)
            self.log.info(
                "MOHAP withdrawal page parsed",
                extra={"records": len(withdrawal_records)},
            )
        except Exception as exc:
            self.log.warning(
                "Failed to fetch MOHAP withdrawal page",
                extra={"error": str(exc), "url": self.MOHAP_WITHDRAWAL_URL},
            )

        if not records:
            raise ScraperError(
                "No records fetched from any UAE source (EDE / MOHAP)"
            )

        self.log.info(
            "UAE fetch complete",
            extra={"total_records": len(records)},
        )
        return records

    def _parse_news_page(
        self,
        html: str,
        base_domain: str,
        source_label: str,
    ) -> list[dict]:
        """Parse an EDE or MOHAP news page for pharmaceutical-related articles."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        # Collect all links that point to article pages (/w/ prefix)
        article_links = soup.find_all("a", href=re.compile(r'/w/'))

        seen_urls: set[str] = set()
        for link in article_links:
            href = link.get("href", "")
            if not href or href in seen_urls:
                continue

            # Build full URL
            if href.startswith("/"):
                full_url = f"{base_domain}{href}"
            elif href.startswith("http"):
                full_url = href
            else:
                continue

            seen_urls.add(href)

            # Get the link text (article title)
            text = link.get_text(separator=" ", strip=True)
            if not text or len(text) < 5:
                # Try parent element for title text
                parent = link.find_parent(["div", "article", "li", "section"])
                if parent:
                    text = parent.get_text(separator=" ", strip=True)

            if not text:
                continue

            text_lower = text.lower()

            # Filter: only keep notices related to pharma / drug supply
            if not any(kw in text_lower for kw in self._SHORTAGE_KEYWORDS):
                continue

            # Extract date if present near the link
            raw_date = None
            parent = link.find_parent(["div", "article", "li", "section"])
            if parent:
                date_el = parent.find(
                    class_=re.compile(r"date|time|publish", re.IGNORECASE)
                )
                if date_el:
                    raw_date = date_el.get_text(strip=True)
                else:
                    date_match = re.search(
                        r'(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})',
                        parent.get_text(),
                    )
                    if date_match:
                        raw_date = date_match.group(0)

            records.append({
                "title": text[:500],
                "url": full_url,
                "date": raw_date,
                "raw_text": text,
                "source_label": source_label,
            })

        self.log.info(
            f"Parsed {source_label} news",
            extra={
                "total_links": len(seen_urls),
                "pharma_notices": len(records),
            },
        )
        return records

    def _parse_withdrawal_page(self, html: str) -> list[dict]:
        """Parse the MOHAP pharmaceutical product withdrawal page."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        # Look for list items, table rows, or paragraphs with product info
        content_area = (
            soup.find("div", class_=re.compile(r"journal-content|article-body|web-content"))
            or soup.find("main")
            or soup
        )

        # Look for lists of withdrawn products
        list_items = content_area.find_all(["li", "tr", "p"])
        for item in list_items:
            text = item.get_text(separator=" ", strip=True)
            text_lower = text.lower()

            if not any(
                kw in text_lower
                for kw in [
                    "withdraw", "recall", "non-compliance",
                    "pharmaceutical", "drug", "medicine", "product",
                ]
            ):
                continue

            if len(text) < 10:
                continue

            raw_date = None
            date_match = re.search(
                r'(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})',
                text,
            )
            if date_match:
                raw_date = date_match.group(0)

            records.append({
                "title": text[:500],
                "url": self.MOHAP_WITHDRAWAL_URL,
                "date": raw_date,
                "raw_text": text,
                "source_label": "MOHAP-Withdrawal",
            })

        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize UAE records into standard shortage event dicts."""
        self.log.info(
            "Normalising UAE records",
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
                    "Failed to normalise UAE record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single UAE record to a normalised shortage event dict."""
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
        source_label = rec.get("source_label", "")
        if source_label:
            notes_parts.append(f"Source: {source_label}")
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
        """Map UAE reason string to canonical reason_category."""
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
        if any(w in lower for w in ("secure", "sufficient", "stable")):
            return "resolved"
        return "active"

    def _extract_drug_name(self, text: str) -> str:
        """
        Extract a drug name (INN) from UAE notice text.

        Looks for uppercase or capitalized drug name patterns typical
        in English pharmaceutical notices.
        """
        # Look for words that look like drug names (capitalized Latin sequences)
        matches = re.findall(
            r'\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*)\b', text
        )
        # Filter out common English/contextual words
        stopwords = {
            "Ministry", "Health", "Prevention", "Drug", "Shortage",
            "Notice", "Notification", "Circular", "Alert", "Update",
            "United", "Arab", "Emirates", "UAE", "MOHAP", "EDE", "The",
            "Pharmaceutical", "Product", "Supply", "Available",
            "Important", "Urgent", "Information", "Please", "Dear",
            "Establishment", "Strategic", "Stockpile", "Secure",
            "Sufficient", "National", "Field", "Visits", "Conducts",
            "Manufacturers", "Inspect", "Production", "Capacity",
            "Future", "Expansion", "Plans", "Breaks", "Monopoly",
            "Medical", "Products", "Country", "Mubadala", "Limited",
            "Sign", "Develop", "Manufacturing", "Innovation",
            "Showcases", "Insilico", "Project", "Signs", "Advance",
            "Cooperation", "Agreement", "Association", "World",
            "Expo", "Strengthens", "International", "Partnerships",
            "Organ", "Chip", "Launch", "Officially", "Unveil",
            "Initiatives", "Zayed", "Humanitarian", "Day", "Reinforces",
            "Enduring", "Commitment", "Giving", "Serving", "Humanity",
            "Saeed", "Mubarak", "Hajeri", "Holds", "Bilateral",
            "Meetings", "Partners", "Launches", "News", "Services",
        }
        for match in matches:
            if match not in stopwords and len(match) > 2:
                return match
        return ""

    def _extract_brand_name(self, text: str) -> str:
        """Extract brand/trade name from text if present."""
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
            "production capacity":   "Production capacity concern",
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
            "non-compliance":        "Non-compliance withdrawal",
            "withdrawal":            "Product withdrawal",
            "discontinuation":       "Discontinuation",
            "discontinued":          "Discontinuation",
            "monopoly":              "Market monopoly concern",
            "stockpile":             "Strategic stockpile update",
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
        print("Fetches live EDE/MOHAP data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = UAEMOHAPScraper(db_client=MagicMock())

        print("\n-- Fetching from EDE + MOHAP ...")
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
