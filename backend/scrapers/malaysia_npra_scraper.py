"""
Malaysia NPRA Drug Shortage Scraper
------------------------------------
Source:  National Pharmaceutical Regulatory Agency - Product Availability
URL:     https://www.npra.gov.my/

The Malaysian National Pharmaceutical Regulatory Agency (NPRA) publishes
product availability notices, drug shortage alerts, and supply disruption
notifications. Content is bilingual (Malay/English).

Data source UUID:  10000000-0000-0000-0000-000000000056
Country:           Malaysia
Country code:      MY
Confidence:        76/100

Malay key terms:
    ubat       = medicine/drug
    bekalan    = supply
    kekurangan = shortage
    produk     = product
    ketersediaan = availability
    penarikan  = withdrawal

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class MalaysiaNPRAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000056"
    SOURCE_NAME: str  = "National Pharmaceutical Regulatory Agency \u2014 Product Availability"
    BASE_URL: str     = "https://www.npra.gov.my/"
    COUNTRY: str      = "Malaysia"
    COUNTRY_CODE: str = "MY"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # NPRA notices / announcements page
    NOTICES_URL: str = "https://www.npra.gov.my/index.php/en/health-professionals/safety-alertsen.html"

    # Known NPRA shortage reasons -> reason_category
    _REASON_MAP: dict[str, str] = {
        "manufacturing issue":        "manufacturing_issue",
        "manufacturing delay":        "manufacturing_issue",
        "production issue":           "manufacturing_issue",
        "production delay":           "manufacturing_issue",
        "masalah pengeluaran":        "manufacturing_issue",
        "supply chain":               "supply_chain",
        "supply disruption":          "supply_chain",
        "import delay":               "supply_chain",
        "masalah bekalan":            "supply_chain",
        "rantaian bekalan":           "supply_chain",
        "global shortage":            "supply_chain",
        "raw material":               "raw_material",
        "raw material shortage":      "raw_material",
        "bahan mentah":               "raw_material",
        "demand increase":            "demand_surge",
        "increased demand":           "demand_surge",
        "high demand":                "demand_surge",
        "permintaan tinggi":          "demand_surge",
        "distribution":               "distribution",
        "distribution issue":         "distribution",
        "pengedaran":                 "distribution",
        "regulatory":                 "regulatory_action",
        "registration":               "regulatory_action",
        "recall":                     "regulatory_action",
        "penarikan":                  "regulatory_action",
        "withdrawal":                 "regulatory_action",
        "discontinuation":            "discontinuation",
        "discontinued":               "discontinuation",
        "dihentikan":                 "discontinuation",
        "pemberhentian":              "discontinuation",
    }

    # Keywords indicating drug shortage / supply issues (English + Malay)
    _SHORTAGE_KEYWORDS: list[str] = [
        "shortage",
        "supply",
        "unavailable",
        "unavailability",
        "disruption",
        "discontinue",
        "recall",
        "withdraw",
        "drug",
        "medicine",
        "pharmaceutical",
        "product availability",
        "stock",
        "out of stock",
        # Malay terms
        "kekurangan",
        "bekalan",
        "ubat",
        "produk",
        "ketersediaan",
        "penarikan",
    ]

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch NPRA drug availability / shortage notices.

        Strategy:
        1. GET the NPRA safety alerts / notices page.
        2. Parse HTML with BeautifulSoup for notice items.
        3. Filter for drug shortage / availability related notices.
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
                "Failed to fetch NPRA notices page",
                extra={"error": str(exc), "url": self.NOTICES_URL},
            )
            raise ScraperError(f"NPRA fetch failed: {exc}") from exc

        self.log.info(
            "NPRA fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_notices_page(self, html: str) -> list[dict]:
        """Parse the NPRA safety alerts page (SPPageBuilder with year tabs)."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []
        seen_urls: set[str] = set()

        # Find all links that match the safety-alerts pattern
        # URL pattern: /safety-alerts-YYYY/NNNNNNN-drug-name-...
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            if "/safety-alerts-" not in href.lower():
                continue

            text = a_tag.get_text(strip=True)
            if not text or len(text) < 5:
                continue
            # Skip nav/header links
            if text.lower() in ("safety alerts", "english (uk)"):
                continue

            # Make absolute URL
            url = href if href.startswith("http") else f"https://www.npra.gov.my{href}"
            if url in seen_urls:
                continue
            seen_urls.add(url)

            # Extract year from URL path (safety-alerts-YYYY)
            year_match = re.search(r'safety-alerts-(\d{4})', href)
            year = year_match.group(1) if year_match else None

            # Extract drug name from URL slug
            # Pattern: /NNNNNNN-drug-name-risk-of-something.html
            slug_match = re.search(r'/\d+-(.+?)(?:\.html)?$', href)
            drug_name = ""
            reason_from_slug = ""
            if slug_match:
                slug = slug_match.group(1).replace("-", " ")
                # Drug name is typically the first part before risk/safety phrases
                for sep in ("risk of", "safety update", "potential risk",
                            "contraindication", "recall", "withdrawal",
                            "precaution", "warning", "restriction",
                            "and biosimilar", "interaction"):
                    if sep in slug.lower():
                        parts = slug.lower().split(sep, 1)
                        drug_name = parts[0].strip().title()
                        reason_from_slug = (sep + parts[1]).strip()
                        break
                if not drug_name:
                    # Use the link text as drug name (it's usually cleaner)
                    drug_name = text.split(":")[0].strip() if ":" in text else text[:80]

            records.append({
                "title": text[:500],
                "drug_name": drug_name or text.split(":")[0].strip()[:80],
                "url": url,
                "year": year,
                "reason_from_slug": reason_from_slug,
                "raw_text": text,
            })

        self.log.info(
            "Parsed NPRA safety alerts",
            extra={"total_links": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize NPRA records into standard shortage event dicts."""
        self.log.info(
            "Normalising NPRA records",
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
                    "Failed to normalise NPRA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single NPRA record to a normalised shortage event dict."""
        title = rec.get("title", "").strip()
        raw_text = rec.get("raw_text", "").strip()

        if not title:
            return None

        # -- Drug name extraction --
        generic_name = rec.get("drug_name") or ""
        if not generic_name:
            generic_name = self._extract_drug_name(title)
        if not generic_name:
            generic_name = self._extract_drug_name(raw_text)
        if not generic_name:
            generic_name = title.split(":")[0].strip()[:100] if ":" in title else title[:100]

        # -- Brand names --
        brand_names: list[str] = []
        brand = self._extract_brand_name(raw_text)
        if brand and brand != generic_name:
            brand_names.append(brand)

        # -- Reason extraction --
        raw_reason = rec.get("reason_from_slug") or self._extract_reason(raw_text)
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
            "source_confidence_score": 76,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map NPRA reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    def _determine_status(self, text: str) -> str:
        """Determine shortage status from notice text (English + Malay)."""
        lower = text.lower()
        if any(w in lower for w in (
            "resolved", "restored", "available again", "resumed",
            "diselesaikan", "dipulihkan",
        )):
            return "resolved"
        if any(w in lower for w in (
            "anticipated", "expected", "upcoming", "potential",
            "dijangka", "berpotensi",
        )):
            return "anticipated"
        return "active"

    def _extract_drug_name(self, text: str) -> str:
        """
        Extract a drug name (INN) from NPRA notice text.

        Looks for uppercase or capitalized drug name patterns typical
        in English/Malay pharmaceutical notices.
        """
        # Look for words that look like drug names (capitalized Latin sequences)
        matches = re.findall(
            r'\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*)\b', text
        )
        # Filter out common English/Malay contextual words
        stopwords = {
            "National", "Pharmaceutical", "Regulatory", "Agency", "NPRA",
            "Drug", "Shortage", "Notice", "Alert", "Update", "Safety",
            "Product", "Availability", "Malaysia", "Ministry", "Health",
            "The", "Important", "Urgent", "Information", "Please",
            "Dear", "Kementerian", "Kesihatan", "Ubat", "Produk",
            "Ketersediaan", "Bekalan", "Makluman", "Peringatan",
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
        """Extract shortage reason from notice text (English + Malay)."""
        lower = text.lower()

        reason_phrases = {
            "manufacturing issue":     "Manufacturing issue",
            "manufacturing delay":     "Manufacturing delay",
            "production issue":        "Production issue",
            "masalah pengeluaran":     "Manufacturing issue",
            "supply chain":            "Supply chain disruption",
            "supply disruption":       "Supply disruption",
            "masalah bekalan":         "Supply issue",
            "rantaian bekalan":        "Supply chain issue",
            "import delay":            "Import delay",
            "global shortage":         "Global shortage",
            "raw material":            "Raw material shortage",
            "bahan mentah":            "Raw material shortage",
            "increased demand":        "Increased demand",
            "high demand":             "High demand",
            "permintaan tinggi":       "High demand",
            "distribution issue":      "Distribution issue",
            "pengedaran":              "Distribution issue",
            "recall":                  "Product recall",
            "penarikan":               "Product withdrawal",
            "regulatory":              "Regulatory action",
            "discontinuation":         "Discontinuation",
            "discontinued":            "Discontinuation",
            "dihentikan":              "Discontinuation",
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

        # DD/MM/YYYY or DD-MM-YYYY (common in Malaysia)
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
        print("Fetches live NPRA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = MalaysiaNPRAScraper(db_client=MagicMock())

        print("\n-- Fetching from NPRA ...")
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

    scraper = MalaysiaNPRAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
