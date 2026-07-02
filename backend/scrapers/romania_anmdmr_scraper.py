"""
ANMDMR Romania — Drug Discontinuity Notifications Scraper
------------------------------------------------------------------------
Source:  ANMDMR (Agenția Națională a Medicamentului și a Dispozitivelor
         Medicale din România) — Notificări discontinuitate medicamente
Page:    https://www.anm.ro/medicamente-de-uz-uman/autorizare-medicamente/
         notificari-discontinuitate-medicamente/
PDF:     A single CUMULATIVE PDF is linked from that page (filename carries
         the "last updated" date, e.g. "25.06.2026 Notificari Sunset
         pt.postat incepand cu luna IUNIE 2016_.pdf"). It is NOT a monthly
         release like CDSCO's NSQ reports — ANMDMR appends new rows to the
         same document going back to June 2016. As of this scraper's
         research pass (2026-07-02) it held 769 rows spanning 2016-09
         through 2026-06-25, so despite the site being "sparsely
         maintained" (per the seeded data_sources row), the underlying
         table is a genuine, actively-appended dataset — not empty.

The PDF link's <a href> is a relative, space-containing, non-URL-encoded
path taken straight from the page HTML — we percent-encode it and resolve
against BASE_URL before downloading. This scraper does NOT hardcode that
filename (the date in it changes every update); it re-derives the link
from the notification page on every run so a future re-upload with a new
filename/date is picked up automatically.

Table structure (verified via pdfplumber on the live PDF, 19 pages):
    Nr crt                                  Serial number
    Denumire comerciala                     Brand/commercial name
    Metop                                   Pharmaceutical form (dosage form)
    Concentratie                            Strength
    Firma Detinatoare                       Marketing-authorisation-holder company
    Tara Detinatoare                        MAH country
    DCI                                     INN / generic name (Denumire Comună
                                             Internațională) — used as generic_name
    Data adresa                             Notification date (dd.mm.yyyy)
    Tip Notificare                          Notification type — free text, may embed
                                             a resumption month ("... din Noiembrie 2019")
    Data estimativa de reluare a            Estimated resumption date, abbreviated
      comercializarii                       Romanian month-year ("aug.-26", "iun.-27",
                                             or occasionally "trimestrul II 2026")
    Observatii                              Reason — "Motive comerciale" (commercial
                                             reasons) or "Motive de fabricatie"
                                             (manufacturing reasons), sometimes blank

Romanian keywords relied on for status/reason classification:
    discontinuitate            = discontinuity / shortage (core term)
    discontinuitate permanenta = permanent discontinuation  -> status=resolved
                                  (drug is gone for good; not an active shortage
                                  to track, but recorded for history/notes)
    discontinuitate temporara  = temporary discontinuation  -> status=active
    prelungire discontinuitate
      temporara                = extension of temporary discontinuation
                                  ("prelungire" = extension/renewal) -> status=active
    cantitati limitate         = limited quantities -> status=active (partial supply)
    renuntare la app           = withdrawal of marketing authorisation
                                  ("APP" = Autorizație de Punere pe Piață) -> resolved
    decizie de suspendare a app = decision suspending the marketing authorisation
                                  (an EU Commission implementing decision, usually
                                  nitrosamine/ranitidine-class recalls) -> resolved
    motive comerciale          = commercial reasons       -> reason_category discontinuation
    motive de fabricatie       = manufacturing reasons     -> reason_category manufacturing_issue

The source free-text has known typos in the live data ("discontinuitate
tempora", "prelungie discontinuitate temporara", "dscontinuitate") — the
classifier matches on substrings/prefixes precisely to tolerate these
without misclassifying, and falls back to "active"/"unknown" rather than
raising when a Tip Notificare string doesn't match any known pattern.

Confidence / reliability: this source has reliability_weight=0.65 in the
seeded data_sources row (10000000-0000-0000-0000-000000000111), reflecting
that ANMDMR is a single official regulator PDF but the site is otherwise
sparsely maintained and English-language coverage is nonexistent.

Data source UUID:  10000000-0000-0000-0000-000000000111
Country:           Romania
Country code:      RO
Cadence:           Weekly (168h, see migration 064)
"""

from __future__ import annotations

import re
import urllib.parse
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class RomaniaANMDMRScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000111"
    SOURCE_NAME: str  = "ANMDMR — Notificari discontinuitate medicamente (Romania)"
    BASE_URL: str     = "https://www.anm.ro/"
    COUNTRY: str      = "Romania"
    COUNTRY_CODE: str = "RO"

    NOTIFICATION_PAGE: str = (
        "https://www.anm.ro/medicamente-de-uz-uman/autorizare-medicamente/"
        "notificari-discontinuitate-medicamente/"
    )

    RATE_LIMIT_DELAY: float = 3.0   # Be polite — site is a single small gov server
    REQUEST_TIMEOUT: float  = 90.0  # Cumulative PDF can be tens of pages
    SCRAPER_VERSION: str    = "1.0.0"

    # Expected table header (used only to skip header rows if they leak
    # into extract_tables() output — column order is otherwise positional).
    _HEADER_MARKERS = {"nr crt", "denumire comerciala"}

    # Romanian abbreviated month -> numeric month, for "Data estimativa"
    # values like "aug.-26" / "iun.26" / "mai-27".
    _RO_MONTH_ABBR = {
        "ian": "01", "feb": "02", "mar": "03", "apr": "04",
        "mai": "05", "iun": "06", "iul": "07", "aug": "08",
        "sept": "09", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch ANMDMR discontinuity-notification data.

        Strategy:
        1. GET the notification page.
        2. Find the (single, cumulative) PDF link — re-derived every run since
           the filename embeds a "last updated" date that changes.
        3. Download the PDF and extract rows with pdfplumber (table mode; the
           document is a clean multi-page table, so no free-text fallback is
           needed — but skipped pages log a warning rather than raising).
        4. Return the raw row dicts.
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.NOTIFICATION_PAGE,
        })

        resp = self._get(self.NOTIFICATION_PAGE)
        soup = BeautifulSoup(resp.text, "html.parser")

        pdf_url = self._find_pdf_link(soup)
        if not pdf_url:
            self.log.warning(
                "No discontinuity-notification PDF link found on ANMDMR page"
            )
            return []

        self.log.info("Found discontinuity-notification PDF", extra={"url": pdf_url})

        try:
            records = self._fetch_and_parse_pdf(pdf_url)
        except Exception as exc:
            self.log.error(
                "Failed to fetch/parse ANMDMR PDF",
                extra={"url": pdf_url, "error": str(exc)},
            )
            return []

        self.log.info("ANMDMR fetch complete", extra={"records": len(records)})
        return records

    def _find_pdf_link(self, soup) -> str | None:
        """Find the discontinuity-notification PDF link on the page.

        The link text is "descarcă documentul ..." and the href is a
        relative path with literal spaces (not percent-encoded) — we
        resolve + quote it before returning.
        """
        for link in soup.select("a[href]"):
            href = link.get("href", "")
            if not href.lower().endswith(".pdf"):
                continue
            return self._normalise_pdf_url(href)
        return None

    def _normalise_pdf_url(self, href: str) -> str:
        """Resolve a (possibly relative, possibly space-containing) href
        against BASE_URL and percent-encode the path safely."""
        absolute = urllib.parse.urljoin(self.BASE_URL, href)
        parsed = urllib.parse.urlsplit(absolute)
        # Re-quote the path (safe chars kept as-is; spaces etc. escaped).
        # quote() is idempotent on already-escaped sequences via safe="%/".
        safe_path = urllib.parse.quote(parsed.path, safe="/%")
        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, safe_path, parsed.query, parsed.fragment)
        )

    def _fetch_and_parse_pdf(self, pdf_url: str) -> list[dict]:
        """Download the PDF and extract row records from every page."""
        try:
            import pdfplumber
        except ImportError:
            self.log.error(
                "pdfplumber not installed — required for ANMDMR PDF parsing. "
                "Install with: pip install pdfplumber"
            )
            return []

        import io

        self.log.info("Downloading PDF", extra={"url": pdf_url})
        resp = self._get(pdf_url)

        records: list[dict] = []
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            self.log.info(
                "PDF opened",
                extra={"pages": len(pdf.pages), "url": pdf_url},
            )

            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    tables = page.extract_tables()
                    for table in tables:
                        records.extend(
                            self._parse_table(table, pdf_url, page_num)
                        )
                except Exception as exc:
                    self.log.warning(
                        "Failed to parse PDF page",
                        extra={"url": pdf_url, "page": page_num, "error": str(exc)},
                    )

        self.log.info(
            "PDF parsing complete",
            extra={"url": pdf_url, "records": len(records)},
        )
        return records

    def _parse_table(self, table: list[list], pdf_url: str, page_num: int) -> list[dict]:
        """Parse one extracted table (one per page) into raw row dicts.

        Columns (positional, verified against the live document):
            0 Nr crt | 1 Denumire comerciala | 2 Metop | 3 Concentratie |
            4 Firma Detinatoare | 5 Tara Detinatoare | 6 DCI | 7 Data adresa |
            8 Tip Notificare | 9 Data estimativa de reluare | 10 Observatii
        """
        records: list[dict] = []
        for row in table:
            if not row or all(cell is None or str(cell).strip() == "" for cell in row):
                continue

            first_cell = str(row[0] or "").strip().lower()
            if first_cell in self._HEADER_MARKERS or not str(row[0] or "").strip().isdigit():
                continue  # header row or stray non-data row

            # Defensive: pad short rows rather than raising on ragged tables.
            cells = list(row) + [None] * max(0, 11 - len(row))

            records.append({
                "nr_crt":           str(cells[0] or "").strip(),
                "brand_name":       str(cells[1] or "").strip(),
                "form":             str(cells[2] or "").strip(),
                "strength":         str(cells[3] or "").strip(),
                "mah_company":      str(cells[4] or "").strip(),
                "mah_country":      str(cells[5] or "").strip(),
                "dci":              str(cells[6] or "").strip(),
                "notification_date": str(cells[7] or "").strip(),
                "notification_type": (str(cells[8] or "").strip()).replace("\n", " "),
                "estimated_resume":  (str(cells[9] or "").strip()).replace("\n", " "),
                "observations":      (str(cells[10] or "").strip()).replace("\n", " "),
                "pdf_url":          pdf_url,
                "page_num":         page_num,
            })
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ANMDMR records into standard shortage event dicts."""
        self.log.info(
            "Normalising ANMDMR records",
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
                    "Failed to normalise ANMDMR record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single ANMDMR row into a normalised shortage event dict."""
        dci = str(rec.get("dci") or "").strip()
        brand_name = str(rec.get("brand_name") or "").strip()

        generic_name = self._clean_generic_name(dci) or self._clean_generic_name(brand_name)
        if not generic_name:
            return None

        notification_type = str(rec.get("notification_type") or "").strip()
        status = self._classify_status(notification_type)

        observations = str(rec.get("observations") or "").strip()
        reason_category = self._classify_reason_category(observations, notification_type)

        start_date = self._parse_ro_date(rec.get("notification_date")) or today

        estimated_resolution_date = self._parse_ro_month_year(
            rec.get("estimated_resume")
        )

        brand_names = [brand_name] if brand_name else []

        notes_parts: list[str] = []
        if notification_type:
            notes_parts.append(f"Tip notificare: {notification_type}")
        strength = str(rec.get("strength") or "").strip()
        form = str(rec.get("form") or "").replace("\n", " ").strip()
        if form or strength:
            notes_parts.append(f"Forma/concentratie: {form} {strength}".strip())
        mah = str(rec.get("mah_company") or "").replace("\n", " ").strip()
        mah_country = str(rec.get("mah_country") or "").strip()
        if mah:
            notes_parts.append(
                f"DAPP: {mah}" + (f" ({mah_country})" if mah_country else "")
            )
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  None,  # source doesn't grade severity
            "reason":                    observations or notification_type or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                rec.get("pdf_url") or self.NOTIFICATION_PAGE,
            "notes":                     notes,
            "raw_record":                rec,
        }

    # -------------------------------------------------------------------------
    # Classification helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _normalise_ro_text(text: str) -> str:
        """Lowercase + strip Romanian diacritics for tolerant substring matching."""
        replacements = {
            "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t",
        }
        text = text.lower()
        for src, dst in replacements.items():
            text = text.replace(src, dst)
        return text

    def _classify_status(self, notification_type: str) -> str:
        """
        Map the free-text 'Tip Notificare' column to a shortage_events status.

        discontinuitate temporara / prelungire discontinuitate temporara /
        cantitati limitate  -> active (ongoing, trackable shortage)
        discontinuitate permanenta / renuntare la app / decizie de
          suspendare a app -> resolved (drug is gone; kept for historical
          record rather than treated as an open shortage)

        Unrecognised text (typos, new phrasing) defaults to "active" so a
        genuine notification is never silently dropped.
        """
        norm = self._normalise_ro_text(notification_type)

        if "permanent" in norm or "renuntare la app" in norm or "suspendare a app" in norm:
            return "resolved"
        if "temporar" in norm or "tempora" in norm or "cantitati limitate" in norm:
            return "active"
        return "active"

    def _classify_reason_category(self, observations: str, notification_type: str) -> str:
        """
        Map 'Observatii' (Motive comerciale / Motive de fabricatie) plus a
        fallback scan of 'Tip Notificare' to the canonical reason_category.
        """
        norm_obs = self._normalise_ro_text(observations)
        if "fabricat" in norm_obs:
            return "manufacturing_issue"
        if "comercial" in norm_obs:
            return "discontinuation"

        # Fall back to the shared multilingual mapper (covers "regulatory",
        # "suspendare"/"suspension" style phrasing in Tip Notificare) before
        # giving up as unknown.
        category = map_reason_category(observations or notification_type)
        if category != "unknown":
            return category

        norm_type = self._normalise_ro_text(notification_type)
        if "suspendare" in norm_type or " app" in norm_type:
            return "regulatory_action"
        return "unknown"

    @staticmethod
    def _clean_generic_name(name: str) -> str:
        """Strip trailing dosage/strength noise from a DCI/brand string.

        DCI values are usually already clean INN text (e.g. "EVEROLIMUS",
        "COMBINATII (BIMATOPROSTUM + TIMOLOLUM)"); brand names (used only
        as a fallback when DCI is blank) carry strength suffixes like
        "CERTICAN 0,75 mg" that need trimming.
        """
        if not name:
            return ""
        # Remove trailing strength patterns, e.g. "12,5 mg", "20µg/ml".
        cleaned = re.sub(
            r"\s+\d+[\.,]?\d*\s*(?:mg|g|ml|mcg|iu|ui|%|µg|mg/ml|micrograme).*$",
            "",
            name,
            flags=re.IGNORECASE,
        ).strip()
        return cleaned if len(cleaned) >= 2 else name.strip()

    @staticmethod
    def _parse_ro_date(raw: Any) -> str | None:
        """Parse a Romanian dd.mm.yyyy date string to ISO-8601."""
        if not raw:
            return None
        raw_str = str(raw).strip()
        match = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", raw_str)
        if match:
            day, month, year = match.groups()
            try:
                return date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                return None
        return None

    def _parse_ro_month_year(self, raw: Any) -> str | None:
        """Parse an abbreviated Romanian month-year like 'aug.-26', 'iun.26',
        'mai-27' to an ISO date (first of month). Returns None for freeform
        values like 'trimestrul II 2026' (quarter references) that don't map
        to a single month.
        """
        if not raw:
            return None
        raw_str = str(raw).strip().lower()
        if not raw_str:
            return None

        match = re.match(r"^([a-z]+)\.?-?(\d{2,4})$", raw_str)
        if not match:
            return None
        month_abbr, year_str = match.groups()
        month_num = self._RO_MONTH_ABBR.get(month_abbr[:4].rstrip(".")) or \
            self._RO_MONTH_ABBR.get(month_abbr[:3])
        if not month_num:
            return None

        year = int(year_str)
        if year < 100:
            year += 2000

        try:
            return date(year, int(month_num), 1).isoformat()
        except ValueError:
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
        print("Fetches live ANMDMR data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = RomaniaANMDMRScraper(db_client=MagicMock())

        print("\n-- Fetching from ANMDMR ...")
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

    scraper = RomaniaANMDMRScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
