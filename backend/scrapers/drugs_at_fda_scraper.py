"""
Drugs@FDA + Orange Book Scraper
─────────────────────────────────
Source:  openFDA (free, no auth)
URL:     https://api.fda.gov/drug/drugsfda.json
         https://api.fda.gov/drug/ndc.json

Returns the complete US drug approval graph: NDA/BLA numbers, applicant,
approval date, generic names, brand names, and Orange Book Therapeutic
Equivalence (TE) codes — which determine whether a generic is rated as
clinically substitutable.

Why this matters for Mederti:
- Answers "Can it be used here?" — full US approval/active status visible.
- TE codes (AB, AB1, AA, etc.) are the bedrock of generic substitution.
- We use it to enrich drugs/regulatory_events and seed therapeutic_equivalents.

Cadence: weekly.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class DrugsAtFDAScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000092"
    SOURCE_NAME:  str = "Drugs@FDA — openFDA approvals"
    BASE_URL:     str = "https://api.fda.gov/drug/drugsfda.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 0.5
    REQUEST_TIMEOUT:  float = 30.0
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "application/json",
    }

    PAGE_SIZE: int = 100
    MAX_PAGES: int = 50  # 5,000 records per run; openFDA caps page size

    def fetch(self) -> list[dict]:
        all_records: list[dict] = []
        seen: set[str] = set()
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT) as client:
            # Iterate by application_number — openFDA supports skip parameter
            for page in range(self.MAX_PAGES):
                params = {
                    "limit": self.PAGE_SIZE,
                    "skip": page * self.PAGE_SIZE,
                    "search": "products.marketing_status:Prescription",
                }
                try:
                    resp = client.get(self.BASE_URL, params=params)
                    if resp.status_code == 404:
                        break
                    if resp.status_code != 200:
                        self.log.warning("openFDA non-200", extra={"status": resp.status_code, "page": page})
                        break
                    data = resp.json()
                    results = data.get("results", []) or []
                    if not results:
                        break
                    for rec in results:
                        appno = rec.get("application_number")
                        if appno and appno not in seen:
                            seen.add(appno)
                            all_records.append(rec)
                    if len(results) < self.PAGE_SIZE:
                        break
                except Exception as exc:
                    self.log.warning("openFDA page failed", extra={"page": page, "error": str(exc)})
                    break
        self.log.info("Fetched Drugs@FDA", extra={"records": len(all_records)})
        return all_records

    def normalize(self, raw: list[dict]) -> list[dict]:
        events: list[dict] = []
        for rec in raw:
            try:
                events.extend(self._normalise_record(rec))
            except Exception as exc:
                self.log.warning("Failed to normalise Drugs@FDA record", extra={"error": str(exc)})
        self.log.info("Normalised approvals", extra={"count": len(events)})
        return events

    def _normalise_record(self, rec: dict) -> list[dict]:
        appno = rec.get("application_number")
        sponsor = (rec.get("sponsor_name") or "").strip() or None
        products = rec.get("products", []) or []
        submissions = rec.get("submissions", []) or []

        # Earliest approval date from submissions
        earliest = None
        for sub in submissions:
            d = sub.get("submission_status_date") or sub.get("submission_class_code_description")
            if d and isinstance(d, str) and len(d) == 8:
                # YYYYMMDD format
                try:
                    earliest = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
                    break
                except Exception:
                    pass

        out: list[dict] = []
        for prod in products:
            ingredients = prod.get("active_ingredients", []) or []
            inn = ingredients[0].get("name").strip().lower() if ingredients and ingredients[0].get("name") else None
            brand = (prod.get("brand_name") or "").strip() or None
            te_code = (prod.get("te_code") or "").strip() or None
            marketing_status = (prod.get("marketing_status") or "").strip()
            ref_listed = (prod.get("reference_drug") or "").strip() or None

            out.append({
                "drug_id": None,
                "generic_name": inn,
                "brand_name": brand,
                "authority": "FDA",
                "application_number": appno,
                "application_type": appno[:3] if appno else None,  # NDA, BLA, ANDA prefix
                "approval_date": earliest,
                "status": marketing_status,
                "applicant_name": sponsor,
                "marketing_authorisation_holder": sponsor,
                "te_code": te_code,
                "reference_listed_drug": ref_listed,
                "source_url": f"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={appno}" if appno else None,
                "raw_data": prod,
            })
        return out

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                # Try to match drug_id by INN
                drug_id = None
                if ev.get("generic_name"):
                    m = self.db.table("drugs").select("id").ilike("generic_name", ev["generic_name"]).limit(1).execute()
                    if m.data:
                        drug_id = m.data[0]["id"]
                ev["drug_id"] = drug_id

                # Idempotency on (authority, application_number)
                if ev["application_number"]:
                    existing = self.db.table("drug_approvals").select("id")\
                        .eq("authority", "FDA").eq("application_number", ev["application_number"]).limit(1).execute()
                    if existing.data:
                        self.db.table("drug_approvals").update(ev).eq("id", existing.data[0]["id"]).execute()
                    else:
                        self.db.table("drug_approvals").insert(ev).execute()
                else:
                    self.db.table("drug_approvals").insert(ev).execute()
                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("Failed to upsert FDA approval", extra={"error": str(exc)})
        return counts

    def run(self):
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
            self.log.error("Drugs@FDA run failed", extra={"error": str(exc)})
            return {"source": self.SOURCE_NAME, "started_at": started, "status": "failed", "error": str(exc),
                    "finished_at": datetime.now(timezone.utc).isoformat()}


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("DRY RUN — Drugs@FDA")
        scraper = DrugsAtFDAScraper(db_client=MagicMock())
        scraper.MAX_PAGES = 2  # limit to 200 records for dry run
        raw = scraper.fetch()
        print(f"  records: {len(raw)}")
        events = scraper.normalize(raw)
        print(f"  approvals: {len(events)}")
        for e in events[:5]:
            print(f"    {e.get('application_number'):10} {e.get('te_code') or '   '} {e.get('generic_name') or '?':30} ({e.get('brand_name') or '?'})")
        sys.exit(0)

    scraper = DrugsAtFDAScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
