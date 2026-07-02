"""
Lithuania VVKT Medicine Supply Disruption Scraper
──────────────────────────────────────────────────
Source:  VVKT — Valstybinė vaistų kontrolės tarnyba
         (State Medicines Control Agency of Lithuania)
URL:     https://vvkt.lrv.lt/

VVKT publishes a "vaistų tiekimo sutrikimai" (medicine supply disruptions)
list/page. This is expected to be a plain HTML table/list once reachable.

HARD BLOCKER — confirmed 2026-07-02
────────────────────────────────────
vvkt.lrv.lt is fronted by Cloudflare's interstitial JS challenge ("Just a
moment...", `cf-mitigated` header present, CSP referencing
challenges.cloudflare.com). This was verified live with httpx using several
realistic desktop browser User-Agent strings (Chrome/Windows, Safari/macOS,
Firefox/Windows) plus matching Accept/Accept-Language headers:

    GET https://vvkt.lrv.lt/                                    -> HTTP 403
    GET https://vvkt.lrv.lt/lt                                  -> HTTP 403
    GET https://vvkt.lrv.lt/lt/naujienos                        -> HTTP 403
    GET https://vvkt.lrv.lt/lt/veiklos-sritys/
        vaistu-tiekimo-sutrikimai                               -> HTTP 403

Every path returns the identical Cloudflare challenge HTML regardless of
User-Agent. This is NOT a naive bot-UA sniff (which a realistic browser UA
header fixes) — it is a JavaScript compute challenge that requires executing
Cloudflare's client-side challenge script in a real browser engine to obtain
a clearance cookie. That is out of scope for this scraper: no CAPTCHA/JS
challenge solving, no proxy tricks, no undisclosed header spoofing beyond a
standard realistic browser UA.

fetch() therefore raises ScraperError immediately with a clear message
rather than silently returning empty data (which would look like "zero
shortages in Lithuania" instead of "source unreachable"). normalize() is
still fully implemented against the expected page structure (a list of
disruption entries, each with drug name / dates / status / reason) so that
this scraper is fetch-ready the moment the block is lifted — e.g. if a
headless-browser fetch layer (Playwright with a real Chromium engine, which
can pass Cloudflare's JS challenge legitimately) is added to the shared
scraper infra, or VVKT exposes a non-challenged API/RSS endpoint.

Lithuanian key terms relied on for parsing (once reachable)
─────────────────────────────────────────────────────────────
    sutrikimai        = disruptions
    tiekimo sutrikimai = supply disruptions
    trūkumas          = shortage
    vaistas / vaistai = medicine(s)/drug(s)
    veikliosios medžiagos = active substance(s) (≈ generic/INN name)
    prekinis pavadinimas  = trade/brand name
    pradžios data     = start date
    pabaigos data     = end date
    galiojimo pabaiga = validity end (used for resolved/expired entries)
    būsena / statusas = status
    aktyvus / vykstantis = active / ongoing
    baigtas / išspręstas  = ended / resolved
    numatomas / planuojamas = anticipated / planned
    priežastis        = reason
    gamybos problema  = manufacturing problem
    žaliavos trūkumas = raw material shortage
    padidėjusi paklausa = increased demand
    tiekimo grandinės sutrikimas = supply chain disruption
    platinimo problema = distribution problem
    registracijos panaikinimas = registration/marketing authorisation
                                  withdrawal (discontinuation)

Data source UUID:  10000000-0000-0000-0000-000000000112 (migration 064)
Country:           Lithuania
Country code:      LT
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class LithuaniaVVKTScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000112"
    SOURCE_NAME: str  = "VVKT — Vaistu tiekimo sutrikimai (Lithuania)"
    BASE_URL: str     = "https://vvkt.lrv.lt/"
    COUNTRY: str      = "Lithuania"
    COUNTRY_CODE: str = "LT"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Candidate path for the medicine supply disruptions listing. Best-guess
    # slug pending confirmation once the Cloudflare block is lifted (VVKT's
    # site nav groups this under "Veiklos sritys" -> medicine supply).
    DISRUPTIONS_URL: str = (
        "https://vvkt.lrv.lt/lt/veiklos-sritys/vaistu-tiekimo-sutrikimai"
    )

    # Realistic desktop browser headers. Verified live (2026-07-02) that this
    # does NOT get past the block — vvkt.lrv.lt is behind a Cloudflare JS
    # challenge, not a simple User-Agent sniff. Kept as the standard
    # honest-browser header set for whenever the block changes (e.g. an
    # allowlist added upstream, or a headless-browser fetch layer lands).
    DEFAULT_HEADERS: dict[str, str] = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "lt-LT,lt;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
    }

    # Lithuanian reason phrase -> canonical reason_category. Checked before
    # falling back to the centralized map_reason_category() (which does not
    # cover Lithuanian).
    _REASON_MAP: dict[str, str] = {
        "gamybos problema":            "manufacturing_issue",
        "gamybos sutrikimas":          "manufacturing_issue",
        "kokybes problema":            "manufacturing_issue",
        "zaliavos trukumas":           "raw_material",
        "veikliosios medziagos trukumas": "raw_material",
        "padidejusi paklausa":         "demand_surge",
        "isaugusi paklausa":           "demand_surge",
        "tiekimo grandines sutrikimas": "supply_chain",
        "tiekimo sutrikimas":          "supply_chain",
        "pasaulinis trukumas":         "supply_chain",
        "platinimo problema":          "distribution",
        "importo problema":            "distribution",
        "registracijos panaikinimas":  "discontinuation",
        "rinkos atsisakymas":          "discontinuation",
        "nutraukta gamyba":            "discontinuation",
        "reguliavimo priezastis":      "regulatory_action",
    }

    # Status keywords (Lithuanian)
    _RESOLVED_WORDS = ("baigtas", "isspresta", "atnaujintas tiekimas", "atnaujinta")
    _ANTICIPATED_WORDS = ("numatomas", "planuojamas", "galimas", "tiketinas")

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the VVKT medicine supply disruptions list.

        HARD BLOCKER: vvkt.lrv.lt is behind a Cloudflare JavaScript challenge
        that returns HTTP 403 for every path regardless of a realistic
        browser User-Agent (confirmed with Chrome/Windows, Safari/macOS, and
        Firefox/Windows UA strings — see module docstring). This is not a
        UA-sniffing block that a header fix solves; it requires executing a
        JS challenge in a real browser engine, which is out of scope here.

        Raises ScraperError unconditionally until the upstream block is
        lifted or a legitimate browser-engine fetch layer is added to the
        shared scraper infrastructure.
        """
        self.log.warning(
            "VVKT (Lithuania) is behind a Cloudflare JS challenge — "
            "confirmed 403 with realistic browser User-Agent headers. "
            "This is a hard blocker, not a UA-sniffing issue.",
            extra={"source": self.SOURCE_NAME, "url": self.DISRUPTIONS_URL},
        )
        try:
            resp = self._get(self.DISRUPTIONS_URL)
        except Exception as exc:
            raise ScraperError(
                "VVKT fetch blocked: vvkt.lrv.lt returns HTTP 403 via a "
                "Cloudflare JavaScript challenge for every path, even with "
                "a realistic desktop browser User-Agent. Solving the "
                "challenge requires a real browser engine (e.g. headless "
                "Chromium) which this scraper deliberately does not attempt "
                f"(no CAPTCHA/JS-challenge bypass). Underlying error: {exc}"
            ) from exc

        # If we ever get here (block lifted), parse the real page.
        return self._parse_disruptions_page(resp.text)

    def _parse_disruptions_page(self, html: str) -> list[dict]:
        """
        Parse the VVKT medicine supply disruptions HTML page/table.

        Expected structure (typical Lithuanian .lrv.lt government site): a
        table or repeated card/list block per disruption, each carrying the
        active substance / trade name, start date, status, and reason. Since
        the page has never been successfully fetched, this parser targets the
        most common structure for these sites (a <table> of rows) with a
        generic list-item fallback, and is defensive about missing fields.
        """
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        records: list[dict] = []

        table = soup.find("table")
        if table:
            rows = table.find_all("tr")
            headers = [
                th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])
            ] if rows else []

            for row in rows[1:]:
                cells = row.find_all("td")
                if not cells:
                    continue
                values = [c.get_text(separator=" ", strip=True) for c in cells]
                rec: dict[str, Any] = {"raw_text": " | ".join(values)}
                for i, val in enumerate(values):
                    key = headers[i] if i < len(headers) else f"col_{i}"
                    rec[key] = val
                records.append(rec)
        else:
            # Fallback: repeated list/card items
            items = soup.find_all(["li", "article", "div"], class_=re.compile(
                r"disrupt|sutrikim|list-item|card", re.I
            ))
            for item in items:
                text = item.get_text(separator=" ", strip=True)
                if not text:
                    continue
                link = item.find("a", href=True)
                records.append({
                    "raw_text": text,
                    "url": link["href"] if link else None,
                })

        self.log.info(
            "Parsed VVKT disruptions page",
            extra={"records": len(records)},
        )
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize VVKT records into standard shortage event dicts."""
        self.log.info(
            "Normalising VVKT records",
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
                    "Failed to normalise VVKT record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single VVKT record to a normalised shortage event dict."""
        raw_text = (rec.get("raw_text") or "").strip()
        if not raw_text:
            return None

        # -- Drug name -- prefer an explicit "active substance" style column
        # if the table parser found one, else fall back to free-text guess.
        generic_name = (
            rec.get("veikliosios medziagos")
            or rec.get("veiklioji medziaga")
            or rec.get("vaisto pavadinimas")
            or rec.get("preparatas")
            or self._extract_drug_name(raw_text)
        )
        if not generic_name:
            generic_name = raw_text[:100]

        # -- Brand name --
        brand_names: list[str] = []
        brand = rec.get("prekinis pavadinimas") or rec.get("preke")
        if brand and brand.strip() and brand.strip() != generic_name:
            brand_names.append(brand.strip())

        # -- Reason --
        raw_reason = rec.get("priezastis") or self._extract_reason(raw_text)
        reason_category = self._map_reason(raw_reason)

        # -- Dates --
        start_raw = rec.get("pradzios data") or rec.get("pradzia") or rec.get("data")
        start_date = self._parse_date(start_raw) or today

        end_raw = rec.get("pabaigos data") or rec.get("pabaiga")
        end_date = self._parse_date(end_raw)

        # -- Status --
        status = self._determine_status(raw_text, has_end_date=bool(end_date))

        # -- Source URL --
        source_url = rec.get("url") or self.DISRUPTIONS_URL

        # -- Notes --
        notes_parts: list[str] = []
        if raw_reason:
            notes_parts.append(f"Priezastis (reason): {raw_reason}")
        notes_parts.append(f"Raw: {raw_text[:200]}")
        notes = "; ".join(notes_parts) or None

        result: dict[str, Any] = {
            "generic_name":    generic_name.strip().title(),
            "brand_names":     brand_names,
            "status":          status,
            "severity":        "medium",
            "reason":          raw_reason or None,
            "reason_category": reason_category,
            "start_date":      start_date,
            "source_url":      source_url,
            "notes":           notes,
            "raw_record":      rec,
        }
        if end_date:
            result["end_date"] = end_date
        return result

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, raw: str | None) -> str:
        """Map a VVKT reason string (Lithuanian) to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = self._strip_diacritics(raw.strip().lower())
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper (covers English if VVKT mixes languages)
        return map_reason_category(raw)

    def _determine_status(self, text: str, has_end_date: bool = False) -> str:
        """Determine shortage status from notice text (Lithuanian)."""
        lower = self._strip_diacritics(text.lower())
        if has_end_date or any(w in lower for w in self._RESOLVED_WORDS):
            return "resolved"
        if any(w in lower for w in self._ANTICIPATED_WORDS):
            return "anticipated"
        return "active"

    def _extract_drug_name(self, text: str) -> str:
        """
        Best-effort drug name extraction from free text when no structured
        column is available. Looks for a capitalised leading token sequence
        (INN/brand names are typically capitalised in these notices).
        """
        matches = re.findall(r"\b([A-ZĄČĘĖĮŠŲŪŽ][\wąčęėįšųūž]{2,})\b", text)
        stopwords = {
            "Vaistu", "Vaisto", "Tiekimo", "Sutrikimas", "Sutrikimai",
            "Trukumas", "Prekinis", "Pavadinimas", "Veikliosios", "Medziagos",
            "Pradzios", "Pabaigos", "Data", "Busena", "Priezastis", "VVKT",
            "Valstybine", "Vaistu Kontroles", "Tarnyba",
        }
        for match in matches:
            if match not in stopwords and len(match) > 2:
                return match
        return ""

    def _extract_reason(self, text: str) -> str:
        """Extract a shortage reason phrase from free text (Lithuanian)."""
        lower = self._strip_diacritics(text.lower())
        for phrase in self._REASON_MAP:
            if phrase in lower:
                return phrase
        return ""

    @staticmethod
    def _strip_diacritics(text: str) -> str:
        """Strip Lithuanian diacritics (ą č ę ė į š ų ū ž) for keyword matching."""
        table = str.maketrans(
            "ąčęėįšųūžĄČĘĖĮŠŲŪŽ",
            "aceeisuuzACEEISUUZ",
        )
        return text.translate(table)

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
        if not raw_str or raw_str in ("-", "N/A", "null", "None", ""):
            return None

        # ISO format: YYYY-MM-DD
        iso_match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw_str)
        if iso_match:
            year, month, day = iso_match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
            except ValueError:
                pass

        # DD-MM-YYYY or DD.MM.YYYY (common in Lithuania)
        dmy_match = re.match(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", raw_str)
        if dmy_match:
            day, month, year = dmy_match.groups()
            try:
                return datetime(int(year), int(month), int(day)).date().isoformat()
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
        print("Fetches live VVKT data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = LithuaniaVVKTScraper(db_client=MagicMock())

        print("\n-- Fetching from VVKT ...")
        try:
            raw = scraper.fetch()
        except Exception as exc:
            print(f"\n!! Fetch failed (expected if Cloudflare block is still up): {exc}")
            print(
                "\nThis is a documented HARD BLOCKER: vvkt.lrv.lt returns "
                "HTTP 403 via a Cloudflare JS challenge for every path, even "
                "with a realistic browser User-Agent. See module docstring."
            )
            sys.exit(1)

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

    scraper = LithuaniaVVKTScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
