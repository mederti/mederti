"""
Latvia ZVA (Zāļu valsts aģentūra / State Agency of Medicines) Scraper
----------------------------------------------------------------------
Source:  Medicinal Product Availability Register
URL:     https://dati.zva.gov.lv/zr-med-availability/

ZVA publishes a searchable "Zāļu piegādes pārtraukumu saraksts" (List of
medicinal product supply interruptions) on its open-data subdomain
(dati.zva.gov.lv). The page itself is a thin shell — a search box that
fires an XHR to a JSON API on page load and on every keystroke:

    GET https://dati.zva.gov.lv/zr-med-availability/api/med-avail-zp/
        ?q=<search text, blank = all>
        &p=<page number, 1-indexed>
        &sort=<mn-a|mn-d|in-a|sd-a|rd-a>
        &lang=<lv|en>

The response is JSON: {"success": true, "data": "<html fragment>"}. The
"data" value is NOT structured JSON — it's a rendered HTML fragment
containing a Bootstrap <table> (plus a duplicated pagination nav both
above and below the table). We fetch every page (blank query returns
the full unfiltered register, ~22 pages at ~30 rows/page as of the
research pass on 2026-07-02) and parse the table rows with BeautifulSoup.

lang=en works cleanly via direct fetch (no headless browser / JS needed)
and returns English column headers + English month names in dates (e.g.
"Jun 3, 2025") plus the English status string "Leaving the market (from
<date>)" for discontinuations — so no Latvian keyword reliance is needed
in the parsing logic itself. Latvian is documented below only for
posterity / in case the "lang=en" param is ever dropped upstream.

Latvian key terms (NOT relied upon — lang=en avoids needing these):
    Zāļu piegādes pārtraukumu saraksts = List of medicinal product supply
                                          interruptions
    Pārtraukuma sākuma datums          = Interruption start date
    Paredzamais piegādes atjaunošanas
        datums                         = Predicted supply resumption date
    nav norādīts                       = not indicated / not notified
    Aiziet no tirgus                   = Leaving the market

Table columns (lang=en):
    1. Medicinal product name, package size, product No. (+ "find
       alternatives" link carrying the ATC code as `AK=`)
    2. Strength
    3. Active substance (International Nonproprietary Name — INN, may be
       multiple substances comma-separated for combination products)
    4. Interruption of supply from — either a date, or the string
       "Leaving the market (from <date>)" for a permanent discontinuation
    5. Predicted availability date — a date, or "not notified" / "—"

Every row on this register represents a CURRENTLY active/ongoing supply
interruption (there is no separate resolved/historical list exposed by
this endpoint), so status is 'active' unless the "Leaving the market"
marker is present, in which case we map it to 'resolved' with
reason_category='discontinuation' (the product is being permanently
withdrawn, not expected to return — closest fit to the existing enum;
there is no distinct "discontinued" status in shortage_events).

Data source UUID:  10000000-0000-0000-0000-000000000110
Country:           Latvia
Country code:      LV
Confidence:        80/100 (seeded in migration 064)
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class LatviaZVAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000110"
    SOURCE_NAME: str  = "ZVA — Medicinal Product Availability Register (Latvia)"
    BASE_URL: str     = "https://dati.zva.gov.lv/zr-med-availability/"
    COUNTRY: str      = "Latvia"
    COUNTRY_CODE: str = "LV"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Underlying JSON/AJAX endpoint the search page itself calls.
    API_URL: str = "https://dati.zva.gov.lv/zr-med-availability/api/med-avail-zp/"

    # Hard ceiling so a pagination bug upstream can't spin us forever.
    MAX_PAGES: int = 100

    # English marker for a permanent market withdrawal (as opposed to a
    # temporary supply interruption). Seen in the "Interruption of supply
    # from" column instead of a plain date.
    _LEAVING_MARKET_RE = re.compile(
        r"leaving the market\s*\(from\s*(.+?)\)", re.IGNORECASE
    )

    _NOT_NOTIFIED_VALUES = {"not notified", "—", "-", ""}

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch every page of the ZVA medicinal product availability register
        (blank search query = full unfiltered list), English locale.

        Strategy:
        1. GET page 1 of the JSON API (q="", sort=mn-a, lang=en).
        2. Parse the HTML fragment's <table> rows with BeautifulSoup.
        3. Read the max page number out of the pagination nav embedded in
           the same fragment, then fetch remaining pages until exhausted
           or MAX_PAGES is hit.
        """
        records: list[dict] = []

        try:
            first_payload = self._get_json(
                self.API_URL,
                params={"q": "", "p": 1, "sort": "mn-a", "lang": "en"},
            )
        except Exception as exc:
            self.log.warning(
                "Failed to fetch ZVA availability register (page 1)",
                extra={"error": str(exc), "url": self.API_URL},
            )
            raise ScraperError(f"ZVA fetch failed: {exc}") from exc

        if not isinstance(first_payload, dict) or not first_payload.get("success"):
            raise ScraperError(
                f"ZVA API returned success=false or unexpected shape: "
                f"{str(first_payload)[:300]}"
            )

        html_fragment = first_payload.get("data", "")
        rows = self._parse_table_rows(html_fragment)
        records.extend(rows)

        total_pages = self._extract_total_pages(html_fragment)
        self.log.info(
            "ZVA page 1 fetched",
            extra={"rows": len(rows), "total_pages": total_pages},
        )

        page = 2
        while page <= min(total_pages, self.MAX_PAGES):
            try:
                payload = self._get_json(
                    self.API_URL,
                    params={"q": "", "p": page, "sort": "mn-a", "lang": "en"},
                )
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch ZVA page; stopping pagination early",
                    extra={"error": str(exc), "page": page},
                )
                break

            if not isinstance(payload, dict) or not payload.get("success"):
                self.log.warning(
                    "ZVA page returned success=false; stopping pagination",
                    extra={"page": page},
                )
                break

            page_rows = self._parse_table_rows(payload.get("data", ""))
            if not page_rows:
                # "Nothing was found" page or empty tail — done.
                break
            records.extend(page_rows)
            page += 1

        self.log.info("ZVA fetch complete", extra={"records": len(records)})
        return records

    def _extract_total_pages(self, html_fragment: str) -> int:
        """Read the highest data-p="N" page link out of the pagination nav."""
        page_nums = [int(n) for n in re.findall(r'data-p="(\d+)"', html_fragment)]
        return max(page_nums) if page_nums else 1

    def _parse_table_rows(self, html_fragment: str) -> list[dict]:
        """Parse the register's Bootstrap <table> body rows into raw dicts."""
        from bs4 import BeautifulSoup

        if not html_fragment or "Nothing was found" in html_fragment:
            return []

        soup = BeautifulSoup(html_fragment, "lxml")
        table = soup.find("table", class_="table")
        if table is None:
            return []

        records: list[dict] = []
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if len(cells) < 5:
                continue  # header row or malformed row

            name_cell, strength_cell, substance_cell, start_cell, resolve_cell = cells[:5]

            product_name_tag = name_cell.find("strong")
            product_name = product_name_tag.get_text(strip=True) if product_name_tag else (
                name_cell.get_text(separator=" ", strip=True)
            )

            # Package size lives in a <br/>-separated text node right after
            # the <strong> tag, e.g. "Package size: 30 pcs"
            name_text = name_cell.get_text(separator="|", strip=True)
            package_size = ""
            pkg_match = re.search(r"Package size:\s*([^|]+)", name_text)
            if pkg_match:
                package_size = pkg_match.group(1).strip()

            product_no = ""
            no_match = re.search(r"No\.:\s*([^\s|<]+)", name_text)
            if no_match:
                product_no = no_match.group(1).strip()

            # ATC code, when present, is embedded in the "find alternatives"
            # link's AK= query param.
            atc_code = ""
            alt_link = name_cell.find("a", href=True)
            if alt_link:
                atc_match = re.search(r"[?&]AK=([^&]+)", alt_link["href"])
                if atc_match:
                    from urllib.parse import unquote
                    atc_code = unquote(atc_match.group(1))

            strength = strength_cell.get_text(strip=True)
            active_substance = substance_cell.get_text(strip=True)
            start_raw = start_cell.get_text(strip=True)
            resolve_raw = resolve_cell.get_text(strip=True)

            records.append({
                "product_name":     product_name,
                "package_size":     package_size,
                "product_no":       product_no,
                "atc_code":         atc_code,
                "strength":         strength,
                "active_substance": active_substance,
                "interruption_from": start_raw,
                "predicted_availability": resolve_raw,
            })

        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ZVA register rows into standard shortage event dicts."""
        self.log.info(
            "Normalising ZVA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise ZVA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        """Convert a single ZVA register row to a normalised shortage event dict."""
        active_substance = (rec.get("active_substance") or "").strip()
        product_name = (rec.get("product_name") or "").strip()

        # Prefer the INN (active_substance); it may list multiple substances
        # comma-separated for combination products — keep the full string as
        # generic_name (matches house style elsewhere, e.g. AEMPS/ANSM combo
        # handling) rather than splitting, since drug resolution already
        # tiers down to a first-word prefix match in the base class.
        generic_name = active_substance or product_name
        if not generic_name:
            return None

        brand_names: list[str] = [product_name] if product_name else []

        interruption_from = (rec.get("interruption_from") or "").strip()
        leaving_market = self._LEAVING_MARKET_RE.search(interruption_from)

        if leaving_market:
            start_date = self._parse_en_date(leaving_market.group(1)) or date.today().isoformat()
            status = "resolved"
            reason = "Product permanently leaving the market"
            reason_category = "discontinuation"
            notes_status = f"Leaving the market (from {leaving_market.group(1).strip()})"
        else:
            start_date = self._parse_en_date(interruption_from) or date.today().isoformat()
            status = "active"
            reason = None
            reason_category = map_reason_category(None)  # -> "unknown"; ZVA does not publish a reason
            notes_status = None

        predicted_raw = (rec.get("predicted_availability") or "").strip()
        estimated_resolution_date = None
        if predicted_raw.lower() not in self._NOT_NOTIFIED_VALUES:
            estimated_resolution_date = self._parse_en_date(predicted_raw)

        notes_parts: list[str] = []
        if notes_status:
            notes_parts.append(notes_status)
        if rec.get("strength"):
            notes_parts.append(f"Strength: {rec['strength']}")
        if rec.get("package_size"):
            notes_parts.append(f"Package size: {rec['package_size']}")
        if rec.get("product_no"):
            notes_parts.append(f"Product No.: {rec['product_no']}")
        notes = "; ".join(notes_parts) or None

        source_url = self.BASE_URL
        if rec.get("atc_code"):
            source_url = (
                f"https://dati.zva.gov.lv/zalu-registrs/?iss=1&AK="
                f"{rec['atc_code']}&lang=en"
            )

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "medium",
            "reason":                    reason,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                source_url,
            "notes":                     notes,
            "source_confidence_score":   80,
            "raw_record":                rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _parse_en_date(raw: Any) -> str | None:
        """Parse ZVA's English date format ('Jun 3, 2025') to ISO-8601."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()

        raw_str = str(raw).strip()
        if not raw_str or raw_str.lower() in ("not notified", "—", "-", "n/a", "null", "none"):
            return None

        # ISO already
        iso_match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw_str)
        if iso_match:
            year, month, day = iso_match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
            except ValueError:
                pass

        # English month-name format: "Jun 3, 2025" / "January 1, 2026"
        for fmt in ("%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(raw_str, fmt).date().isoformat()
            except ValueError:
                continue

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
        print("Fetches live ZVA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = LatviaZVAScraper(db_client=MagicMock())

        print("\n-- Fetching from ZVA ...")
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

    scraper = LatviaZVAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
