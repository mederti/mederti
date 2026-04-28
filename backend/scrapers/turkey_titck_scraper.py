"""
TITCK Turkey Drug Supply Scraper
---------------------------------
Source:  TITCK - Turkish Medicines and Medical Devices Agency
URL:     https://www.titck.gov.tr/

TITCK (Turkiye Ilac ve Tibbi Cihaz Kurumu) does NOT publish a public,
machine-readable list of individual drug shortages. Their drug supply
shortage data is managed through the EBS system (ebs.titck.gov.tr)
which requires authentication and is not publicly accessible.

What IS publicly available:
  1. Announcements (duyuru) from the "Ekonomik Degerlendirmeler ve Ilac
     Tedarik Yonetimi Dairesi Baskanligi" (Economic Evaluations and Drug
     Supply Management Department) via a JSON search API.
  2. The "Ilac Tedarik Sorunlari" (Drug Supply Problems) info page, which
     simply links to the EBS system for shortage declarations.

This scraper uses the TITCK searchAnnouncement JSON API to find
announcements from the Drug Supply Management Department, then fetches
each detail page to extract any drug-specific information or attached
documents. These are regulatory notices (import rules, pricing updates,
supply declarations) -- not individual drug shortage records like FDA/TGA.

Data source UUID:  10000000-0000-0000-0000-000000000054
Country:           Turkey
Country code:      TR
Confidence:        55/100 (regulatory notices, not drug-level shortage data)

API endpoint:
    GET https://www.titck.gov.tr/searchAnnouncement?term=...&lastId=0
    Returns JSON array of {Id, title, description, created_at, yayinlayan}

Detail pages:
    https://www.titck.gov.tr/duyuru/<slug>

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

    RATE_LIMIT_DELAY: float = 3.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "2.0.0"

    # JSON search API for announcements
    SEARCH_API_URL: str = "https://www.titck.gov.tr/searchAnnouncement"

    # Search terms to find drug supply management announcements
    _SEARCH_TERMS: list[str] = [
        "ilac tedarik",     # drug supply
        "tedarik kisiti",   # supply restriction
        "ilac arzi",        # drug supply
    ]

    # The publisher name for the Drug Supply Management Department
    _SUPPLY_DEPT: str = "tedarik yonetimi"

    # Turkish reason terms -> canonical reason_category
    _REASON_MAP: dict[str, str] = {
        "uretim sorunu":           "manufacturing_issue",
        "uretim":                  "manufacturing_issue",
        "imalat":                  "manufacturing_issue",
        "hammadde":                "raw_material",
        "hammadde temini":         "raw_material",
        "tedarik sorunu":          "supply_chain",
        "tedarik kisiti":          "supply_chain",
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

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch TITCK drug supply management announcements via JSON API.

        Strategy:
        1. Call the searchAnnouncement JSON API with supply-related terms.
        2. Deduplicate results by announcement ID.
        3. Filter for announcements from the Drug Supply Management Department.
        4. Fetch each detail page for additional context (attached docs, content).
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "api_url": self.SEARCH_API_URL,
        })

        seen_ids: set[int] = set()
        all_results: list[dict] = []

        for term in self._SEARCH_TERMS:
            try:
                results = self._search_announcements(term)
                for item in results:
                    item_id = item.get("Id")
                    if item_id and item_id not in seen_ids:
                        seen_ids.add(item_id)
                        all_results.append(item)
            except Exception as exc:
                self.log.warning(
                    "Search term failed",
                    extra={"term": term, "error": str(exc)},
                )

        # Filter: keep only announcements from the Drug Supply Management Dept
        supply_notices = self._filter_supply_department(all_results)

        self.log.info(
            "TITCK fetch complete",
            extra={
                "total_search_results": len(all_results),
                "supply_dept_notices": len(supply_notices),
            },
        )

        # Fetch detail pages for richer content
        enriched: list[dict] = []
        for notice in supply_notices:
            enriched_notice = self._enrich_with_detail(notice)
            enriched.append(enriched_notice)

        return enriched

    def _search_announcements(self, term: str) -> list[dict]:
        """Call the TITCK searchAnnouncement API."""
        resp = self._get(self.SEARCH_API_URL, params={"term": term, "lastId": 0})
        data = resp.json()
        if not isinstance(data, list):
            self.log.warning(
                "Unexpected API response type",
                extra={"term": term, "type": type(data).__name__},
            )
            return []
        self.log.debug(
            "Search API returned results",
            extra={"term": term, "count": len(data)},
        )
        return data

    def _filter_supply_department(self, results: list[dict]) -> list[dict]:
        """Keep only announcements from the Drug Supply Management Department."""
        filtered = []
        for item in results:
            publisher = item.get("yayinlayan", "")
            publisher_norm = self._normalize_turkish(publisher).lower()
            # "Ekonomik Degerlendirmeler ve Ilac Tedarik Yonetimi Dairesi"
            if self._SUPPLY_DEPT in publisher_norm:
                filtered.append(item)
        return filtered

    def _enrich_with_detail(self, notice: dict) -> dict:
        """Fetch the detail page for an announcement and extract extra info."""
        notice_id = notice.get("Id")
        if not notice_id:
            return notice

        # Build the detail URL using the slug format
        # The duyuru links use ID-based URLs: /duyuru/<id>
        # But also slug-based. The ID-based URL works fine.
        detail_url = f"https://www.titck.gov.tr/duyuru/{notice_id}"

        try:
            resp = self._get(detail_url)
            detail_data = self._parse_detail_page(resp.text, detail_url)
            notice["detail"] = detail_data
            notice["detail_url"] = detail_url
        except Exception as exc:
            self.log.debug(
                "Could not fetch detail page",
                extra={"id": notice_id, "error": str(exc)},
            )
            notice["detail"] = {}
            notice["detail_url"] = detail_url

        return notice

    def _parse_detail_page(self, html: str, url: str) -> dict:
        """Extract content and attachments from a duyuru detail page."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")

        # Remove nav/footer
        for el in soup.find_all(["nav", "footer"]):
            el.decompose()

        # Extract the announcement body text
        body_text = ""
        # TITCK detail pages have the content after the title h1
        h1 = soup.find("h1")
        if h1:
            # Get sibling content after h1
            parent = h1.parent
            if parent:
                body_text = parent.get_text(separator=" ", strip=True)

        if not body_text:
            body_text = soup.get_text(separator=" ", strip=True)

        # Extract attached PDF/Excel files from the announcement area
        attachments: list[dict] = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/storage/Archive/" in href and "/announcement/" in href:
                # This is an announcement-specific attachment (not sidebar content)
                attachments.append({
                    "url": href if href.startswith("http") else f"https://titck.gov.tr{href}",
                    "name": a.get_text(strip=True)[:200],
                    "type": "pdf" if ".pdf" in href.lower() else "xlsx" if ".xlsx" in href.lower() else "doc",
                })

        return {
            "body_text": body_text[:2000],
            "attachments": attachments,
        }

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize TITCK announcements into standard shortage event dicts.

        Note: These are regulatory announcements, not individual drug shortage
        records. Each announcement becomes one event with the announcement title
        as the drug/topic name. Confidence is set low (55) to reflect this.
        """
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
        """Convert a single TITCK announcement to a normalised shortage event."""
        title = (rec.get("title") or "").strip()
        if not title:
            return None

        description = (rec.get("description") or "").strip()
        publisher = (rec.get("yayinlayan") or "").strip()
        detail = rec.get("detail", {})
        body_text = detail.get("body_text", "")
        attachments = detail.get("attachments", [])

        # Combine all text for analysis
        full_text = f"{title} {description} {body_text}"

        # -- Drug/topic name --
        # TITCK announcements are regulatory notices, not drug-level
        # shortage records. We use a meaningful topic name rather than
        # trying to extract drug names from Turkish regulatory text.
        desc_norm = self._normalize_turkish(description).lower().strip()
        boilerplate_descs = {"duyuru", "hakkinda duyuru", "hakkinda", ""}
        if description and desc_norm not in boilerplate_descs:
            generic_name = description[:100]
        else:
            generic_name = self._clean_title_for_name(title)

        # -- Brand names --
        brand_names: list[str] = []
        brand = self._extract_brand_name(full_text)
        if brand and brand != generic_name:
            brand_names.append(brand)

        # -- Reason extraction --
        raw_reason = self._extract_reason(full_text)
        reason_category = self._map_reason(raw_reason)

        # -- Start date from API created_at field --
        raw_date = rec.get("created_at")
        start_date = self._parse_date(raw_date) or today

        # -- Status --
        status = self._determine_status(full_text)

        # -- Source URL --
        source_url = rec.get("detail_url") or self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        notes_parts.append(f"TITCK announcement from {publisher}")
        if description and description.lower() not in ("duyuru", "hakkinda duyuru"):
            notes_parts.append(f"Desc: {description[:150]}")
        if raw_reason:
            notes_parts.append(f"Reason: {raw_reason}")
        if attachments:
            att_names = [a["name"] for a in attachments[:3]]
            notes_parts.append(f"Attachments: {'; '.join(att_names)}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             brand_names,
            "status":                  status,
            "severity":                "low",
            "reason":                  raw_reason or "Supply management notice",
            "reason_category":         reason_category or "regulatory_action",
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 55,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _clean_title_for_name(self, title: str) -> str:
        """Clean a Turkish announcement title into a usable name.

        Since TITCK announcements are regulatory notices (not drug-level
        shortage records), we use the announcement title/topic as the name.
        """
        # Normalize the title for matching
        # IMPORTANT: normalize Turkish chars BEFORE lowering, because
        # Python's str.lower() doesn't handle Turkish İ -> i correctly
        # (it produces "i\u0307" combining dot above instead of plain "i")
        title_norm = self._normalize_turkish(title).lower().strip()

        # Boilerplate titles that are just "TO THE ATTENTION OF..."
        # These contain no useful subject information
        boilerplate_exact = {
            "ilac firmalarinin dikkatine",
            "tum firmalarin dikkatine",
            "ruhsat sahibi firmalarin dikkatine",
            "tum paydaslarimizin dikkatine",
            "kamuoyunun dikkatine",
            "doku ve hucre merkezlerinin dikkatine",
            "firmalarin dikkatine",
        }

        if title_norm in boilerplate_exact:
            return "TITCK Supply Management Notice"

        # Use the original title (with proper casing)
        cleaned = title.strip()
        if not cleaned or len(cleaned) < 5:
            cleaned = "TITCK Supply Management Notice"

        return cleaned[:100]

    def _map_reason(self, raw: str) -> str:
        """Map Turkish reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = self._normalize_turkish(raw.strip()).lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    def _determine_status(self, text: str) -> str:
        """Determine shortage status from Turkish text."""
        lower = self._normalize_turkish(text).lower()
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
        matches = re.findall(
            r'\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)*)\b', text
        )
        # Filter out common Turkish words and boilerplate
        turkish_stopwords = {
            "Hakkinda", "Duyuru", "Bilgilendirme", "Ilac", "Urun",
            "Bakanligi", "Kurumu", "Turkiye", "Saglik", "Piyasa",
            "Tedariksizlik", "Kesinti", "Tedarik", "Geri", "Cekme",
            "Firmalarinin", "Dikkatine", "Ruhsat", "Sahibi", "Tum",
            "Ekonomik", "Degerlendirmeler", "Yonetimi", "Dairesi",
            "Baskanligi", "Kilavuz", "Yonetmelik", "Madde", "Revizyon",
            "Basvuru", "Piyasaya", "Sunum", "Ithalat", "Duyurulur",
            "Ilgililere", "PDF", "XLSX", "Belgesi", "Listesi",
            "Kayitli", "Anasayfa", "Duyurular", "Haberler", "Titck",
            "Yurt", "Ruhsatlandirma", "Daire", "Beseri", "Tibbi",
            "Urunler", "Hucre", "Doku", "Merkez", "Merkezlerinin",
            "Kamuoyunun", "Firmalarin", "Paydaslarimizin", "Taraflarin",
            "Klinik", "Arastirma", "Komisyonu", "Etik", "Genel",
            "Mudurlugu", "Hizmetleri", "Baskan", "Yardimciligi",
            "Yilinda", "Kapsaminda", "Iliskin", "Sayili", "Tarihli",
            "Formulleri", "Tablolari", "Formu", "Sistemi", "Programi",
            "Sertifikasi", "Belgesi", "Protokolu", "Surecleri",
            "Referans", "Bazli", "Fiyat", "Fiyatlandirma",
            "Gercek", "Yasam", "Verileri", "Farmakoekonomik",
            "Analiz", "Calismalari", "Dokulari", "Hucreleri",
            "Insan", "Kaynakli", "Ileri", "Tedavi", "Uretim",
        }
        for match in matches:
            if match not in turkish_stopwords and len(match) > 2:
                return match
        return ""

    def _extract_brand_name(self, text: str) -> str:
        """Extract brand/trade name from text if present."""
        quoted = re.search(r'["\u201c]([^"\u201d]+)["\u201d]', text)
        if quoted:
            return quoted.group(1).strip()[:100]
        paren = re.search(r'\(([A-Za-z][A-Za-z\s]+)\)', text)
        if paren:
            return paren.group(1).strip()[:100]
        return ""

    def _extract_reason(self, text: str) -> str:
        """Extract shortage reason from Turkish text."""
        lower = self._normalize_turkish(text).lower()

        reason_phrases = {
            "uretim sorunu": "Manufacturing issue",
            "hammadde temini": "Raw material supply issue",
            "hammadde": "Raw material issue",
            "tedarik sorunu": "Supply chain issue",
            "tedarik kisiti": "Supply restriction",
            "tedarik zinciri": "Supply chain disruption",
            "ithalat sorunu": "Import issue",
            "ithalat basvuru": "Import application process",
            "dagitim sorunu": "Distribution issue",
            "talep artisi": "Increased demand",
            "geri cekme": "Product withdrawal",
            "ruhsat sorunu": "Licensing issue",
            "fiyat": "Pricing/reimbursement update",
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

        # ISO datetime from API: "2026-03-02 10:33:20"
        iso_match = re.match(r'(\d{4})-(\d{2})-(\d{2})', raw_str)
        if iso_match:
            try:
                year, month, day = iso_match.groups()
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

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
        print()
        print("NOTE: TITCK does not publish a public drug shortage list.")
        print("The EBS system (ebs.titck.gov.tr) with shortage data requires")
        print("authentication. This scraper collects announcements from the")
        print("Drug Supply Management Department as a proxy signal.")
        print("=" * 60)

        scraper = TurkeyTITCKScraper(db_client=MagicMock())

        print("\n-- Fetching from TITCK searchAnnouncement API ...")
        raw = scraper.fetch()
        print(f"-- Raw records received : {len(raw)}")

        print("-- Normalising records ...")
        events = scraper.normalize(raw)
        print(f"-- Normalised events    : {len(events)}")

        if events:
            print("\n-- Sample events (raw_record omitted):")
            for i, ev in enumerate(events[:5]):
                sample = {k: v for k, v in ev.items() if k != "raw_record"}
                print(f"\n  Event {i + 1}:")
                print(json.dumps(sample, indent=4, default=str))

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
