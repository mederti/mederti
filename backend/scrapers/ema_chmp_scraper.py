"""
EMA CHMP Meeting Highlights Scraper
────────────────────────────────────
Source:  EMA — Committee for Medicinal Products for Human Use (CHMP)
URL:     https://www.ema.europa.eu/en/news-events/whats-new

CHMP meets monthly to deliver positive/negative opinions on EU marketing
authorisation applications. Recommendations precede the European Commission
authorisation by about 67 days. So a positive CHMP opinion in May means
the drug is launched in Europe by the end of July — a strong near-term signal.

We extract:
  - Meeting date
  - Drug names with positive opinions (likely approval ~2 months later)
  - Drug names with negative opinions
  - Sponsor where listed

Cadence: monthly cron, after the second-Thursday-of-the-month meeting.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import httpx
from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper


class EMAChmpScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000082"
    SOURCE_NAME:  str = "EMA — CHMP Meeting Highlights"
    BASE_URL:     str = "https://www.ema.europa.eu/en/news-events/whats-new"
    COUNTRY:      str = "European Union"
    COUNTRY_CODE: str = "EU"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/html,application/xhtml+xml",
    }

    # CHMP highlights pages are typically titled "Meeting highlights from..."
    HIGHLIGHTS_PATTERN = re.compile(
        r"meeting highlights.*?(human medicines|chmp)",
        re.IGNORECASE,
    )

    def fetch(self) -> str:
        self.log.info("Fetching EMA CHMP highlights index", extra={"url": self.BASE_URL})
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()
        return resp.text

    def normalize(self, raw: str) -> list[dict]:
        soup = BeautifulSoup(raw, "lxml")
        events: list[dict] = []

        # Find links to CHMP meeting highlights articles
        highlight_links: list[tuple[str, str, date | None]] = []
        for a in soup.find_all("a", href=True):
            text = a.get_text(strip=True)
            href = a.get("href", "")
            if not text or not href:
                continue
            if not self.HIGHLIGHTS_PATTERN.search(text):
                continue
            if not href.startswith("http"):
                href = f"https://www.ema.europa.eu{href}"
            # Parse date from text e.g. "Meeting highlights from CHMP, 12-15 February 2026"
            d = self._extract_date_from_text(text)
            highlight_links.append((text, href, d))

        # De-dup
        seen: set[str] = set()
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            for title, url, mdate in highlight_links[:6]:  # last 6 meetings
                if url in seen:
                    continue
                seen.add(url)
                try:
                    page = client.get(url)
                    if page.status_code != 200:
                        continue
                    page_events = self._parse_highlights_page(page.text, mdate, url)
                    events.extend(page_events)
                except Exception as exc:
                    self.log.warning("CHMP page fetch failed", extra={"url": url, "error": str(exc)})

        self.log.info("Parsed CHMP events", extra={"count": len(events)})
        return events

    def _parse_highlights_page(self, html: str, meeting_date: date | None, source_url: str) -> list[dict]:
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text("\n", strip=True)

        events: list[dict] = []

        # Find the "positive opinion" section drugs
        # CHMP highlight pages typically structure:
        #   "Positive recommendation for X medicines:"
        #   "Negative recommendation for Y medicines:"
        # followed by a list / paragraph naming each drug with INN and brand.
        positive_section = self._extract_section(text, "positive opinion", "negative opinion")
        negative_section = self._extract_section(text, "negative opinion", None)

        for drug_name, sponsor in self._extract_drugs(positive_section):
            events.append({
                "event_type": "ema_chmp",
                "event_date": meeting_date.isoformat() if meeting_date else None,
                "generic_name": drug_name,
                "sponsor": sponsor,
                "description": f"CHMP positive opinion — likely EU approval ~67 days later",
                "outcome": "approved",  # CHMP positive ≈ approval pipeline
                "source_url": source_url,
                "source_country": "EU",
            })

        for drug_name, sponsor in self._extract_drugs(negative_section):
            events.append({
                "event_type": "ema_chmp",
                "event_date": meeting_date.isoformat() if meeting_date else None,
                "generic_name": drug_name,
                "sponsor": sponsor,
                "description": f"CHMP negative opinion — application unsuccessful",
                "outcome": "rejected",
                "source_url": source_url,
                "source_country": "EU",
            })

        return events

    @staticmethod
    def _extract_section(text: str, start_marker: str, end_marker: str | None) -> str:
        lower = text.lower()
        s = lower.find(start_marker)
        if s < 0:
            return ""
        if end_marker:
            e = lower.find(end_marker, s + len(start_marker))
            if e < 0:
                e = min(s + 4000, len(text))
        else:
            e = min(s + 4000, len(text))
        return text[s:e]

    @staticmethod
    def _extract_drugs(section: str) -> list[tuple[str, str | None]]:
        if not section:
            return []
        # Look for patterns like "Drug name (INN, sponsor)" or "Brand (generic, ApplicantInc)"
        pattern = re.compile(r"([A-Z][\w-]+(?:\s[\w-]+)?)\s*\(([a-z][a-z\s\-]+?)(?:,\s*([\w\s&]+))?\)", re.MULTILINE)
        matches = pattern.findall(section)
        drugs: list[tuple[str, str | None]] = []
        for brand, inn, sponsor in matches:
            inn = inn.strip().lower()
            if 2 <= len(inn) <= 60:
                drugs.append((inn, sponsor.strip() if sponsor else None))
        return drugs

    @staticmethod
    def _extract_date_from_text(text: str) -> date | None:
        m = re.search(
            r"(\d{1,2})(?:[-–]\s*\d{1,2})?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})",
            text,
            re.IGNORECASE,
        )
        if not m:
            return None
        try:
            return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %B %Y").date()
        except ValueError:
            return None

    def upsert(self, events: list[dict]) -> dict:
        from datetime import date
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        self.log.info(f"CHMP upsert called with {len(events)} events", extra={"sample": events[:1] if events else None})
        for ev in events:
            try:
                # If event_date couldn't be extracted, fall back to today (so the
                # row still satisfies the unique index where event_date IS NOT NULL)
                event_date = ev.get("event_date") or date.today().isoformat()

                drug_id = None
                if ev.get("generic_name"):
                    drugs_resp = (
                        self.db.table("drugs")
                        .select("id")
                        .ilike("generic_name", ev["generic_name"])
                        .limit(1)
                        .execute()
                    )
                    if drugs_resp.data:
                        drug_id = drugs_resp.data[0]["id"]

                payload = {
                    "event_type": ev["event_type"],
                    "event_date": event_date,
                    "drug_id": drug_id,
                    "generic_name": ev.get("generic_name"),
                    "sponsor": ev.get("sponsor"),
                    "description": ev.get("description"),
                    "outcome": ev.get("outcome", "scheduled"),
                    "source_url": ev.get("source_url"),
                    "source_country": "EU",
                    "raw_data": ev,
                }
                # Manual select-then-update/insert (partial unique indexes don't
                # work with PostgREST on_conflict)
                q = (
                    self.db.table("regulatory_events")
                    .select("id")
                    .eq("event_type", payload["event_type"])
                    .eq("event_date", event_date)
                )
                if drug_id:
                    q = q.eq("drug_id", drug_id)
                else:
                    q = q.eq("generic_name", payload["generic_name"])
                existing = q.limit(1).execute()
                if existing.data:
                    self.db.table("regulatory_events").update(payload).eq("id", existing.data[0]["id"]).execute()
                else:
                    self.db.table("regulatory_events").insert(payload).execute()
                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("Failed to upsert CHMP event", extra={"error": str(exc), "event": str(ev)[:200]})
        return counts


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
        print("DRY RUN — EMA CHMP Highlights")
        print("=" * 60)
        scraper = EMAChmpScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  HTML size: {len(raw):,}")
        events = scraper.normalize(raw)
        print(f"  events: {len(events)}")
        if events:
            for e in events[:8]:
                print(f"    {e['event_date']} | {e['outcome']:8} | {e.get('generic_name'):30} | {e.get('sponsor', '?')}")
        sys.exit(0)

    scraper = EMAChmpScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
