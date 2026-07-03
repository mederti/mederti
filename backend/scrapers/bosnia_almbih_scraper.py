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

Pagination — SOLVED (v2, 2026-07-03)
──────────────────────────────────────────────────
This IS an ASP.NET WebForms page (.aspx). Paging is wired to __doPostBack()
targets on numbered page links, e.g. the page-2 link
"ctl00$MainContent$EvidencijaNestasiceLijekovaGrid$ctl104$EvidencijaNestasiceLijekovaGrid_bottom_2"
(ctl103 = top pager, ctl104 = bottom pager). A single GET renders page 1
(100 rows) of the ~181 live entries; page 2 holds the remaining ~81.

The v1 postback attempt returned HTTP 500 because it targeted the wrong
control (the per-page-size option "...$ctl104$ctl06") and/or did not carry
the session cookie + full form-field set. v2 drives the real numbered pager:
one cookie-persisting httpx.Client GETs page 1, then POSTs each page link
back with __EVENTTARGET plus the complete hidden-field set (__VIEWSTATE /
__VIEWSTATEGENERATOR / __EVENTVALIDATION + the filter-row inputs), re-reading
the fresh __VIEWSTATE from each response. No MS AJAX ScriptManager envelope
is needed — this grid does a full-page synchronous postback. See fetch().

Verified 2026-07-03: page 1 (100) + page 2 (81) = 181 rows, the full register.

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
    #
    # ORDER MATTERS: _map_reason() returns the FIRST matching keyword, so the
    # specific causes below are listed before the broad "proizvodn" (production)
    # catch-all — a row that mentions both a supply chain and a production note
    # then lands on the more informative category. Roots (not whole phrases) are
    # used to absorb the register's heavy inflection/spelling variation
    # (proizvodnja/-e/-i/-u/-ih, potražnja/potraznja, obezbijedio/obezbjedio).
    # Derived from the live "Drugo" free-text corpus, 2026-07-03.
    _EXPLANATION_KEYWORDS: dict[str, str] = {
        # -- Discontinuation / withdrawal (a decision to stop or not renew) --
        "poslovna odluka": "discontinuation",
        "komercijalnih razloga": "discontinuation",
        "neće biti obnovljena": "discontinuation",
        "nece biti obnovljena": "discontinuation",
        "ukidanj": "discontinuation",            # ukidanje/ukidanju dozvole = licence revocation

        # -- Demand surge. Use surge-SPECIFIC phrases, not a bare "potražnj"
        #    (demand) root: the register also says "nije bilo potražnje" ("there
        #    was NO demand"), a commercial discontinuation — a loose root would
        #    mislabel that negated phrase as a surge. --
        "povećana potražnja": "demand_surge",
        "povecana potraznja": "demand_surge",
        "povećana potrošnja": "demand_surge",    # increased consumption
        "povecana potrosnja": "demand_surge",
        "prevazilazi": "demand_surge",           # potražnja prevazilazi dostupne količine = demand exceeds supply
        "veća od ponude": "demand_surge",        # potražnja veća od ponude = demand greater than supply
        "veca od ponude": "demand_surge",

        # -- Raw material / active substance --
        "aktivnom supstancom": "raw_material",
        "aktivne supstance": "raw_material",
        "nabavci aktivne": "raw_material",
        "sirovin": "raw_material",

        # -- Supply-chain disruption (before the production catch-all, so a
        #    "lanci snabdijevanja" row isn't swallowed by a co-mentioned
        #    capacity note) --
        "lanac snabdij": "supply_chain",
        "lancu snabdij": "supply_chain",
        "lanci snabdij": "supply_chain",
        "lanaca snabdij": "supply_chain",

        # -- Manufacturing / production: the dominant "Drugo" bucket. Covers
        #    production delays, reorganisation, limited capacity, variations,
        #    and post-renewal gaps where the manufacturer hasn't yet produced
        #    or secured market stock pending first-batch QC. --
        "kašnjenje proizvodnje": "manufacturing_issue",
        "kasnjenje proizvodnje": "manufacturing_issue",
        "kašnjenje opremanja": "manufacturing_issue",
        "kasnjenje opremanja": "manufacturing_issue",
        "nedostataka tokom": "manufacturing_issue",
        "kvalitet": "manufacturing_issue",
        "proizvodn": "manufacturing_issue",      # proizvodnja/-e/-i, proizvodni kapaciteti, proizvodnu lokaciju
        "proizveden": "manufacturing_issue",     # serije ... proizvedene nakon obnove
        "proizveo": "manufacturing_issue",
        "proizvesti": "manufacturing_issue",
        "reorganizacij": "manufacturing_issue",  # reorganizacija proizvodnje
        "zastoj": "manufacturing_issue",         # zastoj (u proizvodnji) = stoppage
        "prve serije": "manufacturing_issue",    # kontrola prve serije nakon obnove dozvole
        "izmjen": "manufacturing_issue",         # zahtjev za izmjenu = manufacturing variation
        "obezbij": "manufacturing_issue",        # nije obezbijedio dovoljne zalihe/količine
        "obezbjed": "manufacturing_issue",       # spelling variant (obezbjedio)

        # -- Delivery / logistics (after production, so "proizvodnji i isporuci"
        #    rows stay manufacturing; only pure-delivery rows land here) --
        "isporuc": "supply_chain",               # kašnjenje u isporuci = delivery delay
        "isporuk": "supply_chain",
        "dostav": "supply_chain",                # dostava/dostavi pošiljke = shipment

        # -- Distribution / import --
        "uvoz": "distribution",
        "distribuci": "distribution",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    # Cap on pagination postbacks — a runaway/looping pager backstop. The live
    # register is ~2 pages (~181 rows at 100/page); 15 leaves generous headroom.
    MAX_PAGES: int = 15
    ORIGIN: str = "https://lijekovi.almbih.gov.ba"

    def fetch(self) -> list[dict]:
        """
        Fetch the full ALMBIH shortage register across all pages.

        The register is a custom ASP.NET WebForms filtered grid whose paging is
        wired to __doPostBack() targets (e.g. the page-2 link
        "...$ctl104$EvidencijaNestasiceLijekovaGrid_bottom_2"). A single GET
        renders page 1 (100 rows) of the ~181 live entries; the rest live on
        page 2+ behind postbacks. We drive the pagination directly:

          1. GET page 1 on a cookie-persisting client (session ties __VIEWSTATE).
          2. Replay the numbered page postback (__EVENTTARGET + full hidden-field
             set: __VIEWSTATE / __VIEWSTATEGENERATOR / __EVENTVALIDATION + the
             filter-row inputs), re-reading the fresh __VIEWSTATE from each
             response before requesting the next page.
          3. Stop when there is no next-page target, a page yields no new rows,
             or MAX_PAGES is hit.

        Pages 2+ are best-effort: if a postback fails we return the pages
        gathered so far (a partial register beats no register), but a page-1
        failure or missing grid raises, since that signals the source is down
        or its layout changed.
        """
        import httpx

        self._enforce_rate_limit()
        self.log.debug("HTTP GET", extra={"url": self.BASE_URL})
        with httpx.Client(
            headers=self.DEFAULT_HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            try:
                resp = client.get(self.BASE_URL)
                resp.raise_for_status()
            except Exception as exc:
                raise ScraperError(f"ALMBIH fetch failed (page 1): {exc}") from exc

            html = resp.text
            all_rows: list[dict] = []
            seen: set[tuple] = set()
            page = 1

            while True:
                # Page 1 parse may raise (genuine layout change / source down);
                # later pages are best-effort so a hiccup can't lose page 1.
                if page == 1:
                    rows = self._parse_register_page(html)
                else:
                    try:
                        rows = self._parse_register_page(html)
                    except ScraperError as exc:
                        self.log.warning(
                            "ALMBIH page parse failed; returning pages so far",
                            extra={"page": page, "error": str(exc)},
                        )
                        break

                new = 0
                for r in rows:
                    key = tuple(r.values())
                    if key in seen:
                        continue
                    seen.add(key)
                    all_rows.append(r)
                    new += 1
                self.log.info(
                    "ALMBIH page parsed",
                    extra={"page": page, "rows": len(rows),
                           "new": new, "cumulative": len(all_rows)},
                )

                if new == 0 and page > 1:
                    break
                if page >= self.MAX_PAGES:
                    self.log.warning(
                        "ALMBIH hit MAX_PAGES cap — stopping pagination",
                        extra={"cap": self.MAX_PAGES, "cumulative": len(all_rows)},
                    )
                    break

                target = self._next_page_target(html, page)
                if not target:
                    break

                form = self._extract_form_fields(html)
                form["__EVENTTARGET"] = target
                form["__EVENTARGUMENT"] = ""

                self._enforce_rate_limit()
                self.log.debug("HTTP POST (pagination)",
                               extra={"url": self.BASE_URL, "target": target})
                try:
                    presp = client.post(
                        self.BASE_URL,
                        data=form,
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Referer": self.BASE_URL,
                            "Origin": self.ORIGIN,
                        },
                    )
                    presp.raise_for_status()
                except Exception as exc:
                    self.log.warning(
                        "ALMBIH pagination postback failed; returning pages so far",
                        extra={"page": page + 1, "error": str(exc)},
                    )
                    break

                html = presp.text
                page += 1

        self.log.info(
            "ALMBIH fetch complete",
            extra={"records": len(all_rows), "pages": page, "url": self.BASE_URL},
        )
        return all_rows

    @staticmethod
    def _extract_form_fields(html: str) -> dict[str, str]:
        """Collect every named form field (hidden inputs, text inputs,
        textareas, selects) with its current value — the full set ASP.NET
        expects echoed back on a postback."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        form: dict[str, str] = {}
        for inp in soup.find_all("input"):
            name = inp.get("name")
            if name:
                form[name] = inp.get("value", "") or ""
        for ta in soup.find_all("textarea"):
            name = ta.get("name")
            if name:
                form[name] = ta.get_text() or ""
        for sel in soup.find_all("select"):
            name = sel.get("name")
            if not name:
                continue
            opt = sel.find("option", selected=True) or sel.find("option")
            form[name] = (opt.get("value", "") if opt else "") or ""
        return form

    # The grid's page links post back to numbered targets like
    #   ctl00$MainContent$EvidencijaNestasiceLijekovaGrid$ctl104$EvidencijaNestasiceLijekovaGrid_bottom_2
    # (ctl103 = top pager, ctl104 = bottom pager; suffix is the page number or
    # "next"). We capture the whole target string as it must be sent verbatim.
    _PAGE_TARGET_RE = re.compile(
        r"ctl00\$MainContent\$EvidencijaNestasiceLijekovaGrid\$ctl10[34]"
        r"\$EvidencijaNestasiceLijekovaGrid_(?:bottom|top)_(\d+|next)"
    )

    def _next_page_target(self, html: str, current_page: int) -> str | None:
        """Find the __EVENTTARGET for the page after ``current_page``.

        Prefers the explicit numbered link (page current+1); falls back to the
        "next" link if the numeric one isn't in the visible pager window.
        Returns None when neither is present (i.e. we're on the last page).
        """
        by_suffix: dict[str, str] = {}
        for m in self._PAGE_TARGET_RE.finditer(html):
            by_suffix[m.group(1)] = m.group(0)
        return by_suffix.get(str(current_page + 1)) or by_suffix.get("next")

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

        # -- Estimated resolution (derived from expected-duration text) --
        # This is the ANTICIPATED end ("do 30.08.2026"), not a confirmed one —
        # status is always active here — so it maps to estimated_resolution_date.
        # Writing it to end_date would make consumers treating end_date IS NOT
        # NULL as "resolved" misread ~181 still-active BA rows.
        estimated_resolution_date = self._parse_end_date(rec.get("expected_duration", ""))

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
        if estimated_resolution_date:
            result["estimated_resolution_date"] = estimated_resolution_date
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
