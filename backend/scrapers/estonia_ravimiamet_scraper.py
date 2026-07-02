"""
Estonia Ravimiamet (State Agency of Medicines) Supply Difficulty Scraper
-------------------------------------------------------------------------
Source:  Ravimiamet news feed — individual "tarneraskus" (supply difficulty)
         announcements
URL:     https://www.ravimiamet.ee/rss-feeds/rss.xml (feed) and
         https://ravimiamet.ee/ravimid-ja-ohutus/ravimi-kaitlemine/tarneraskused
         (methodology page)

Research finding (2026-07-02): Estonian shortage information is NOT exposed
as a standalone machine-readable list. Ravimiamet's own "Tarneraskused" page
(https://ravimiamet.ee/ravimid-ja-ohutus/ravimi-kaitlemine/tarneraskused)
explicitly documents that availability is shown as a colour-coded flag
("punasel taustal" = red background) on individual drugs *within general
drug-register search results* at ravimiregister.ee — there is no exportable
bulk list.

ravimiregister.ee itself was investigated directly (both the base page and
every discoverable ASP.NET PageMethod / postback target: doSearchButton,
doDrugSearchButton, downloadsButton, itemsButton). It is a legacy ASP.NET
WebForms single-page app: the base HTML is a static shell served for every
route (including `?pv=PublicMedDetail&vid=...` and `?pv=PublicSearchResult`),
and ALL search/result rendering happens client-side in JavaScript. A faithful
replication of the `__doPostBack('publicSearch$doSearchButton', ...)` full
form submission (every field, checkbox default state, VIEWSTATE/EVENTVALIDATION,
session cookies, Referer/Origin headers) was confirmed via diffing to return
a byte-identical page (only VIEWSTATE/calendar-widget nonces differ) — i.e.
the postback is a client-only handler that does nothing server-side. No
JSON/XHR endpoint beyond the five already-visible ATC-tree PageMethods
(GetATCToimeaine, GetATCPakendid, GetATCTase, GetATCJaToimeained, SendMail)
could be found; brute-forcing likely endpoint names returned only generic
"Koodikeskus" error pages. Bulk "Andmete allalaadimine" (data download) and
"Loendid" (lists) header buttons are also client-side-only (same no-op
postback signature). In short: ravimiregister.ee's shortage flag cannot be
scraped without executing real browser JavaScript, which is outside
BaseScraper's httpx-only toolset — flagging for a future headless-browser
pass (see class docstring note below).

WORKING DATA SOURCE USED INSTEAD: Ravimiamet separately publishes each
individual shortage as a **news article** titled "Ravimi <name> tarneraskus"
/ "Ravimite <name1> ja <name2> tarneraskus" ("<drug> supply difficulty").
These are ordinary, fully server-rendered Drupal content (confirmed via
plain httpx GET — no JS required) and are indexed in a real RSS feed:

    https://www.ravimiamet.ee/rss-feeds/rss.xml   (~100 most recent items,
                                                    all content types mixed)

Each matching item's <title>/<description>/<link>/<pubDate> gives:
  - brand/product name(s) (parsed out of the title)
  - the Estonian-spelled active substance, when the description names it
    ("... toimeainet <substance>" / "... toimeainena <substance>")
  - marketing authorisation holder, expected resolution timing, and
    recommended alternatives (free text in the description / full article)
  - publication date, used as start_date (the date Ravimiamet issued the
    notice, which is the best available proxy for shortage onset since no
    structured start/end date field is exposed)

Ravimiamet does not appear to publish a distinct "shortage resolved"
follow-up article on the same slug (the article body itself states ongoing
status updates live in the register, e.g. "info on jälgitav ravimiregistris"
— "info can be tracked in the medicine register"). Every article emitted by
this scraper is therefore treated as status='active' — there is no reliable
static signal for resolution. Because the feed only covers a rolling recent
window (~7 months as of this research pass, no page/offset parameter that
returns different content), this scraper naturally ages out old notices as
Ravimiamet's own feed does; BaseScraper's mark_stale_shortages() housekeeping
handles the rest.

Estonian keywords relied on:
    tarneraskus / tarneraskused  = supply difficulty / supply difficulties
                                    (primary keyword — title + RSS filter)
    ravim / ravimid              = medicine / medicines (singular/plural,
                                    used to distinguish "Ravimi X" vs
                                    "Ravimite X ja Y" title patterns)
    toimeaine(t/na)               = active substance (accusative/essive
                                    case) — best-effort secondary signal,
                                    Estonian-spelled INN (e.g. "diasepaami"
                                    -> "diasepaam", not the INN "diazepam")
    müügiloa hoidja               = marketing authorisation holder
    tarneraskus on lõppenud       = "the supply difficulty has ended" —
                                    checked for or, if ever seen in a title/
                                    description, mapped to status='resolved'
    tarnehäire                    = supply disruption (synonym occasionally
                                    used instead of "tarneraskus"; also
                                    matched)

Data source UUID:  10000000-0000-0000-0000-000000000113
Country:           Estonia
Country code:      EE
Confidence:        78/100 (seeded in migration 064) — per-notice announcements
                    are real and specific, but this is a narrower signal than
                    the full colour-flagged register; a headless-browser
                    follow-up against ravimiregister.ee would materially
                    increase coverage and precision (exact start/resolution
                    dates, full drug list rather than only newsworthy cases).

Cron:  Daily (recommended; not wired into crontab_fixed.txt by this change)
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class EstoniaRavimiametScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000113"
    SOURCE_NAME: str  = "Ravimiamet — Ravimiregister tarneraskused (Estonia)"
    BASE_URL: str     = "https://ravimiregister.ee/"
    COUNTRY: str      = "Estonia"
    COUNTRY_CODE: str = "EE"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Ravimiamet's general news RSS feed (NOT shortage-specific — filtered
    # client-side below). Confirmed server-rendered static XML, no JS needed.
    RSS_URL: str = "https://www.ravimiamet.ee/rss-feeds/rss.xml"

    # Methodology / "how shortages work in Estonia" page, used as the
    # fallback source_url and to document the register's flag mechanism.
    METHODOLOGY_URL: str = (
        "https://ravimiamet.ee/ravimid-ja-ohutus/ravimi-kaitlemine/tarneraskused"
    )

    # Keywords used to filter the general news feed down to shortage notices.
    _SHORTAGE_KEYWORDS: list[str] = [
        "tarneraskus",
        "tarneraskused",
        "tarnehäire",
        "tarnehäired",
    ]

    # Marks an explicit "the shortage has ended" notice, if Ravimiamet ever
    # publishes one under these keywords (not observed in the current feed
    # window, but handled defensively).
    _RESOLVED_KEYWORDS: list[str] = [
        "tarneraskus on lõppenud",
        "tarneraskused on lõppenud",
        "tarned on taastunud",
        "tarne on taastunud",
    ]

    # "Ravimi <name> tarneraskus" (singular) / "Ravimite <name> tarneraskus"
    # (plural, name may contain " ja " joining multiple brands).
    _TITLE_RE = re.compile(
        r"^Ravim(?:i|ite)\s+(.+?)\s+tarneraskus", re.IGNORECASE
    )

    # Best-effort Estonian-inflected active-substance extraction:
    # "toimeainet X" (partitive) / "toimeainena X" (essive) / "toimeaine X".
    _SUBSTANCE_RE = re.compile(
        r"toimeaine\w*\s+(?:on\s+)?([a-züõöä][a-züõöä\-]{2,})",
        re.IGNORECASE,
    )

    # Marketing authorisation holder: "Müügiloa hoidja <Company Name> ..."
    _MAH_RE = re.compile(
        r"Müügiloa hoidja\s+([A-ZÖÜÄ][\w.\-]*(?:\s+[A-ZÖÜÄ&][\w.\-]*){0,4})",
    )

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch Ravimiamet's general news RSS feed and keep only items whose
        title or description mentions a supply-difficulty keyword.

        The feed mixes every news category (marketing-authorisation
        bulletins, device recalls, webinars, etc.) — filtering client-side
        is required since there is no per-category feed URL that works
        without JS (confirmed: /uudised itself is a JS search widget).
        """
        try:
            resp = self._get(self.RSS_URL)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch Ravimiamet RSS feed",
                extra={"error": str(exc), "url": self.RSS_URL},
            )
            raise ScraperError(f"Ravimiamet RSS fetch failed: {exc}") from exc

        records = self._parse_rss(resp.text)
        self.log.info(
            "Ravimiamet fetch complete",
            extra={"total_items": records.get("total_items", 0), "matched": len(records.get("items", []))},
        )
        return records.get("items", [])

    def _parse_rss(self, xml_text: str) -> dict:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(xml_text, "xml")
        all_items = soup.find_all("item")
        matched: list[dict] = []

        for item in all_items:
            title = (item.find("title").get_text(strip=True) if item.find("title") else "")
            description = (item.find("description").get_text(strip=True) if item.find("description") else "")
            link = (item.find("link").get_text(strip=True) if item.find("link") else "")
            pub_date = (item.find("pubDate").get_text(strip=True) if item.find("pubDate") else "")

            haystack = f"{title} {description}".lower()
            if not any(kw in haystack for kw in self._SHORTAGE_KEYWORDS):
                continue

            matched.append({
                "title":       title,
                "description": description,
                "link":        link,
                "pub_date":    pub_date,
            })

        return {"total_items": len(all_items), "items": matched}

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize matched Ravimiamet news items into shortage event dicts.

        A single article can name multiple brands ("Ravimite X ja Y
        tarneraskus") — each brand becomes its own shortage event sharing
        the article's date/reason/notes, since shortage_events is keyed
        per-drug.
        """
        self.log.info(
            "Normalising Ravimiamet records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                results = self._normalise_record(rec)
                if not results:
                    skipped += 1
                    continue
                normalised.extend(results)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise Ravimiamet record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> list[dict]:
        """Convert a single Ravimiamet news item into 1+ shortage event dicts
        (1 per named brand)."""
        title = (rec.get("title") or "").strip()
        description = (rec.get("description") or "").strip()
        link = (rec.get("link") or "").strip() or self.METHODOLOGY_URL

        if not title:
            return []

        brand_names = self._extract_brand_names(title)
        if not brand_names:
            # Title doesn't match the "Ravim(i/te) X tarneraskus" pattern —
            # this is reliably a false positive from the keyword filter
            # (e.g. a medical-device guidance update that merely mentions
            # "tarnehäiretest" in passing), not a drug shortage notice with
            # an unusual title. Skip rather than fabricate a drug name from
            # the whole headline.
            self.log.debug(
                "Skipping non-drug-shortage news item matched by keyword filter",
                extra={"title": title},
            )
            return []

        substance = self._extract_substance(description)
        mah = self._extract_mah(description)

        haystack = f"{title} {description}".lower()
        status = "resolved" if any(
            kw in haystack for kw in self._RESOLVED_KEYWORDS
        ) else "active"

        reason_text = "Supply difficulty notified to Ravimiamet"
        reason_category = map_reason_category(description) or "unknown"

        start_date = self._parse_rss_date(rec.get("pub_date")) or date.today().isoformat()

        notes_parts: list[str] = []
        if substance:
            notes_parts.append(f"Active substance (Estonian spelling): {substance}")
        if mah:
            notes_parts.append(f"Marketing authorisation holder: {mah}")
        if description:
            notes_parts.append(description[:500])
        notes = " | ".join(notes_parts) or None

        events: list[dict] = []
        for brand in brand_names:
            generic_name = brand.strip()
            if not generic_name:
                continue
            events.append({
                "generic_name":            generic_name,
                "brand_names":             [b.strip() for b in brand_names if b.strip()],
                "status":                  status,
                "severity":                "medium",
                "reason":                  reason_text,
                "reason_category":         reason_category,
                "start_date":              start_date,
                "source_url":              link,
                "notes":                   notes,
                "source_confidence_score": 78,
                "raw_record":              rec,
            })
        return events

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _extract_brand_names(self, title: str) -> list[str]:
        """Parse brand name(s) out of a "Ravimi(te) X (ja Y) tarneraskus" title."""
        match = self._TITLE_RE.match(title)
        if not match:
            return []
        raw_names = match.group(1)
        # Split multi-brand titles joined with " ja " (Estonian "and"),
        # but only when it looks like two separate products (each side
        # non-trivial) rather than a brand name that legitimately contains
        # " ja " (rare, but guard against zero-length splits).
        parts = re.split(r"\s+ja\s+", raw_names)
        names = [p.strip(" ,") for p in parts if p.strip(" ,")]
        return names or [raw_names.strip()]

    def _extract_substance(self, description: str) -> str:
        """Best-effort Estonian-inflected active substance, normalised to a
        nominative-ish form by stripping a trailing partitive/genitive 'i'
        where present (heuristic only — NOT a real INN normaliser)."""
        match = self._SUBSTANCE_RE.search(description)
        if not match:
            return ""
        word = match.group(1).strip()
        # Strip trailing punctuation picked up by the regex boundary.
        word = word.rstrip(".,;:")
        if word.endswith("i") and len(word) > 4:
            word = word[:-1]
        return word

    def _extract_mah(self, description: str) -> str:
        match = self._MAH_RE.search(description)
        return match.group(1).strip() if match else ""

    @staticmethod
    def _parse_rss_date(raw: Any) -> str | None:
        """Parse RFC-2822 RSS pubDate (e.g. 'Thu, 09 Apr 2026 15:38:46 +0300')
        to an ISO-8601 date string."""
        if not raw:
            return None
        raw_str = str(raw).strip()
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(raw_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.date().isoformat()
        except Exception:
            pass
        try:
            from dateutil import parser as dtparser
            return dtparser.parse(raw_str).date().isoformat()
        except (ValueError, ImportError):
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
        print("Fetches live Ravimiamet data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = EstoniaRavimiametScraper(db_client=MagicMock())

        print("\n-- Fetching from Ravimiamet ...")
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

    scraper = EstoniaRavimiametScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
