"""
TITCK Turkey Drug Shortage Scraper
-----------------------------------
Source:  TITCK - Turkish Medicines and Medical Devices Agency
URL:     https://www.titck.gov.tr/

TITCK (Turkiye Ilac ve Tibbi Cihaz Kurumu) publishes drug shortage and supply
problem notices on their website. Notices are typically in Turkish and contain
information about drugs experiencing supply disruptions, withdrawals, and
availability issues.

Data source UUID:  10000000-0000-0000-0000-000000000054
Country:           Turkey
Country code:      TR
Confidence:        76/100

Turkish key terms:
    ilac       = drug
    tedarik    = supply
    kesinti    = disruption
    geri cekme = withdrawal
    eksiklik   = shortage
    urun       = product

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class TurkeyTITCKScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000054"
    SOURCE_NAME: str  = "TITCK \u2014 Turkish Medicines and Medical Devices Agency"
    BASE_URL: str     = "https://www.titck.gov.tr/"
    COUNTRY: str      = "Turkey"
    COUNTRY_CODE: str = "TR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Announcement page for drug shortage / supply notices
    NOTICES_URL: str = "https://www.titck.gov.tr/duyuru"

    # Turkish reason terms -> canonical reason_category
    _REASON_MAP: dict[str, str] = {
        "uretim sorunu":           "manufacturing_issue",
        "uretim":                  "manufacturing_issue",
        "imalat":                  "manufacturing_issue",
        "hammadde":                "raw_material",
        "hammadde temini":         "raw_material",
        "tedarik sorunu":          "supply_chain",
        "tedarik":                 "supply_chain",
        "tedarik zinciri":         "supply_chain",
        "ithalat":                 "supply_chain",
        "dagitim":                 "distribution",
        "dagitim sorunu":          "distribution",
        "talep artisi":            "demand_surge",
        "talep":                   "demand_surge",
        "geri cekme":              "regulatory_action",
        "askiya alma":             "regulatory_action",
        "ruhsat":                  "regulatory_action",
        "durdurma":                "discontinuation",
        "uretimden kaldirilma":    "discontinuation",
        "piyasadan cekilme":       "discontinuation",
    }

    # Turkish terms that signal a drug shortage notice
    _SHORTAGE_KEYWORDS: list[str] = [
        "ilac",
        "tedarik",
        "kesinti",
        "eksiklik",
        "geri cekme",
        "bulunamamasi",
        "urun",
        "piyasa",
        "tedariksizlik",
    ]

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch TITCK drug shortage notices.

        Strategy:
        1. GET the TITCK announcements page.
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
                "Failed to fetch TITCK notices page",
                extra={"error": str(exc), "url": self.NOTICES_URL},
            )
            raise ScraperError(f"TITCK fetch failed: {exc}") from exc

        self.log.info(
            "TITCK fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_notices_page(self, html: str) -> list[dict]:
        """Parse the TITCK announcements page HTML for shortage notices."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        # Look for announcement/notice list items
        # TITCK typically uses list items or card elements for announcements
        notice_elements = (
            soup.select(".announcement-item")
            or soup.select(".duyuru-item")
            or soup.select(".news-item")
            or soup.select("article")
            or soup.select(".list-group-item")
            or soup.select("table tbody tr")
        )

        if not notice_elements:
            # Fallback: look for links containing shortage-related keywords
            notice_elements = soup.find_all("a", href=True)

        for el in notice_elements:
            text = el.get_text(separator=" ", strip=True)
            text_lower = self._normalize_turkish(text.lower())

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
                link = f"https://www.titck.gov.tr{link}"

            # Extract date if present
            raw_date = None
            date_el = el.find(class_=re.compile(r"date|tarih|time", re.IGNORECASE))
            if date_el:
                raw_date = date_el.get_text(strip=True)
            else:
                # Try to find a date pattern in text (DD.MM.YYYY or DD/MM/YYYY)
                date_match = re.search(
                    r'(\d{1,2})[./](\d{1,2})[./](\d{4})', text
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
            "Parsed TITCK notices",
            extra={"total_elements": len(notice_elements), "shortage_notices": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize TITCK records into standard shortage event dicts."""
        self.log.info(
            "Normalising TITCK records",
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
                    "Failed to normalise TITCK record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single TITCK record to a normalised shortage event dict."""
        title = rec.get("title", "").strip()
        raw_text = rec.get("raw_text", "").strip()

        if not title:
            return None

        # -- Drug name extraction --
        generic_name = self._extract_drug_name(title)
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
            "source_confidence_score": 76,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map Turkish reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = self._normalize_turkish(raw.strip().lower())
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    def _determine_status(self, text: str) -> str:
        """Determine shortage status from Turkish text."""
        lower = self._normalize_turkish(text.lower())
        if any(w in lower for w in ("cozuldu", "giderildi", "sona erdi", "tamamlandi")):
            return "resolved"
        if any(w in lower for w in ("beklenen", "ongorulen", "muhtemel")):
            return "anticipated"
        return "active"

    def _extract_drug_name(self, text: str) -> str:
        """
        Extract a drug name (INN) from Turkish notice text.

        Looks for Latin/English drug names which are typically uppercase or
        mixed case within Turkish text.
        """
        # Look for words that look like drug names (Latin/uppercase sequences)
        # Drug names in Turkish notices are typically in Latin script and uppercase
        matches = re.findall(
            r'\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*)\b', text
        )
        # Filter out common Turkish words that might match
        turkish_stopwords = {
            "Hakkinda", "Duyuru", "Bilgilendirme", "Ilac", "Urun",
            "Bakanligi", "Kurumu", "Turkiye", "Saglik", "Piyasa",
            "Tedariksizlik", "Kesinti", "Tedarik", "Geri", "Cekme",
        }
        for match in matches:
            if match not in turkish_stopwords and len(match) > 2:
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
        """Extract shortage reason from Turkish text."""
        lower = self._normalize_turkish(text.lower())

        reason_phrases = {
            "uretim sorunu": "Manufacturing issue",
            "hammadde temini": "Raw material supply issue",
            "hammadde": "Raw material issue",
            "tedarik sorunu": "Supply chain issue",
            "tedarik zinciri": "Supply chain disruption",
            "ithalat sorunu": "Import issue",
            "dagitim sorunu": "Distribution issue",
            "talep artisi": "Increased demand",
            "geri cekme": "Product withdrawal",
            "ruhsat sorunu": "Licensing issue",
            "uretimden kaldirilma": "Discontinuation",
            "piyasadan cekilme": "Market withdrawal",
        }

        for turkish, english in reason_phrases.items():
            if turkish in lower:
                return english

        return ""

    @staticmethod
    def _normalize_turkish(text: str) -> str:
        """
        Normalize Turkish characters for matching.

        Converts Turkish-specific characters to ASCII equivalents:
            \u0131 (dotless i) -> i
            \u015f -> s
            \u00e7 -> c
            \u00f6 -> o
            \u00fc -> u
            \u011f -> g
        """
        replacements = {
            "\u0131": "i", "\u0130": "I",
            "\u015f": "s", "\u015e": "S",
            "\u00e7": "c", "\u00c7": "C",
            "\u00f6": "o", "\u00d6": "O",
            "\u00fc": "u", "\u00dc": "U",
            "\u011f": "g", "\u011e": "G",
        }
        for src, dst in replacements.items():
            text = text.replace(src, dst)
        return text

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various Turkish date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None

        # Turkish date format: DD.MM.YYYY or DD/MM/YYYY
        match = re.match(r'(\d{1,2})[./](\d{1,2})[./](\d{4})', raw_str)
        if match:
            day, month, year = match.groups()
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
        print("Fetches live TITCK data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = TurkeyTITCKScraper(db_client=MagicMock())

        print("\n-- Fetching from TITCK ...")
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

    scraper = TurkeyTITCKScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
