"""
FDA Data Dashboard Inspection + Import Alert Scraper
─────────────────────────────────────────────────────
Source:  FDA Data Dashboard
URLs:    https://datadashboard.fda.gov/ora/cd/inspections.htm  (export → CSV)
         https://www.accessdata.fda.gov/cms_ia/iaalphabetical.html  (import alerts)

The FDA Data Dashboard publishes inspection results for every regulated
manufacturing facility. The single most predictive supply-chain signal
available: a facility classified OAI ("Official Action Indicated") is a
GMP failure that typically results in a US shortage 60-90 days later
when the FDA issues a warning letter or import alert.

Coverage: ~50,000 facilities globally — predominantly US, India, China, EU.

We use the openFDA-adjacent Inspection Citations CSV download.
"""
from __future__ import annotations

import io
import csv
from datetime import date, datetime
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class FDAInspectionsScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000091"
    SOURCE_NAME:  str = "FDA Data Dashboard — Inspections + Import Alerts"
    BASE_URL:     str = "https://datadashboard.fda.gov"
    COUNTRY:      str = "Global"
    COUNTRY_CODE: str = "ZZ"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/html,application/xhtml+xml,application/json",
    }

    # Drug-product-area inspection feed (CSV export from data dashboard).
    # The dashboard provides direct download URLs for filtered subsets.
    INSPECTIONS_CSV: str = (
        "https://datadashboard.fda.gov/ora/api/inspectionsdownload.htm?"
        "fdayear=&program=Drugs&postedcitations=ALL"
    )
    # Fallback: Federal Register for warning letters (more reliable as a public source)
    WARNING_LETTERS_FEED: str = (
        "https://www.federalregister.gov/api/v1/documents.json"
        "?per_page=50&conditions[term]=warning+letter+pharmaceutical"
        "&conditions[agencies][]=food-and-drug-administration"
        "&order=newest"
    )

    def fetch(self) -> dict:
        """
        We try multiple FDA endpoints. Each is best-effort; we proceed with
        whatever we successfully download.
        """
        result = {"inspections_csv": "", "warning_letters_json": None}

        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            # 1. Inspections CSV
            try:
                resp = client.get(self.INSPECTIONS_CSV)
                if resp.status_code == 200 and resp.text and len(resp.text) > 100:
                    result["inspections_csv"] = resp.text
                    self.log.info("Fetched FDA inspections CSV", extra={"bytes": len(resp.text)})
                else:
                    self.log.warning("Inspections CSV unavailable", extra={"status": resp.status_code})
            except Exception as exc:
                self.log.warning("Inspections CSV fetch failed", extra={"error": str(exc)})

            # 2. Federal Register warning letters
            try:
                resp = client.get(self.WARNING_LETTERS_FEED)
                if resp.status_code == 200:
                    result["warning_letters_json"] = resp.json()
                    self.log.info("Fetched warning letters feed", extra={"results": len(result["warning_letters_json"].get("results", []))})
            except Exception as exc:
                self.log.warning("Warning letters fetch failed", extra={"error": str(exc)})

        return result

    def normalize(self, raw: dict) -> list[dict]:
        events: list[dict] = []

        # Parse the inspections CSV
        csv_text = raw.get("inspections_csv", "")
        if csv_text:
            try:
                reader = csv.DictReader(io.StringIO(csv_text))
                for row in reader:
                    # CSV columns vary; common ones include:
                    # Legal Name, FEI Number, Inspection End Date, Project Area,
                    # Product Type, Classification, Posted Citations, City, State,
                    # Country, Inspection ID
                    fei = row.get("FEI Number") or row.get("FEI") or row.get("FEINumber")
                    name = row.get("Legal Name") or row.get("Firm Name") or row.get("Company Name")
                    if not name and not fei:
                        continue

                    classification = (row.get("Classification") or row.get("Inspection Classification") or "").strip().upper()
                    if classification not in ("NAI", "VAI", "OAI"):
                        classification = "unknown"

                    end_date = row.get("Inspection End Date") or row.get("End Date") or row.get("Date")
                    parsed_date = self._parse_date(end_date)

                    events.append({
                        "fei_number": fei.strip() if fei else None,
                        "facility_name": name.strip()[:200] if name else "Unknown facility",
                        "company_name": name.strip()[:200] if name else None,
                        "country": (row.get("Country") or "US").strip()[:2].upper() if row.get("Country") else "US",
                        "state_or_region": (row.get("State") or row.get("State or Province") or "").strip()[:60] or None,
                        "city": (row.get("City") or "").strip()[:80] or None,
                        "facility_type": (row.get("Product Type") or row.get("Project Area") or "").strip()[:80] or None,
                        "last_inspection_date": parsed_date,
                        "last_inspection_classification": classification,
                        "source": "fda_dashboard",
                        "source_url": "https://datadashboard.fda.gov/ora/cd/inspections.htm",
                        "raw_data": dict(row),
                    })
            except Exception as exc:
                self.log.warning("Failed to parse inspections CSV", extra={"error": str(exc)})

        # Parse warning letters from Federal Register
        wl = raw.get("warning_letters_json") or {}
        for doc in wl.get("results", []) or []:
            title = (doc.get("title") or "").strip()
            abstract = (doc.get("abstract") or "")[:300]
            url = doc.get("html_url")
            pub = self._parse_date(doc.get("publication_date"))

            # Try to extract company name from title (often: "Warning Letter to X Inc.")
            import re
            m = re.search(r"(?:to|for|against)\s+([A-Z][\w\s&,.'-]+?(?:Inc|LLC|Ltd|GmbH|AG|SA|plc|Co\.))", title)
            company = m.group(1).strip() if m else (title.split(";")[0] if ";" in title else title[:100])

            events.append({
                "fei_number": None,
                "facility_name": company[:200],
                "company_name": company[:200],
                "country": "US",
                "warning_letter_count_5y": 1,
                "last_inspection_date": pub,
                "last_inspection_classification": "OAI",
                "source": "federal_register_warning_letter",
                "source_url": url,
                "raw_data": {"title": title, "abstract": abstract},
            })

        self.log.info("Normalised facility events", extra={"count": len(events)})
        return events

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        if not raw:
            return None
        if isinstance(raw, date):
            return raw.isoformat()
        s = str(raw).strip()
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d-%m-%Y", "%b %d, %Y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return None

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                # Idempotency: by FEI number or by (facility_name + country)
                existing = None
                if ev.get("fei_number"):
                    r = self.db.table("manufacturing_facilities")\
                        .select("id, oai_count_5y, warning_letter_count_5y")\
                        .eq("fei_number", ev["fei_number"]).limit(1).execute()
                    if r.data:
                        existing = r.data[0]
                if not existing and ev.get("facility_name"):
                    r = self.db.table("manufacturing_facilities")\
                        .select("id, oai_count_5y, warning_letter_count_5y")\
                        .eq("facility_name", ev["facility_name"])\
                        .eq("country", ev.get("country", "US")).limit(1).execute()
                    if r.data:
                        existing = r.data[0]

                # Compute counters
                add_oai = 1 if ev.get("last_inspection_classification") == "OAI" else 0
                add_wl = ev.get("warning_letter_count_5y", 0) or 0

                payload = {
                    "fei_number": ev.get("fei_number"),
                    "facility_name": ev.get("facility_name"),
                    "company_name": ev.get("company_name"),
                    "country": ev.get("country"),
                    "state_or_region": ev.get("state_or_region"),
                    "city": ev.get("city"),
                    "facility_type": ev.get("facility_type"),
                    "last_inspection_date": ev.get("last_inspection_date"),
                    "last_inspection_classification": ev.get("last_inspection_classification"),
                    "source": ev.get("source"),
                    "source_url": ev.get("source_url"),
                    "raw_data": ev.get("raw_data"),
                }

                if existing:
                    # Update + accumulate
                    payload["oai_count_5y"] = (existing.get("oai_count_5y") or 0) + add_oai
                    payload["warning_letter_count_5y"] = (existing.get("warning_letter_count_5y") or 0) + add_wl
                    payload["inspection_count_5y"] = (existing.get("oai_count_5y") or 0) + 1
                    self.db.table("manufacturing_facilities").update(payload).eq("id", existing["id"]).execute()
                else:
                    payload["oai_count_5y"] = add_oai
                    payload["warning_letter_count_5y"] = add_wl
                    payload["inspection_count_5y"] = 1
                    self.db.table("manufacturing_facilities").insert(payload).execute()

                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("Failed to upsert facility", extra={"error": str(exc)})
        return counts

    def run(self):
        """Bypass raw_scrapes log — CSV can be very large."""
        from datetime import datetime, timezone
        started = datetime.now(timezone.utc).isoformat()
        try:
            raw = self.fetch()
            events = self.normalize(raw)
            counts = self.upsert(events)
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "success",
                "records_found": len(events),
                "records_processed": counts.get("upserted", 0),
                "errors": counts.get("errors", 0),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            self.log.error("FDA Inspections run failed", extra={"error": str(exc)})
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "failed",
                "error": str(exc),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60)
        print("DRY RUN — FDA Inspections")
        print("=" * 60)
        scraper = FDAInspectionsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  Inspections CSV size: {len(raw.get('inspections_csv','')):,}")
        print(f"  Warning letters: {len((raw.get('warning_letters_json') or {}).get('results',[]))}")
        events = scraper.normalize(raw)
        print(f"  Events: {len(events)}")
        if events:
            for e in events[:5]:
                print(f"    {e.get('last_inspection_date'):10}  {e.get('last_inspection_classification'):8}  {e.get('country'):2}  {e.get('facility_name','')[:50]}")
        sys.exit(0)

    scraper = FDAInspectionsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
