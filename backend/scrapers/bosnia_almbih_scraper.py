"""
Bosnia and Herzegovina ALMBIH Drug Shortage Scraper
----------------------------------------------------
Source:  Agencija za lijekove i medicinska sredstva Bosne i Hercegovine
         (Agency for Medicinal Products and Medical Devices of BiH)
URL:     https://lijekovi.almbih.gov.ba/EvidencijaNestasiceLijekova.aspx
         ("Evidencija nestašice lijekova" = Register of drug shortages)

The register is a public, sortable ASP.NET WebForms GridView
(id="MainContent_EvidencijaNestasiceLijekovaGrid") with no login wall.
Columns (Bosnian, left to right):

    Nosilac Dozvole                            Marketing authorisation holder
    Lijek                                       Medicine (name, strength, form,
                                                 pack size, authorisation number)
    ATC                                         ATC code
    INN                                         International Nonproprietary Name
    Proizvođač                                  Manufacturer
    Datum dostavljanja obavještenja             Date the notification was submitted
    Vrsta obustave                              Type of market suspension
    Razlog obustave                             Reason category (coarse)
    Obrazloženje                                Free-text explanation (fine reason)
    Očekivano razdoblje trajanja nestašice      Expected shortage duration
                                                 ("Od DD.MM.YYYY. do DD.MM.YYYY"
                                                  / "... do trajno" (permanent)
                                                  / "... do nepoznato" (unknown))

Pagination — CONFIRMED BY LIVE FETCH (2026-07-02)
──────────────────────────────────────────────────
This IS an ASP.NET WebForms page (.aspx) and paging/page-size controls are
wired to __doPostBack() targets (e.g.
"ctl00$MainContent$EvidencijaNestasiceLijekovaGrid$ctl104$ctl06" for the
100-per-page option), requiring __VIEWSTATE / __EVENTVALIDATION /
__EVENTTARGET replay. A live POST replay of the postback (full hidden-field
set) was attempted during development and returned HTTP 500 (request
validation / control-adapter rejection) — the page's ASP.NET AJAX postback
model needs more than the hidden inputs alone (likely a MS AJAX
ScriptManager async-postback envelope), which is a materially bigger lift
than a plain form POST.

HOWEVER: the plain unauthenticated GET of the page already renders the
GridView's first page at its *effective* page size, which in practice is
100 rows (not the "15" implied by the per-page-size selector UI) — i.e. a
single GET returns 100 of the ~181 live entries. Page 2 (postback-only)
holds the remaining ~81 rows.

v1 LIMITATION: this scraper only ingests the single default GET (100 rows,
~55% of the live register) and does NOT paginate to page 2. This is a
deliberate scope cut per the task brief — full ASP.NET postback pagination
(VIEWSTATE replay across page 1 -> page 2) is a good v2 follow-up if this
source proves valuable, but is not required to ship a working v1 feed.

Bosnian key terms:
    nestašica     = shortage
    obustava      = suspension / discontinuation (of marketing)
    prekid prometa = cessation of trade/marketing
    privremeni    = temporary
    trajni        = permanent (final)
    razlog        = reason
    obrazloženje  = explanation
    lijek         = medicine/drug
    dozvola       = (marketing) authorisation/licence
    proizvođač    = manufacturer
    trajno        = permanently / indefinitely
    nepoznato     = unknown

Data source UUID:  10000000-0000-0000-0000-000000000106
Country:           Bosnia and Herzegovina
Country code:      BA

Cron:  Not wired by this scraper — integrated separately.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class BosniaALMBIHScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000106"
    SOURCE_NAME: str  = "ALMBIH — Evidencija nestasice lijekova (Bosnia & Herzegovina)"
    BASE_URL: str     = "https://lijekovi.almbih.gov.ba/EvidencijaNestasiceLijekova.aspx"
    COUNTRY: str      = "Bosnia and Herzegovina"
    COUNTRY_CODE: str = "BA"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 45.0

    # "Vrsta obustave" (type of suspension) -> status
    # "Prekid prometa lijeka na tržištu BiH - trajni" = permanent cessation
    # "Prekid prometa lijeka na tržištu BiH - privremeni" = temporary cessation
    # "Odluka o nepodnošenju zahtjeva za obnovu dozvole..." = MAH declined to
    #   renew the marketing authorisation (effectively permanent discontinuation)
    _PERMANENT_MARKERS: tuple[str, ...] = ("trajni", "nepodnošenju zahtjeva")

    # "Razlog obustave" (coarse reason) -> reason_category
    _REASON_MAP: dict[str, str] = {
        "razlozi povezani sa: kvalitetom, sigurnosti ili efikasnosti lijeka": "manufacturing_issue",
        "komercijalni razlozi": "discontinuation",
        "drugo": "other",
    }

    # Free-text (Obrazloženje) keyword hints, checked before the coarse map
    # and before falling back to the centralised map_reason_category().
    _EXPLANATION_KEYWORDS: dict[str, str] = {
        "kašnjenje proizvodnje": "manufacturing_issue",
        "kasnjenje proizvodnje": "manufacturing_issue",
        "kašnjenje opremanja": "manufacturing_issue",
        "kasnjenje opremanja": "manufacturing_issue",
        "nedostataka tokom": "manufacturing_issue",
        "kvalitet": "manufacturing_issue",
        "lanac snabdij": "supply_chain",
        "lancu snabdij": "supply_chain",
        "aktivnom supstancom": "raw_material",
        "aktivne supstance": "raw_material",
        "nabavci aktivne": "raw_material",
        "sirovin": "raw_material",
        "poslovna odluka": "discontinuation",
        "komercijalnih razloga": "discontinuation",
        "neće biti obnovljena": "discontinuation",
        "nece biti obnovljena": "discontinuation",
        "povećana potražnja": "demand_surge",
        "povecana potraznja": "demand_surge",
        "uvoz": "distribution",
        "distribuci": "distribution",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the ALMBIH shortage register.

        v1 fetches only the default (unauthenticated) GET of the page, which
        the ASP.NET GridView renders with 100 rows of the ~181 live entries
        (page 2 requires an ASP.NET postback — see module docstring). This is
        a deliberate v1 scope cut, not a bug.
        """
        try:
            resp = self._get(self.BASE_URL)
        except Exception as exc:
            raise ScraperError(f"ALMBIH fetch failed: {exc}") from exc

        records = self._parse_register_page(resp.text)

        self.log.info(
            "ALMBIH fetch complete",
            extra={"records": len(records), "url": self.BASE_URL},
        )
        return records

    def _parse_register_page(self, html: str) -> list[dict]:
        """Parse the GridView table into a list of raw row dicts."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table", id="MainContent_EvidencijaNestasiceLijekovaGrid")
        if table is None:
            raise ScraperError(
                "ALMBIH GridView table not found — page layout may have changed"
            )

        records: list[dict] = []
        for row in table.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in row.find_all("td")]

            # Skip header rows, spacer rows, and the paging-control row.
            # A real data row has exactly 10 columns with a non-blank INN
            # (column 3) and medicine name (column 1), and isn't the header
            # row itself (whose column 0 literally reads "Nosilac Dozvole").
            if len(cells) != 10:
                continue
            if not cells[1] or not cells[3]:
                continue
            if cells[0] == "Nosilac Dozvole":
                continue

            records.append({
                "mah":                cells[0],
                "medicine":           cells[1],
                "atc":                cells[2],
                "inn":                cells[3],
                "manufacturer":       cells[4],
                "notification_date":  cells[5],
                "suspension_type":    cells[6],
                "reason_coarse":      cells[7],
                "explanation":        cells[8],
                "expected_duration":  cells[9],
            })

        self.log.info(
            "Parsed ALMBIH register rows",
            extra={"rows_parsed": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ALMBIH register rows into standard shortage event dicts."""
        self.log.info(
            "Normalising ALMBIH records",
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
                    "Failed to normalise ALMBIH record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single ALMBIH register row to a normalised shortage dict."""
        inn = (rec.get("inn") or "").strip()
        medicine = (rec.get("medicine") or "").strip()

        if not inn and not medicine:
            return None

        # -- Drug name (generic_name = INN; medicine name -> brand_names) --
        generic_name = inn or self._brand_from_medicine(medicine)
        if not generic_name:
            return None

        brand_names: list[str] = []
        brand = self._brand_from_medicine(medicine)
        if brand and brand.lower() != generic_name.lower():
            brand_names.append(brand)

        # -- Start date --
        start_date = self._parse_bosnian_date(rec.get("notification_date")) or today

        # -- Status --
        status = self._determine_status(rec.get("suspension_type", ""))

        # -- End date (derived from expected-duration text, if resolvable) --
        end_date = self._parse_end_date(rec.get("expected_duration", ""))

        # -- Reason: prefer the free-text explanation, fall back to coarse category --
        explanation = (rec.get("explanation") or "").strip()
        coarse = (rec.get("reason_coarse") or "").strip()
        reason = explanation or coarse or None
        reason_category = self._map_reason(explanation, coarse)

        # -- Notes --
        notes_parts: list[str] = []
        if rec.get("suspension_type"):
            notes_parts.append(f"Vrsta obustave: {rec['suspension_type']}")
        if rec.get("expected_duration"):
            notes_parts.append(f"Ocekivano trajanje: {rec['expected_duration']}")
        if rec.get("mah"):
            notes_parts.append(f"MAH: {rec['mah']}")
        if rec.get("manufacturer"):
            notes_parts.append(f"Proizvodjac: {rec['manufacturer']}")
        notes = "; ".join(notes_parts) or None

        result: dict[str, Any] = {
            "generic_name":    generic_name.strip().title(),
            "brand_names":     brand_names,
            "status":          status,
            "severity":        "medium",
            "reason":          reason,
            "reason_category": reason_category,
            "start_date":      start_date,
            "source_url":      self.BASE_URL,
            "notes":           notes,
            "raw_record":      rec,
        }
        if end_date:
            result["end_date"] = end_date
        if rec.get("atc"):
            result["notes"] = (result["notes"] + f"; ATC: {rec['atc']}") if result["notes"] else f"ATC: {rec['atc']}"

        return result

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _brand_from_medicine(self, medicine: str) -> str:
        """
        The 'Lijek' column is a long descriptive string, e.g.:
            "SYNOPEN, otopina za injekciju, 20 mg/2 ml, 10 ampula po 2 ml
             otopine za injekciju, u kutiji (04-07.3-2-7381/23)"
        The brand/trade name is the leading token before the first comma.
        """
        if not medicine:
            return ""
        return medicine.split(",", 1)[0].strip()

    def _determine_status(self, suspension_type: str) -> str:
        """
        Map 'Vrsta obustave' to a shortage status.

        All rows in this register represent a market suspension already in
        effect (this is a register of *current* shortages, not upcoming
        ones), so every row maps to 'active'. Bosnia does not appear to
        publish a distinct "resolved" list on this page; permanent vs.
        temporary discontinuation is preserved in `notes` /
        `reason_category` (discontinuation) rather than status, since the
        drug is still actively short at time of scraping.
        """
        return "active"

    def _map_reason(self, explanation: str, coarse: str) -> str:
        """Map ALMBIH reason text to canonical reason_category.

        Priority: free-text explanation keyword hints > coarse category map
        > centralised map_reason_category() fallback.
        """
        exp_lower = explanation.strip().lower()
        for keyword, category in self._EXPLANATION_KEYWORDS.items():
            if keyword in exp_lower:
                return category

        coarse_lower = coarse.strip().lower()
        if coarse_lower in self._REASON_MAP:
            return self._REASON_MAP[coarse_lower]

        # Fallback to centralised mapper (covers generic EN/FR/IT/ES/etc. terms
        # in case a future row includes them, e.g. via a mixed-language MAH).
        return map_reason_category(explanation or coarse)

    @staticmethod
    def _parse_bosnian_date(raw: Any) -> str | None:
        """Parse a DD.MM.YYYY. (Bosnian) date string to ISO-8601."""
        if raw is None:
            return None
        raw_str = str(raw).strip().rstrip(".")
        if not raw_str or raw_str in ("-", "nepoznato", "N/A", "null", "None"):
            return None

        match = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", raw_str)
        if match:
            day, month, year = match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_end_date(expected_duration: str) -> str | None:
        """
        Parse the 'Ocekivano razdoblje trajanja nestasice' field, e.g.:
            "Od 01.06.2026. do 30.08.2026"   -> end_date = 2026-08-30
            "Od 31.12.2026. do trajno"       -> permanent, no end_date
            "Od 01.01.2026. do nepoznato"    -> unknown, no end_date
            "-"                              -> no end_date
        Only the trailing "do <date>" half is used; the leading "Od <date>"
        is the anticipated *start* of the shortage window (kept only in
        notes/raw_record for v1 -- it can precede or postdate the
        notification date, and the base schema's start_date already comes
        from the notification date column).
        """
        if not expected_duration:
            return None
        text = expected_duration.strip()

        match = re.search(r"do\s+(\d{1,2})\.(\d{1,2})\.(\d{4})", text)
        if not match:
            return None
        day, month, year = match.groups()
        try:
            return datetime(int(year), int(month), int(day)).date().isoformat()
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
        print("Fetches live ALMBIH data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = BosniaALMBIHScraper(db_client=MagicMock())

        print("\n-- Fetching from ALMBIH ...")
        raw = scraper.fetch()
        print(f"-- Raw records received : {len(raw)}")

        print("-- Normalising records ...")
        events = scraper.normalize(raw)
        print(f"-- Normalised events    : {len(events)}")

        if events:
            print("\n-- Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str, ensure_ascii=False))

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

    scraper = BosniaALMBIHScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
