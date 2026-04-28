"""
FDA Advisory Committee Calendar Scraper (via Federal Register API)
───────────────────────────────────────────────────────────────────
Source:  Federal Register documents — FDA Advisory Committee notices
URL:     https://www.federalregister.gov/api/v1/documents.json

The FDA's official advisory committee calendar page is JS-rendered and
unreliable to scrape. The Federal Register, however, publishes a formal notice
for every FDA Advisory Committee meeting with a structured abstract. This API
gives us:
  - Publication date
  - Meeting date (extracted from abstract)
  - Committee name (in title)
  - Agenda / topic / drug being reviewed (in abstract)

Free, public, no auth.

Output is written to the regulatory_events table with event_type='fda_adcomm'.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class FDAAdcommScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000080"
    SOURCE_NAME:  str = "FDA — Advisory Committee Calendar"
    BASE_URL:     str = "https://www.federalregister.gov/api/v1/documents.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 30.0
    SCRAPER_VERSION:  str = "2.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "application/json",
    }

    PAGES_TO_FETCH: int = 5  # 100 docs total — past 6-12 months of notices
    PER_PAGE: int = 20

    def fetch(self) -> list[dict]:
        """Fetch FDA Advisory Committee notices from Federal Register API."""
        self.log.info("Fetching FDA AdComm notices via Federal Register", extra={"url": self.BASE_URL})
        all_docs: list[dict] = []
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT) as client:
            for page in range(1, self.PAGES_TO_FETCH + 1):
                params = {
                    "per_page": self.PER_PAGE,
                    "page": page,
                    "conditions[agencies][]": "food-and-drug-administration",
                    "conditions[term]": "advisory committee meeting",
                    "conditions[type][]": "NOTICE",
                    "order": "newest",
                }
                try:
                    resp = client.get(self.BASE_URL, params=params)
                    if resp.status_code != 200:
                        break
                    data = resp.json()
                    docs = data.get("results", []) or []
                    all_docs.extend(docs)
                    if len(docs) < self.PER_PAGE:
                        break
                except Exception as exc:
                    self.log.warning("Federal Register page failed", extra={"page": page, "error": str(exc)})
                    break
        self.log.info("Fetched FDA AdComm notices", extra={"count": len(all_docs)})
        return all_docs

    def normalize(self, raw: list[dict]) -> list[dict]:
        events: list[dict] = []
        for doc in raw:
            try:
                ev = self._normalise_doc(doc)
                if ev:
                    events.append(ev)
            except Exception as exc:
                self.log.warning("Failed to parse FDA AdComm doc", extra={"error": str(exc)})
        self.log.info("Normalised AdComm events", extra={"count": len(events)})
        return events

    def _normalise_doc(self, doc: dict) -> dict | None:
        title = (doc.get("title") or "").strip()
        abstract = (doc.get("abstract") or "").strip()
        publication_date = doc.get("publication_date")
        url = doc.get("html_url") or doc.get("pdf_url")

        if not title:
            return None

        # Extract committee name (everything before first ;)
        committee_m = re.match(r"^([^;]+)(?:;|$)", title)
        committee_name = committee_m.group(1).strip() if committee_m else "FDA Advisory Committee"

        # Extract meeting date from abstract — typical pattern:
        # "The meeting will be held on [Date] from [Time]"
        # or "The general meeting will be held on [Date]"
        meeting_date = None
        date_patterns = [
            r"meeting will be held on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
            r"meeting (?:date|will take place)[\s:]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
            r"on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        ]
        for pat in date_patterns:
            m = re.search(pat, abstract, re.IGNORECASE)
            if m:
                try:
                    parts = re.match(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", m.group(1))
                    if parts:
                        meeting_date = datetime.strptime(
                            f"{parts.group(1)} {parts.group(2)} {parts.group(3)}",
                            "%B %d %Y",
                        ).date().isoformat()
                        break
                except ValueError:
                    continue

        # Fallback: if no meeting date in abstract, use publication date + 30 days
        # (rough approximation — notices typically published ~30 days before meetings)
        if not meeting_date and publication_date:
            try:
                pub = datetime.strptime(publication_date, "%Y-%m-%d").date()
                meeting_date = pub.isoformat()  # safe fallback
            except ValueError:
                pass

        # Drug/topic extraction from abstract — look for INN names in lowercase
        # in patterns like "...for the treatment of X using DRUGNAME..."
        drug_name = None
        # Look for parenthesised generic names: "Brand Name (generic name)"
        brand_m = re.search(r"\b([A-Z][a-z]{2,}(?:[A-Z][a-z]+)*)\s*\(([a-z][a-z\s\-]{3,40})\)", abstract)
        if brand_m:
            drug_name = brand_m.group(2).strip().lower()

        # Skip non-drug committees (e.g., tobacco)
        if any(skip in title.lower() for skip in ["tobacco", "veterinary", "device"]):
            return None

        return {
            "event_type": "fda_adcomm",
            "event_date": meeting_date,
            "committee_name": committee_name,
            "description": title[:500],
            "sponsor": None,
            "generic_name": drug_name,
            "source_url": url,
            "source_country": "US",
            "outcome": "scheduled" if meeting_date and meeting_date >= date.today().isoformat() else "unknown",
        }

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "skipped": 0, "errors": 0, "status_changes": 0}
        if not events:
            return counts

        for ev in events:
            try:
                if not ev.get("event_date"):
                    counts["skipped"] += 1
                    continue
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
                    "event_date": ev["event_date"],
                    "drug_id": drug_id,
                    "generic_name": ev.get("generic_name"),
                    "sponsor": ev.get("sponsor"),
                    "indication": ev.get("indication"),
                    "description": ev.get("description"),
                    "outcome": ev.get("outcome", "scheduled"),
                    "source_url": ev.get("source_url"),
                    "source_country": ev.get("source_country", "US"),
                    "raw_data": ev,
                }

                # Manual select-then-update/insert
                q = (
                    self.db.table("regulatory_events")
                    .select("id")
                    .eq("event_type", payload["event_type"])
                    .eq("event_date", payload["event_date"])
                )
                if drug_id:
                    q = q.eq("drug_id", drug_id)
                elif payload.get("generic_name"):
                    q = q.eq("generic_name", payload["generic_name"])
                else:
                    q = q.eq("description", payload.get("description") or "")
                existing = q.limit(1).execute()
                if existing.data:
                    self.db.table("regulatory_events").update(payload).eq("id", existing.data[0]["id"]).execute()
                else:
                    self.db.table("regulatory_events").insert(payload).execute()
                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning(
                    "Failed to upsert FDA AdComm event",
                    extra={"error": str(exc), "event": str(ev)[:200]},
                )

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
        print("DRY RUN — FDA AdComm via Federal Register")
        print("=" * 60)
        scraper = FDAAdcommScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  Documents: {len(raw)}")
        events = scraper.normalize(raw)
        print(f"  Events: {len(events)}")
        if events:
            print("\n  Sample (first 5):")
            for e in events[:5]:
                print(f"    {e.get('event_date')} | {e.get('description','')[:80]} | drug={e.get('generic_name')}")
        sys.exit(0)

    scraper = FDAAdcommScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
