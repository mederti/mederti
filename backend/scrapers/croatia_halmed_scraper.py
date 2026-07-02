"""
HALMED (Croatia) — Nestašice lijekova (Medicine Shortages) Scraper
────────────────────────────────────────────────────────────────────
Source:  HALMED — Agencija za lijekove i medicinske proizvode
         (Agency for Medicinal Products and Medical Devices of Croatia)
URL:     https://halmed.hr/Lijekovi/Nestasica-lijekova/

HALMED publishes a table of medicines currently in shortage
("nestašice lijekova") as a PDF, refreshed regularly (observed refresh
in the header of the document itself, e.g. "Datum: 01.07.26."). The
same underlying dataset is *also* listed on the Croatian open-data
portal, data.gov.hr, under:

    "Popis lijekova za koje su prijavljeni nestašica i poremećaj
     opskrbe tržišta lijekom"
    https://data.gov.hr/ckan/dataset/popis-lijekova-za-koje-su-prijavljeni-nestasica-i-poremecaj-opskrbe-trzista-lijekom

IMPORTANT — research finding (verified by fetching both live, 2026-07):
the data.gov.hr CKAN resource is NOT a cleaner machine-readable mirror.
Its single resource is a PDF at a slightly different path
(".../Nestasice-lijekova-tablica-za-objavu.pdf", no "-WEB" suffix) that
downloads as a truncated/corrupt ~20KB file pdfplumber cannot open
("No /Root object!"). The canonical, actually-parseable file is the
"-WEB" PDF linked directly from halmed.hr:

    https://halmed.hr/fdsak3jnFsk1Kfa/ostale_stranice/Nestasice-lijekova-tablica-za-objavu-WEB.pdf

That WEB.pdf is a clean multi-page pdfplumber-extractable table (46
pages, ~277 valid rows as of 2026-07-01) with these Croatian columns:

    Broj odobrenja pakiranja       Marketing-authorisation / packaging number
    Nositelj odobrenja             Marketing authorisation holder
    Naziv lijeka; Pakiranje        Product name; pack description
    Djelatna tvar                  Active substance(s) (INN, one per line)
    Datum zaprimanja obavijesti    Date notification was received
    Razlog nestašice               Reason for shortage
    Razdoblje trajanja nestašice   Shortage duration period, formatted
                                   "DD.MM.YYYY. - DD.MM.YYYY." or
                                   "DD.MM.YYYY. - nepoznato" (unknown end)

We deliberately do NOT parse the sibling "Prekid opskrbe tržišta
lijekom" (market-supply-discontinuation) PDF on the same HALMED page —
it is a broader/messier dataset (permanent discontinuations, not all of
which are active shortages) with an incompatible table layout (merged
header cells, blank sub-rows for multi-product notices). It could be
added as a separate signal later but is out of scope here.

Key Croatian terms relied upon
───────────────────────────────
    nestašica / nestašice     = shortage(s)                → this dataset
    prekid opskrbe            = supply interruption/cessation (sibling PDF, not used)
    djelatna tvar             = active substance (INN)
    naziv lijeka               = product/brand name
    razlog                    = reason
    razdoblje trajanja         = duration period
    nepoznato                 = unknown (open-ended end date → status stays active)
    komercijalni razlozi       = commercial reasons          → discontinuation
    razlozi povezani s proizvodnjom = reasons related to manufacturing → manufacturing_issue
    razlozi povezani s kakvoćom / neispravnost u kakvoći = quality-related → manufacturing_issue
    razlozi povezani s distribucijom / povezano uz distribuciju = distribution-related → distribution
    neočekivano povećana potražnja = unexpectedly increased demand → demand_surge
    regulatorni razlozi        = regulatory reasons           → regulatory_action
    globalna alokacija         = global allocation            → supply_chain

Data source UUID:  10000000-0000-0000-0000-000000000109
Country:           Croatia
Country code:      HR
Language:          Croatian (hr)

Cron:  Every 24 hours (HALMED updates the PDF irregularly, sometimes
       daily when new notices arrive; polling daily is sufficient).
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class CroatiaHALMEDScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000109"
    SOURCE_NAME: str  = "HALMED — Nestasica lijekova (Croatia)"
    BASE_URL: str     = "https://halmed.hr/Lijekovi/Nestasica-lijekova/"
    COUNTRY: str      = "Croatia"
    COUNTRY_CODE: str = "HR"

    RATE_LIMIT_DELAY: float = 3.0   # Be polite — small national agency server
    REQUEST_TIMEOUT: float  = 90.0  # Multi-page PDF, can be slow
    SCRAPER_VERSION: str    = "1.0.0"

    # Canonical, directly-linked PDF (see module docstring for why the
    # data.gov.hr CKAN mirror is NOT used — it 404s/serves a corrupt file).
    SHORTAGE_PDF_URL: str = (
        "https://halmed.hr/fdsak3jnFsk1Kfa/ostale_stranice/"
        "Nestasice-lijekova-tablica-za-objavu-WEB.pdf"
    )

    # Header row(s) we must skip when walking extracted table rows.
    _HEADER_MARKERS = (
        "broj odobrenja pakiranja",
        "datum",
    )

    # Croatian reason phrase → canonical reason_category.
    # Checked before falling back to the centralized map_reason_category().
    _REASON_MAP: list[tuple[str, str]] = [
        ("razlozi povezani s proizvodnjom",  "manufacturing_issue"),
        ("razlozi povezani sa proizvodnjom", "manufacturing_issue"),
        ("razlozi povezani s kakvoćom",      "manufacturing_issue"),
        ("razlozi povezani sa kakvoćom",     "manufacturing_issue"),
        ("neispravnost u kakvoći",           "manufacturing_issue"),
        ("kakvoć",                           "manufacturing_issue"),
        ("proizvodnj",                       "manufacturing_issue"),
        ("neočekivano povećana potražnja",   "demand_surge"),
        ("povećana potražnja",               "demand_surge"),
        ("potražnj",                         "demand_surge"),
        ("razlozi povezani s distribucijom", "distribution"),
        ("povezano uz distribuciju",         "distribution"),
        ("distribuciju",                     "distribution"),
        ("globalna alokacija",               "supply_chain"),
        ("alokacij",                         "supply_chain"),
        ("regulatorni razlozi",              "regulatory_action"),
        ("regulatorn",                       "regulatory_action"),
        ("komercijalni razlozi",             "discontinuation"),
        ("komercijaln",                      "discontinuation"),
    ]

    _MONTHS_HR = {
        # not currently needed (numeric dates only) but kept for future
        # free-text date parsing if HALMED changes format.
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the HALMED "Nestašice lijekova" (medicine shortages) PDF and
        extract raw table rows.

        Strategy:
        1. GET the canonical WEB.pdf directly (see module docstring — the
           HTML listing page and the data.gov.hr mirror were both checked
           and are dead ends: the listing page is a search form with no
           embedded table, and the CKAN resource serves a corrupt PDF).
        2. Parse every page with pdfplumber.extract_tables().
        3. Skip header/blank rows; keep only rows whose first cell looks
           like a HALMED marketing-authorisation number ("HR-H-...").
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.SHORTAGE_PDF_URL,
        })

        try:
            import pdfplumber
        except ImportError:
            self.log.error(
                "pdfplumber not installed — required for HALMED PDF parsing. "
                "Install with: pip install pdfplumber"
            )
            return []

        resp = self._get(self.SHORTAGE_PDF_URL)
        self.log.info(
            "HALMED PDF downloaded",
            extra={"bytes": len(resp.content), "url": self.SHORTAGE_PDF_URL},
        )

        records: list[dict] = []
        try:
            with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
                self.log.info(
                    "HALMED PDF opened",
                    extra={"pages": len(pdf.pages)},
                )
                for page_num, page in enumerate(pdf.pages, start=1):
                    try:
                        tables = page.extract_tables()
                    except Exception as exc:
                        self.log.warning(
                            "Failed to extract tables from HALMED PDF page",
                            extra={"page": page_num, "error": str(exc)},
                        )
                        continue

                    for table in tables:
                        records.extend(self._parse_table(table, page_num))
        except Exception as exc:
            raise ScraperError(f"Failed to parse HALMED shortage PDF: {exc}") from exc

        self.log.info(
            "HALMED fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_table(self, table: list[list], page_num: int) -> list[dict]:
        """Parse one pdfplumber-extracted table into raw record dicts.

        Expected columns (7):
            0 Broj odobrenja pakiranja
            1 Nositelj odobrenja
            2 Naziv lijeka; Pakiranje
            3 Djelatna tvar
            4 Datum zaprimanja obavijesti
            5 Razlog nestašice
            6 Razdoblje trajanja nestašice
        """
        records: list[dict] = []
        for row in table:
            if not row or len(row) < 7:
                continue

            first_cell = str(row[0] or "").strip()
            if not first_cell:
                continue
            lowered = first_cell.lower()
            if any(marker in lowered for marker in self._HEADER_MARKERS):
                continue
            # Only keep rows that look like a real HALMED authorisation number
            # (skips the "Datum: 01.07.26." banner row and any stray blanks).
            if not first_cell.upper().startswith("HR-"):
                continue

            records.append({
                "authorisation_no": first_cell,
                "authorisation_holder": str(row[1] or "").strip(),
                "product_pack": str(row[2] or "").strip(),
                "active_substance": str(row[3] or "").strip(),
                "notification_date": str(row[4] or "").strip(),
                "reason": str(row[5] or "").strip(),
                "period": str(row[6] or "").strip(),
                "page_num": page_num,
            })
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize HALMED records into standard shortage event dicts."""
        self.log.info(
            "Normalising HALMED records",
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
                    "Failed to normalise HALMED record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single HALMED record to a normalised shortage event dict."""
        # -- Generic name (active substance) --
        # "Djelatna tvar" may list multiple substances stacked on separate
        # lines within the same cell (fixed-dose combinations). Use the
        # first as the primary generic_name; keep the full string in notes.
        raw_substance = str(rec.get("active_substance") or "").strip()
        substances = [s.strip() for s in raw_substance.splitlines() if s.strip()]
        generic_name = substances[0] if substances else ""
        if not generic_name:
            return None

        # -- Brand / product name (strip pack description after the ';') --
        product_pack = str(rec.get("product_pack") or "").strip()
        product_name = product_pack.split(";")[0].strip() if product_pack else ""
        brand_names = [product_name] if product_name and product_name.lower() != generic_name.lower() else []

        # -- Reason --
        raw_reason = str(rec.get("reason") or "").strip()
        # Multi-line combined reasons ("X i\nY") — collapse whitespace for
        # matching and storage.
        raw_reason_clean = re.sub(r"\s+", " ", raw_reason).strip()
        reason_category = self._map_reason(raw_reason_clean)

        # -- Period parsing: "DD.MM.YYYY. - DD.MM.YYYY." / "... - nepoznato" --
        period = str(rec.get("period") or "").strip()
        start_from_period, end_from_period, end_unknown = self._parse_period(period)

        # -- Notification date (fallback start date) --
        notification_date = self._parse_date(rec.get("notification_date"))

        start_date = start_from_period or notification_date or today

        # -- Status --
        # A shortage is 'resolved' only when the period gives a concrete end
        # date that has already passed. Open-ended ("nepoznato") or
        # future-dated periods are 'active' — HALMED lists these as
        # currently in shortage.
        status = "active"
        if end_from_period and not end_unknown:
            try:
                if datetime.strptime(end_from_period, "%Y-%m-%d").date() < date.today():
                    status = "resolved"
            except ValueError:
                pass

        end_date = end_from_period if status == "resolved" else None

        # -- Notes --
        notes_parts: list[str] = []
        if rec.get("authorisation_holder"):
            notes_parts.append(f"MAH: {rec['authorisation_holder']}")
        if rec.get("authorisation_no"):
            notes_parts.append(f"Authorisation no.: {rec['authorisation_no']}")
        if len(substances) > 1:
            notes_parts.append(f"Active substances: {', '.join(substances)}")
        if period:
            notes_parts.append(f"Shortage period (HR): {period}")
        if raw_reason_clean:
            notes_parts.append(f"Reason (HR): {raw_reason_clean}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             brand_names,
            "status":                  status,
            "severity":                "medium",
            "reason":                  raw_reason_clean or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "end_date":                end_date,
            "source_url":              self.SHORTAGE_PDF_URL,
            "notes":                   notes,
            "source_confidence_score": 85,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str) -> str:
        """Map a Croatian reason string to a canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.lower()
        for keyword, category in self._REASON_MAP:
            if keyword in lower:
                return category
        # Fallback to the centralized multi-language mapper.
        return map_reason_category(raw)

    @staticmethod
    def _parse_period(period: str) -> tuple[str | None, str | None, bool]:
        """
        Parse HALMED's "Razdoblje trajanja nestašice" period string.

        Formats observed:
            "01.06.2016. - 31.12.2026."   -> concrete start + end
            "20.12.2016. - nepoznato"     -> concrete start, unknown end
            "07.12.2018. - 11.2026."      -> concrete start, month/year-only end
            "07.2022. - nepoznato"        -> month/year-only start, unknown end
            "02.01.2026 - 31.08.2026."    -> missing trailing dot (tolerated)

        Returns (start_iso, end_iso, end_is_unknown).
        """
        if not period:
            return None, None, False

        parts = re.split(r"\s*-\s*", period, maxsplit=1)
        if len(parts) != 2:
            return None, None, False

        raw_start, raw_end = parts[0].strip(), parts[1].strip()

        start_iso = CroatiaHALMEDScraper._parse_hr_date(raw_start)

        if raw_end.lower().startswith("nepoznato"):
            return start_iso, None, True

        end_iso = CroatiaHALMEDScraper._parse_hr_date(raw_end)
        return start_iso, end_iso, False

    @staticmethod
    def _parse_hr_date(raw: str) -> str | None:
        """
        Parse a Croatian date fragment to ISO-8601.

        Handles:
            "DD.MM.YYYY."  / "DD.MM.YYYY"  -> full date
            "MM.YYYY."     / "MM.YYYY"     -> first day of month
        """
        if not raw:
            return None
        cleaned = raw.strip().rstrip(".")

        # DD.MM.YYYY
        match = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", cleaned)
        if match:
            day, month, year = match.groups()
            try:
                return date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                return None

        # MM.YYYY (day-less — use the 1st of the month)
        match = re.match(r"^(\d{1,2})\.(\d{4})$", cleaned)
        if match:
            month, year = match.groups()
            try:
                return date(int(year), int(month), 1).isoformat()
            except ValueError:
                return None

        return None

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse a single Croatian date value ("DD.MM.YYYY.") to ISO-8601."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str.lower() in ("-", "n/a", "null", "none", "nepoznato"):
            return None
        return CroatiaHALMEDScraper._parse_hr_date(raw_str)


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
        print("Fetches live HALMED data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = CroatiaHALMEDScraper(db_client=MagicMock())

        print("\n-- Fetching from HALMED ...")
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

    scraper = CroatiaHALMEDScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
