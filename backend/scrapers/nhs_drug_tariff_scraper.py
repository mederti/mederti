"""
NHS Drug Tariff + Price Concessions Scraper
────────────────────────────────────────────
Source:  NHS Business Services Authority — Drug Tariff
URL:     https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/drug-tariff
         https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/serious-shortage-protocols-ssps
         https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/dispensing-contractors-information/price-concessions

The NHS Drug Tariff is the GB pricing reference for community pharmacy
reimbursement — published monthly. Price concessions are temporary uplifts
when wholesalers cannot source at the tariff price (i.e. early shortage signal).

We extract:
  - Tariff prices (Category M, A, C) — monthly time series
  - Price concessions — strong leading indicator of GB shortages

Cadence: monthly cron (1st of each month).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import httpx
from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper


class NHSDrugTariffScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000090"
    SOURCE_NAME:  str = "NHS Drug Tariff + Price Concessions"
    BASE_URL:     str = "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/dispensing-contractors-information/price-concessions"
    COUNTRY:      str = "United Kingdom"
    COUNTRY_CODE: str = "GB"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/html,application/xhtml+xml",
    }

    def fetch(self) -> str:
        self.log.info("Fetching NHS Price Concessions page", extra={"url": self.BASE_URL})
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()
        return resp.text

    def normalize(self, raw: str) -> list[dict]:
        soup = BeautifulSoup(raw, "lxml")
        events: list[dict] = []

        # NHS publishes concession tables monthly. We look for tables with
        # columns: drug name, pack size, concession price.
        tables = soup.find_all("table")
        self.log.info(f"Found {len(tables)} tables on NHS concessions page")

        # Extract the publication month from page text if possible
        page_text = soup.get_text(" ", strip=True)
        month_match = re.search(
            r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})",
            page_text,
        )
        effective_date = None
        if month_match:
            try:
                effective_date = datetime.strptime(
                    f"1 {month_match.group(1)} {month_match.group(2)}", "%d %B %Y"
                ).date().isoformat()
            except ValueError:
                pass
        if not effective_date:
            today = date.today()
            effective_date = today.replace(day=1).isoformat()

        for table in tables:
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue
            # Detect headers
            headers_row = rows[0].find_all(["th", "td"])
            headers_text = [h.get_text(strip=True).lower() for h in headers_row]
            joined = " ".join(headers_text)
            if not any(kw in joined for kw in ("drug", "preparation", "product", "concession", "price", "name")):
                continue

            # Map columns
            name_idx = next((i for i, h in enumerate(headers_text)
                            if any(w in h for w in ("drug", "preparation", "product", "name"))), 0)
            pack_idx = next((i for i, h in enumerate(headers_text)
                            if any(w in h for w in ("pack", "size", "quantity"))), -1)
            price_idx = next((i for i, h in enumerate(headers_text)
                             if any(w in h for w in ("concession", "price", "£", "amount"))), -1)

            for row in rows[1:]:
                cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
                if len(cells) < 2 or not cells[name_idx].strip():
                    continue
                name = cells[name_idx].strip()
                pack = cells[pack_idx].strip() if pack_idx >= 0 and pack_idx < len(cells) else None
                price_str = cells[price_idx].strip() if price_idx >= 0 and price_idx < len(cells) else None

                # Parse price (e.g. "£3.45" or "3.45")
                price_val = None
                if price_str:
                    pm = re.search(r"(\d+(?:\.\d{1,3})?)", price_str.replace(",", ""))
                    if pm:
                        try:
                            price_val = float(pm.group(1))
                        except ValueError:
                            pass

                events.append({
                    "country": "GB",
                    "authority": "NHS-BSA",
                    "price_type": "concession",
                    "category": "concession",
                    "product_name": name[:200],
                    "pack_description": pack[:100] if pack else None,
                    "pack_price": price_val,
                    "currency": "GBP",
                    "effective_date": effective_date,
                    "source": "nhs_drug_tariff",
                    "source_url": self.BASE_URL,
                    "raw_data": {"name": name, "pack": pack, "price_str": price_str},
                })

        self.log.info("Parsed NHS concessions", extra={"count": len(events)})
        return events

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                # Best-effort: match drug by product name → drugs.generic_name
                drug_id = None
                # Strip pack/strength info to match generic name better
                name_clean = re.sub(r"[\d.,]+\s*(mg|g|ml|mcg|microgram|tablet|capsule|injection|suspension)s?",
                                   "", ev["product_name"], flags=re.IGNORECASE).strip()
                name_clean = re.split(r"[,\(]", name_clean)[0].strip()
                if name_clean and len(name_clean) > 2:
                    try:
                        m = self.db.table("drugs").select("id").ilike("generic_name", f"%{name_clean[:30]}%").limit(1).execute()
                        if m.data:
                            drug_id = m.data[0]["id"]
                    except Exception:
                        pass

                payload = {
                    "drug_id": drug_id,
                    "generic_name": name_clean[:200] if name_clean else None,
                    "product_name": ev["product_name"],
                    "pack_description": ev.get("pack_description"),
                    "country": ev["country"],
                    "authority": ev["authority"],
                    "price_type": ev["price_type"],
                    "category": ev.get("category"),
                    "pack_price": ev.get("pack_price"),
                    "currency": ev.get("currency", "GBP"),
                    "effective_date": ev["effective_date"],
                    "source": ev.get("source"),
                    "source_url": ev.get("source_url"),
                    "raw_data": ev.get("raw_data"),
                }
                self.db.table("drug_pricing_history").insert(payload).execute()
                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("Failed to upsert NHS price record", extra={"error": str(exc)})
        return counts


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60)
        print("DRY RUN — NHS Drug Tariff + Price Concessions")
        print("=" * 60)
        scraper = NHSDrugTariffScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  HTML: {len(raw):,} chars")
        events = scraper.normalize(raw)
        print(f"  Events: {len(events)}")
        if events:
            for e in events[:8]:
                print(f"    {e['effective_date']}  {e['product_name'][:50]:50}  {e.get('pack_description','')[:25]:25}  £{e.get('pack_price','?')}")
        sys.exit(0)

    scraper = NHSDrugTariffScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
