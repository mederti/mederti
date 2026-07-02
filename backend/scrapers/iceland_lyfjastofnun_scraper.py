"""
Iceland Lyfjastofnun Drug Shortage Scraper
-------------------------------------------
Source:  Lyfjastofnun (Icelandic Medicines Agency) — Tilkynntur lyfjaskortur
         ("Reported drug shortage")
URL:     https://lyfjastofnun.is/lyf/lyfjaskortur/tilkynntur-lyfjaskortur/

The Icelandic Medicines Agency publishes a single searchable/filterable page
that server-renders EVERY reported shortage record directly into the HTML
(one <div class="apotek__item"> block per record; ~2,850 records observed on
2026-07-02). There is NO separate JSON/AJAX endpoint backing this — the
"Leita"/filter UI on the page is a client-side JS filter (filtersearch/
livesearch) operating on the fully-rendered DOM, not a server query. This was
confirmed by fetching the page directly with curl: the response is ~6.9MB of
static HTML containing every record, and grepping for admin-ajax/wp-json/
data-endpoint/data-api turned up nothing shortage-related (only an unrelated
analytics beacon). So fetch() does a single GET of BASE_URL and normalize()
parses the DOM with BeautifulSoup — no pagination or follow-up requests
needed.

Each item block looks like:
    <div class="apotek__item" data-tags="016635,N05AX12,...">
      <h3 class="apotek__item__title">
        <button class="apotek__item__button">ABILIFY <span>5 mg</span></button>
        <span class="apotek__title--region">Lokið</span>   <!-- status -->
        ...
      </h3>
      <div class="apotek__item__text">
        <ul class="apotek__list">
          <li><strong>Styrkur:</strong> 5 mg</li>                (strength)
          <li><strong>Magn:</strong> 56 stk.</li>                (pack size)
          <li><strong>Lyfjaheiti:</strong> ABILIFY</li>          (brand/trade name)
          <li><strong>Lyfjaform:</strong> Tafla</li>             (dosage form)
          <li><strong>Flokkur:</strong> Lyf fyrir menn</li>      (human/vet category)
          <li><strong>Vörunúmer:</strong> 016635</li>            (product/registration number)
          <li><strong>ATC flokkur:</strong> N05AX12</li>         (ATC code)
        </ul>
        <ul class="apotek__list">
          <li><strong>Markaðsleyfishafi:</strong> ...</li>       (marketing authorisation holder)
          <li><strong>Umboðsaðili:</strong> ...</li>             (local agent/distributor)
          <li><strong>Áætluð lok:</strong> 02.07.2026</li>       (estimated END date, DD.MM.YYYY)
          <li><strong>Áætlað upphaf:</strong> 02.07.2026</li>    (estimated START date, DD.MM.YYYY)
          <li><strong>Tilkynnt:</strong> 06/23/2026 05:27:52</li> (reported timestamp, MM/DD/YYYY!)
          <li><strong>Innihaldsefni:</strong> Aripiprazolum INN</li> (active ingredient / INN)
          <li><strong>Ástæða:</strong> ...</li>                  (reason — present on ~4% of rows,
                                                                    mostly deregistration records)
        </ul>
        <ul class="apotek__list apotek__list--full">
          <li><strong>Ráðleggingar:</strong> ...</li>            (pharmacist guidance / alternatives
                                                                    available — NOT a shortage
                                                                    reason, goes into notes)
        </ul>
      </div>
    </div>

Icelandic key terms relied on:
    lyfjaskortur   = drug shortage
    tilkynntur     = reported (as in "tilkynntur lyfjaskortur" = reported drug shortage)
    í skorti       = "in shortage" (status → active)
    lokið          = "finished/closed" (status → resolved)
    afskráning     = "deregistration" (status → discontinuation, mapped to resolved
                                        with reason_category=discontinuation)
    ástæða         = reason
    innihaldsefni  = active ingredient (INN)
    lyfjaheiti     = drug/brand name
    styrkur        = strength
    magn           = quantity/pack size
    lyfjaform      = dosage form
    vörunúmer      = product/registration number
    áætlað upphaf  = estimated start (of the shortage)
    áætluð lok     = estimated end (of the shortage)
    tilkynnt       = reported / notified (timestamp the record was logged)
    ráðleggingar   = recommendations (substitution guidance — informational, not a reason)
    heildsölustig  = wholesale level (as in "shortage at wholesale level")
    markaðsleyfishafi = marketing authorisation holder
    umboðsaðili    = local agent / distributor
    samheitalyf    = generic medicine (as in "generic is on the market")

Data source UUID:  10000000-0000-0000-0000-000000000105
Country:           Iceland
Country code:      IS
Reliability:       0.85 (per migration 064 seed)

Cron: not wired by this change — someone else integrates new scrapers.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class IcelandLyfjastofnunScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000105"
    SOURCE_NAME: str  = "Lyfjastofnun — Tilkynntur lyfjaskortur (Iceland Medicines Agency)"
    BASE_URL: str     = "https://lyfjastofnun.is/lyf/lyfjaskortur/tilkynntur-lyfjaskortur/"
    COUNTRY: str      = "Iceland"
    COUNTRY_CODE: str = "IS"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Status values used by the site (span attribute apotek__title--region)
    _STATUS_MAP: dict[str, str] = {
        "í skorti":   "active",
        "lokið":      "resolved",
        "afskráning": "resolved",  # deregistration — permanently discontinued
    }

    # Free-text Icelandic "Ástæða" (reason) phrases -> reason_category.
    # Fed into map_reason_category() as a fallback for anything not matched
    # here (that mapper is English/French/Italian/Spanish/German-oriented and
    # won't recognise Icelandic, so most of the mapping burden sits here).
    _REASON_MAP: dict[str, str] = {
        "afskráning":                       "discontinuation",
        "of lítil sala":                    "discontinuation",
        "framleiðslutengt vandamál":        "manufacturing_issue",
        "framleiðsla fullnægir ekki":       "manufacturing_issue",
        "gæðavandamál":                     "manufacturing_issue",
        "gæðaprófunar":                     "manufacturing_issue",
        "gæðastöðlum":                      "manufacturing_issue",
        "vandamál við lyfjadreifingu":      "distribution",
        "seinkun":                          "distribution",
        "aukin eftirspurn":                 "demand_surge",
        "aukin sala":                       "demand_surge",
        "fullnægir ekki eftirspurn":        "demand_surge",
        "skortur á virka innihaldsefninu":  "raw_material",
        "tefur framleiðslu":                "raw_material",
        "annað":                            "other",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> str:
        """
        Fetch the Lyfjastofnun reported-shortage page.

        The full record set (~2,850 rows as of 2026-07-02) is rendered
        server-side into the page HTML; the on-page "Leita" filter operates
        client-side over that DOM. One GET is sufficient — no pagination or
        AJAX endpoint exists for this dataset.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        try:
            resp = self._get(self.BASE_URL)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch Lyfjastofnun shortage page",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            raise ScraperError(f"Lyfjastofnun fetch failed: {exc}") from exc

        html = resp.text
        self.log.info("Lyfjastofnun fetch complete", extra={"bytes": len(html)})
        return html

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: str) -> list[dict]:
        """Parse the shortage-listing HTML into standard shortage event dicts."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw, "lxml")
        items = soup.select("div.apotek__item")

        self.log.info(
            "Parsing Lyfjastofnun shortage items",
            extra={"source": self.SOURCE_NAME, "items_found": len(items)},
        )

        normalised: list[dict] = []
        skipped = 0

        for item in items:
            try:
                result = self._normalise_item(item)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise Lyfjastofnun item",
                    extra={"error": str(exc)},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(items), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_item(self, item: Any) -> dict | None:
        """Convert a single <div class="apotek__item"> into a normalised dict."""
        title_btn = item.select_one(".apotek__item__button")
        title = title_btn.get_text(" ", strip=True) if title_btn else ""

        status_el = item.select_one(".apotek__title--region")
        status_raw = status_el.get_text(strip=True) if status_el else ""

        fields = self._extract_fields(item)

        # -- Generic name (INN) --
        ingredient = fields.get("Innihaldsefni", "").strip()
        generic_name = self._clean_inn(ingredient)
        if not generic_name:
            # Fall back to the brand/trade name if no INN was published
            brand_fallback = fields.get("Lyfjaheiti", "").strip() or title
            generic_name = brand_fallback
        if not generic_name:
            return None

        # -- Brand name --
        brand_names: list[str] = []
        brand = fields.get("Lyfjaheiti", "").strip()
        if brand and brand.lower() != generic_name.lower():
            brand_names.append(brand)

        # -- Status --
        status = self._STATUS_MAP.get(status_raw.strip().lower(), "active")

        # -- Reason --
        raw_reason = fields.get("Ástæða", "").strip()
        reason_category = self._map_reason(raw_reason) if raw_reason else (
            "discontinuation" if status_raw.strip().lower() == "afskráning" else "unknown"
        )

        # -- Dates --
        estimated_start = self._parse_dotted_date(fields.get("Áætlað upphaf", ""))
        estimated_end = self._parse_dotted_date(fields.get("Áætluð lok", ""))
        reported_at = self._parse_reported_timestamp(fields.get("Tilkynnt", ""))

        start_date = estimated_start or reported_at or date.today().isoformat()

        end_date = None
        if status == "resolved":
            end_date = estimated_end or reported_at

        # Sanity-guard against the site's "no known end" placeholder value.
        if estimated_end == "2100-12-31":
            estimated_end = None

        # -- Severity heuristic from the "Ráðleggingar" guidance text --
        guidance = fields.get("Ráðleggingar", "").strip()
        severity = self._infer_severity(guidance)

        # -- Notes --
        notes_parts: list[str] = []
        if guidance:
            notes_parts.append(f"Ráðleggingar (guidance): {guidance}")
        if fields.get("Styrkur"):
            notes_parts.append(f"Styrkur (strength): {fields['Styrkur']}")
        if fields.get("Lyfjaform"):
            notes_parts.append(f"Lyfjaform (form): {fields['Lyfjaform']}")
        if fields.get("Markaðsleyfishafi"):
            notes_parts.append(f"MAH: {fields['Markaðsleyfishafi']}")
        if fields.get("Umboðsaðili"):
            notes_parts.append(f"Local agent: {fields['Umboðsaðili']}")
        notes = "; ".join(notes_parts) or None

        raw_record = {
            "title": title,
            "status_raw": status_raw,
            **fields,
        }

        result: dict[str, Any] = {
            "generic_name":            generic_name,
            "brand_names":             brand_names,
            "status":                  status,
            "severity":                severity,
            "reason":                  raw_reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "end_date":                end_date,
            "source_url":              self.BASE_URL,
            "notes":                   notes,
            "source_confidence_score": 85,
            "raw_record":              raw_record,
        }
        if estimated_end:
            result["estimated_resolution_date"] = estimated_end

        return result

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _extract_fields(item: Any) -> dict[str, str]:
        """Pull every <li><strong>Label:</strong> value</li> pair into a dict."""
        fields: dict[str, str] = {}
        for li in item.select("li.apotek__list__li"):
            strong = li.find("strong")
            if not strong:
                continue
            label = strong.get_text(strip=True).rstrip(":")
            full_text = li.get_text(" ", strip=True)
            label_text = strong.get_text(strip=True)
            value = full_text[len(label_text):].strip()
            fields[label] = value
        return fields

    @staticmethod
    def _clean_inn(raw: str) -> str:
        """
        Strip pharmacopeial suffixes/salt qualifiers from an "Innihaldsefni"
        value, e.g. "Aripiprazolum INN" -> "Aripiprazolum",
        "Nilotinibum INN hýdróklóríð" -> "Nilotinibum".

        Multi-ingredient combos (comma-separated) are kept as-is (joined)
        since splitting them would misrepresent the product as a
        single-ingredient shortage.
        """
        if not raw:
            return ""
        # Only strip the trailing " INN" / " INN <salt>" pattern; leave
        # commas (combination products) intact.
        cleaned = re.sub(r"\s+INN\b.*$", "", raw, flags=re.IGNORECASE).strip()
        return cleaned or raw.strip()

    def _map_reason(self, raw: str) -> str:
        """Map an Icelandic 'Ástæða' reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to the centralised (mostly English/Romance-language) mapper
        # in case a future reason string happens to share a recognised term.
        return map_reason_category(raw)

    @staticmethod
    def _infer_severity(guidance: str) -> str:
        """
        Heuristic severity from the Icelandic pharmacist-guidance text:
          - "no comparable medicine available" -> high
          - "short wholesale-level shortage, unlikely to affect patients" -> low
          - everything else -> medium
        """
        lower = guidance.lower()
        if "ekkert sambærilegt lyf" in lower:
            return "high"
        if "stuttur skortur" in lower and "ólíklegt" in lower:
            return "low"
        return "medium"

    @staticmethod
    def _parse_dotted_date(raw: str) -> str | None:
        """Parse an Icelandic DD.MM.YYYY date string to ISO-8601."""
        if not raw:
            return None
        match = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", raw.strip())
        if not match:
            return None
        day, month, year = match.groups()
        try:
            return date(int(year), int(month), int(day)).isoformat()
        except ValueError:
            return None

    @staticmethod
    def _parse_reported_timestamp(raw: str) -> str | None:
        """
        Parse the "Tilkynnt" (reported) timestamp, which is rendered in
        MM/DD/YYYY HH:MM:SS format (confirmed empirically: the first
        component is never >12 while the second frequently is).
        """
        if not raw:
            return None
        match = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw.strip())
        if not match:
            return None
        month, day, year = match.groups()
        try:
            return date(int(year), int(month), int(day)).isoformat()
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
        print("Fetches live Lyfjastofnun data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = IcelandLyfjastofnunScraper(db_client=MagicMock())

        print("\n-- Fetching from Lyfjastofnun ...")
        raw = scraper.fetch()
        print(f"-- Raw HTML bytes received : {len(raw)}")

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

    scraper = IcelandLyfjastofnunScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
