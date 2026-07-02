"""
Sri Lanka NMRA Announcements Scraper
-------------------------------------
Source:  National Medicines Regulatory Authority (NMRA) - Announcements
URL:     https://www.nmra.gov.lk/announcements

The NMRA publishes a single chronological "Announcements" feed (Webflow CMS
collection, rendered server-side across category tabs: Regulatory Updates,
Press Releases, NMRA Updates, Public Consultation, etc). There is NO
dedicated shortage-only list — registration approvals, appointment-system
maintenance notices, recall/revocation database links, and public hearings
are all mixed into the same feed as genuine drug shortage notices.

Each announcement is rendered as a card with a "Read Announcement" button
that opens a modal containing the full notice text (and, occasionally,
PDF attachment links). All tab panes and modal contents are present in the
initial HTML response (Webflow renders them server-side and hides inactive
tabs/modals via CSS) so a single GET returns the full feed — no pagination
or JS execution required.

This scraper fetches the FULL announcements feed in fetch() and filters to
genuinely shortage-related items in normalize(), following the same
keyword-filter-a-general-feed pattern as malaysia_npra_scraper.py. Given how
unstructured this source is (no shortage-specific list, no drug-code
taxonomy), most feed items are correctly excluded — a handful of confirmed
shortage notices is the expected, honest yield.

Language is mostly English; some notices may appear in Sinhala/Tamil, so a
small set of Sinhala/Tamil shortage-adjacent terms is included defensively
even though none were observed in the live feed at time of writing.

Sinhala/Tamil key terms (defensive, not yet observed live):
    Sinhala:
        hadisi        = shortage/scarcity  (හදිසි)
        nomැthikama    = unavailability      (නොමැතිකම)
    Tamil:
        pattram (பற்றாக்குறை) = shortage

Data source UUID:  10000000-0000-0000-0000-000000000117
Country:           Sri Lanka
Country code:      LK

Cron:  Not yet wired (integrated separately).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class SriLankaNMRAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000117"
    SOURCE_NAME: str  = "NMRA — Announcements (Sri Lanka)"
    BASE_URL: str     = "https://www.nmra.gov.lk/announcements"
    COUNTRY: str      = "Sri Lanka"
    COUNTRY_CODE: str = "LK"

    RATE_LIMIT_DELAY: float = 2.5
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Strong, precise phrases — deliberately narrow. The general keyword list
    # below ("shortage", "stock", "supply", ...) catches too much noise on
    # this feed (appointment-system "unavailable" notices, "supply of
    # therapeutic goods" policy drafts, manufacturing-data requests, etc.),
    # so a title/body match against these phrases is required before an item
    # is treated as a genuine shortage notice.
    _STRONG_SHORTAGE_PHRASES: list[str] = [
        "shortage of",
        "shortage in the country",
        "national shortage",
        "critical shortage",
        "acute shortage",
        "out of stock",
        "stock out",
        "stock-out",
        "non-availability of",
        "unavailability of the medicine",
        "unavailability of medicine",
        "temporary unavailability of",
        # Sinhala / Tamil (defensive — not observed live at time of writing)
        "හදිසි",   # hadisi (shortage/scarcity)
        "பற்றாக்குறை",  # pattrakkurai (Tamil: shortage)
    ]

    # Weaker signal words — used only to decide whether it's worth running
    # the strong-phrase check at all (cheap short-circuit), NOT as a
    # standalone inclusion criterion.
    _WEAK_SIGNAL_WORDS: list[str] = [
        "shortage",
        "unavailab",
        "out of stock",
        "stock out",
        "supply",
        "discontinu",
    ]

    # Explicit exclusions — feed items that trip the weak-signal words but
    # are never genuine drug-shortage notices on this source.
    _EXCLUDE_PATTERNS: list[str] = [
        "recall and revocation database",
        "appointment system",
        "file submission services",
        "manufacturing and distribution data",
        "home delivery service",
        "public hearing",
    ]

    _REASON_MAP: dict[str, str] = {
        "manufacturing":   "manufacturing_issue",
        "production":      "manufacturing_issue",
        "quality":         "manufacturing_issue",
        "raw material":    "raw_material",
        "supply chain":    "supply_chain",
        "import":          "distribution",
        "distribution":    "distribution",
        "demand":          "demand_surge",
        "registration":    "regulatory_action",
        "regulatory":      "regulatory_action",
        "recall":          "regulatory_action",
        "withdraw":        "regulatory_action",
        "discontinu":      "discontinuation",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the full NMRA announcements feed.

        The page is a Webflow site with category tabs (Regulatory Updates,
        Press Releases, NMRA Updates, Public Consultation, ...). All tabs'
        content and each announcement's modal body are rendered server-side
        in the same response, so a single GET is sufficient — no pagination,
        no JS execution needed.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        try:
            resp = self._get(self.BASE_URL)
            records = self._parse_announcements_page(resp.text)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch NMRA announcements page",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            raise ScraperError(f"NMRA fetch failed: {exc}") from exc

        self.log.info("NMRA fetch complete", extra={"records": len(records)})
        return records

    def _parse_announcements_page(self, html: str) -> list[dict]:
        """Parse every announcement card on the NMRA announcements page.

        Each card (`.announcement_container`) has:
            .udesly-overline-large           category label
            h4.udesly-text-extrabold         title
            .udesly-paragraph-small          published date ("Month D, YYYY")
            .announcement_modal .newstext    full notice body (rich text)
                                              (may contain PDF links)
        """
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        cards = soup.select(".announcement_container")
        for card in cards:
            title_el = card.select_one("h4")
            title = title_el.get_text(strip=True) if title_el else ""
            if not title:
                continue

            category_el = card.select_one(".udesly-overline-large")
            category = category_el.get_text(strip=True) if category_el else ""

            date_el = card.select_one(".udesly-paragraph-small")
            date_str = date_el.get_text(strip=True) if date_el else ""

            body_el = card.select_one(".newstext")
            body = body_el.get_text(separator=" ", strip=True) if body_el else ""

            pdf_links = [
                a["href"] for a in card.find_all("a", href=True)
                if ".pdf" in a["href"].lower()
            ]

            records.append({
                "title":      title[:500],
                "category":   category,
                "date":       date_str,
                "body":       body,
                "pdf_links":  pdf_links,
                "url":        self.BASE_URL,
            })

        self.log.info(
            "Parsed NMRA announcements",
            extra={"total_cards": len(cards), "records": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Filter the full announcements feed down to genuine drug-shortage
        notices and normalize those into standard shortage event dicts.

        Non-shortage announcements (product registration policy, recall
        database links, appointment-system maintenance, public hearings,
        manufacturing-data requests, etc.) are skipped rather than forced
        into the schema.
        """
        self.log.info(
            "Normalising NMRA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0
        today = date.today().isoformat()

        for rec in raw:
            try:
                if not self._is_genuine_shortage(rec):
                    skipped += 1
                    continue
                result = self._normalise_record(rec, today)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise NMRA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _is_genuine_shortage(self, rec: dict) -> bool:
        """Decide whether an announcement is a genuine drug-shortage notice.

        Two-stage filter:
          1. Cheap short-circuit — does the combined text contain ANY weak
             signal word at all? If not, skip immediately (fast path for the
             large majority of unrelated announcements).
          2. Precise check — does it contain a strong shortage phrase, AND
             not match one of the known false-positive exclusion patterns?
        """
        title = rec.get("title", "")
        body = rec.get("body", "")
        combined = f"{title} {body}".lower()

        if not any(w in combined for w in self._WEAK_SIGNAL_WORDS):
            return False

        if any(ex in combined for ex in self._EXCLUDE_PATTERNS):
            return False

        return any(phrase in combined for phrase in self._STRONG_SHORTAGE_PHRASES)

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single confirmed-shortage NMRA record to a normalised
        shortage event dict."""
        title = rec.get("title", "").strip()
        body = rec.get("body", "").strip()

        if not title:
            return None

        generic_name = self._extract_drug_name(title, body)
        if not generic_name:
            # Too unstructured to safely attribute to a specific drug —
            # skip rather than force a bad drug record into the registry.
            self.log.warning(
                "Confirmed shortage notice but no drug name extracted — skipping",
                extra={"title": title[:200]},
            )
            return None

        raw_reason = self._extract_reason(title, body)
        reason_category = self._map_reason(raw_reason, body)

        start_date = self._parse_date(rec.get("date")) or today
        status = self._determine_status(body)

        source_url = rec.get("url") or self.BASE_URL
        pdf_links = rec.get("pdf_links") or []
        if pdf_links:
            source_url = pdf_links[0]

        notes_parts: list[str] = []
        if raw_reason:
            notes_parts.append(f"Reason: {raw_reason}")
        notes_parts.append(f"Title: {title[:200]}")
        if rec.get("category"):
            notes_parts.append(f"Category: {rec['category']}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             [],
            "status":                  status,
            "severity":                "medium",
            "reason":                  raw_reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 70,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _extract_drug_name(self, title: str, body: str) -> str:
        """
        Extract the drug/product name from a confirmed shortage notice.

        NMRA shortage notices observed so far follow the pattern:
            "Acceptance of Product Registration Applications for
             <Drug Name>"
        with the drug name repeated (often bolded, stripped to plain text
        by BeautifulSoup) in the body, e.g.:
            "The NMRA has identified a shortage of <Drug Name> in the
             country."

        Strategy: look for "shortage of X" in the body first (most direct
        signal), then fall back to a "for X" / "of X" tail on the title.
        """
        # 1. Direct "shortage of <drug>" in body text.
        match = re.search(
            r"shortage of\s+([A-Z][A-Za-z0-9\s\-/]{2,60}?)(?:\s+in\s+the\s+country|"
            r"\.|,|\bin\b\s+order|$)",
            body,
        )
        if match:
            return self._clean_drug_name(match.group(1))

        # 2. Non-availability / out-of-stock phrasing.
        match = re.search(
            r"(?:non-availability of|unavailability of(?: the medicine)?|"
            r"out of stock of|stock[- ]out of)\s+([A-Z][A-Za-z0-9\s\-/]{2,60}?)"
            r"(?:\s+in\s+the\s+country|\.|,|$)",
            body,
            re.IGNORECASE,
        )
        if match:
            return self._clean_drug_name(match.group(1))

        # 3. Fall back to title tail after "for"/"of".
        match = re.search(
            r"(?:for|of)\s+([A-Z][A-Za-z0-9\s\-/]{2,60})$",
            title,
        )
        if match:
            return self._clean_drug_name(match.group(1))

        return ""

    @staticmethod
    def _clean_drug_name(raw: str) -> str:
        name = raw.strip().strip(".,;:")
        # Trim trailing generic qualifiers that sometimes tag along.
        name = re.sub(
            r"\s+(with immediate effect|in the country)$", "", name, flags=re.IGNORECASE
        )
        return name.strip()

    def _extract_reason(self, title: str, body: str) -> str:
        """Extract a short human-readable reason phrase, if derivable."""
        combined = f"{title} {body}"
        lower = combined.lower()

        reason_phrases = {
            "manufacturing issue":  "Manufacturing issue",
            "manufacturing delay":  "Manufacturing delay",
            "production issue":     "Production issue",
            "raw material":         "Raw material shortage",
            "supply chain":         "Supply chain disruption",
            "import delay":         "Import delay",
            "increased demand":     "Increased demand",
            "high demand":          "High demand",
            "registration":         "Product registration gap",
            "distribution issue":   "Distribution issue",
            "discontinu":           "Discontinuation",
        }
        for phrase, english in reason_phrases.items():
            if phrase in lower:
                return english

        # NMRA's characteristic remediation phrasing implies the underlying
        # cause is a registration/regulatory gap even when not stated
        # explicitly (e.g. the Lignocaine Throat Spray notice).
        if "accepting and evaluating product registration applications" in lower:
            return "Product registration gap"

        return ""

    def _map_reason(self, raw_reason: str, body: str) -> str:
        """Map extracted reason text to canonical reason_category."""
        source_text = raw_reason or body
        if not source_text:
            return "unknown"
        lower = source_text.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return map_reason_category(source_text)

    def _determine_status(self, body: str) -> str:
        """Determine shortage status from notice body text."""
        lower = body.lower()
        if any(w in lower for w in (
            "resolved", "restored", "available again", "resumed", "stock replenished",
        )):
            return "resolved"
        if any(w in lower for w in (
            "anticipated", "expected", "upcoming", "potential", "may face",
        )):
            return "anticipated"
        return "active"

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse NMRA's 'Month D, YYYY' date format (e.g. 'September 17, 2025')
        to an ISO-8601 date string, with a few defensive fallbacks."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()

        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None

        # "Month D, YYYY" / "Month DD, YYYY"
        try:
            dt = datetime.strptime(raw_str, "%B %d, %Y")
            return dt.date().isoformat()
        except ValueError:
            pass

        # ISO format already
        iso_match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw_str)
        if iso_match:
            year, month, day = iso_match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
            except ValueError:
                pass

        # DD/MM/YYYY
        dmy_match = re.match(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", raw_str)
        if dmy_match:
            day, month, year = dmy_match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
            except ValueError:
                pass

        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str, dayfirst=False)
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
        print("Fetches live NMRA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = SriLankaNMRAScraper(db_client=MagicMock())

        print("\n-- Fetching from NMRA ...")
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
        else:
            print("\n-- No genuine shortage notices found in the current feed.")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = SriLankaNMRAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
