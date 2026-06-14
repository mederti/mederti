"""
NHS Drug Tariff + Price Concessions Scraper (v2)
────────────────────────────────────────────────
Source:  NHS Business Services Authority
  Part VIII page → Category M prices as XLSX (quarterly, generics reimbursement)
  Drug Tariff updates page → in-month Part VIIIA announcements + price
  concessions, published as inline "Drug Tariff News" items (the old
  /price-concessions page 404s since the 2026 site restructure)

Price concessions are temporary uplifts granted when pharmacies cannot buy at
the tariff price — a strong leading indicator of GB shortages.

We extract:
  - Category M prices (XLSX: VMPP SNOMED code, drug, pack, basic price in pence)
  - Drug Tariff News items: "Product strength form pack £price" lines.
    price_type = 'concession' when the announcement grants/rolls over
    concessionary prices, else 'drug_tariff' (in-month VIIIA amendment).

Cadence: weekly cron — tariff changes monthly but concessions are announced
throughout the month.
"""
from __future__ import annotations

import io
import re
from datetime import date
from typing import Any

from bs4 import BeautifulSoup

from backend.scrapers.pricing.base import PricingScraper

PART_VIII_URL = (
    "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/"
    "drug-tariff/drug-tariff-part-viii"
)
UPDATES_URL = (
    "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/"
    "drug-tariff/drug-tariff-updates"
)

MONTHS = (
    "January February March April May June July August "
    "September October November December"
).split()
_MONTH_NUM = {m: i + 1 for i, m in enumerate(MONTHS)}

# "Atorvastatin 60mg tablets 28 £4.37" → (product, pack, price)
_NEWS_ITEM_RE = re.compile(
    r"([A-Z][^£\n]{4,140}?)\s+(\d+(?:\.\d+)?)\s+£\s?(\d+(?:,\d{3})*\.\d{2})"
)
_NEWS_HEADING_RE = re.compile(
    r"Drug Tariff News\s*[-–]\s*(\w+)\s+Part VIIIA reimbursement prices"
    r"\s*\(issued\s+([^)]+)\)",
    re.IGNORECASE,
)


class NHSDrugTariffScraper(PricingScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000090"
    SOURCE_NAME:  str = "NHS Drug Tariff + Price Concessions"
    BASE_URL:     str = PART_VIII_URL
    COUNTRY:      str = "United Kingdom"
    COUNTRY_CODE: str = "GB"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "2.0.0"

    # ── fetch ────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        return {
            "catm": self._fetch_cat_m(),
            "news": self._fetch_tariff_news(),
        }

    def _fetch_cat_m(self) -> dict:
        """Latest Category M price file (XLSX) from the Part VIII page."""
        html = self._get(PART_VIII_URL).text
        # Links look like: <a href="/sites/default/files/.../Cat M prices ... .xlsx">
        #   Category M Prices - Quarter 1 May 2026 (Excel:39KB)</a>
        # The page lists newest first.
        m = re.search(
            r'href="(/sites/default/files/[^"]+\.xlsx)"[^>]*>\s*'
            r'(Category\s+M\s+[Pp]rices[^<]*)',
            html,
        )
        if not m:
            self.log.warning("No Category M XLSX link found on Part VIII page")
            return {"url": None, "effective_date": None, "rows": []}

        file_url = "https://www.nhsbsa.nhs.uk" + m.group(1)
        label = " ".join(m.group(2).split())
        effective = self._month_year_to_date(label) or date.today().replace(day=1).isoformat()

        xlsx_bytes = self._get(file_url).content
        rows = self._parse_cat_m_xlsx(xlsx_bytes)
        self.log.info(
            "Category M file parsed",
            extra={"url": file_url, "label": label, "rows": len(rows)},
        )
        return {"url": file_url, "label": label, "effective_date": effective, "rows": rows}

    def _parse_cat_m_xlsx(self, payload: bytes) -> list[dict]:
        """Columns: VMPP Snomed Code | Drug Name | Pack size | unit | Basic price (pence)."""
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
        ws = wb.active
        rows: list[dict] = []
        header_seen = False
        for cells in ws.iter_rows(values_only=True):
            values = [c for c in cells]
            if not header_seen:
                joined = " ".join(str(v).lower() for v in values if v)
                if "snomed" in joined or "drug name" in joined:
                    header_seen = True
                continue
            if not values or values[1] is None:
                continue
            code, name, pack, unit, pence = (list(values) + [None] * 5)[:5]
            try:
                pence_val = float(pence)
            except (TypeError, ValueError):
                continue
            rows.append({
                "vmpp_code": str(int(code)) if isinstance(code, (int, float)) else (str(code).strip() or None),
                "drug_name": str(name).strip(),
                "pack_size": str(pack).strip() if pack is not None else None,
                "unit":      str(unit).strip() if unit is not None else None,
                "price_pence": pence_val,
            })
        wb.close()
        return rows

    def _fetch_tariff_news(self) -> list[dict]:
        """In-month VIIIA announcements + concessions from the updates page.

        The page groups news under <h2>Month Year</h2> headings, with each
        announcement as an <h3>…(issued DD Month)</h3> followed by body text.
        """
        html = self._get(UPDATES_URL).text
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text("\n", strip=True)

        # Year context comes from the "June 2026"-style month headings.
        year_by_pos: list[tuple[int, int]] = []  # (pos, year)
        for m in re.finditer(rf"({'|'.join(MONTHS)})\s+(\d{{4}})", text):
            year_by_pos.append((m.start(), int(m.group(2))))

        news: list[dict] = []
        headings = list(_NEWS_HEADING_RE.finditer(text))
        for i, h in enumerate(headings):
            month_name = h.group(1).capitalize()
            issued = h.group(2).strip()
            body_end = headings[i + 1].start() if i + 1 < len(headings) else min(len(text), h.end() + 6000)
            body = text[h.end():body_end]

            year = next((y for pos, y in reversed(year_by_pos) if pos <= h.start()), date.today().year)
            month_num = _MONTH_NUM.get(month_name)
            if not month_num:
                continue

            items = [
                {"product": " ".join(p.split()), "pack": pk, "price_gbp": float(pr.replace(",", ""))}
                for p, pk, pr in _NEWS_ITEM_RE.findall(body)
            ]
            if items:
                news.append({
                    "month": f"{year}-{month_num:02d}-01",
                    "issued": issued,
                    "is_concession": "concession" in body.lower(),
                    "items": items,
                })
        self.log.info("Tariff news parsed", extra={"announcements": len(news)})
        return news

    @staticmethod
    def _month_year_to_date(label: str) -> str | None:
        m = re.search(rf"({'|'.join(MONTHS)})\s+(\d{{2,4}})", label)
        if not m:
            return None
        year = int(m.group(2))
        if year < 100:
            year += 2000
        return f"{year}-{_MONTH_NUM[m.group(1)]:02d}-01"

    # ── normalize ────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        out: list[dict] = []

        catm = raw.get("catm") or {}
        for r in catm.get("rows", []):
            pack_price = round(r["price_pence"] / 100.0, 2)
            unit_price = None
            try:
                n = float(r["pack_size"])
                if n > 0:
                    unit_price = round(pack_price / n, 4)
            except (TypeError, ValueError):
                pass
            pack_desc = " ".join(s for s in (r.get("pack_size"), r.get("unit")) if s)
            out.append({
                "product_name":     r["drug_name"],
                "generic_name":     r["drug_name"],
                "pack_description": pack_desc or None,
                "price_type":       "drug_tariff",
                "category":         "Cat M",
                "authority":        "NHS-BSA",
                "pack_price":       pack_price,
                "unit_price":       unit_price,
                "currency":         "GBP",
                "effective_date":   catm.get("effective_date"),
                "identifier_type":  "VMPP_SNOMED" if r.get("vmpp_code") else None,
                "identifier_value": r.get("vmpp_code"),
                "source_url":       catm.get("url") or PART_VIII_URL,
                "raw_record":       r,
            })

        for ann in raw.get("news") or []:
            for item in ann["items"]:
                out.append({
                    "product_name":     item["product"],
                    "generic_name":     item["product"],
                    "pack_description": item["pack"],
                    "price_type":       "concession" if ann["is_concession"] else "drug_tariff",
                    "category":         "concession" if ann["is_concession"] else "VIIIA in-month amendment",
                    "authority":        "DHSC",
                    "pack_price":       item["price_gbp"],
                    "currency":         "GBP",
                    "effective_date":   ann["month"],
                    "source_url":       UPDATES_URL,
                    "raw_record":       {**item, "issued": ann["issued"]},
                })

        return out


if __name__ == "__main__":
    import json
    import os
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1":
        from unittest.mock import MagicMock
        print("=" * 60)
        print("DRY RUN — NHS Drug Tariff + Price Concessions (v2)")
        print("=" * 60)
        scraper = NHSDrugTariffScraper(db_client=MagicMock())
        raw = scraper.fetch()
        rows = scraper.normalize(raw)
        catm_n = sum(1 for r in rows if r["category"] == "Cat M")
        conc_n = len(rows) - catm_n
        print(f"  Cat M rows: {catm_n}   news/concession rows: {conc_n}")
        for r in rows[:6] + [r for r in rows if r["category"] != "Cat M"][:6]:
            print(f"    {r['effective_date']}  [{r['price_type']:>12}] "
                  f"{r['product_name'][:48]:48} {str(r.get('pack_description') or ''):>10}  £{r['pack_price']}")
        sys.exit(0)

    scraper = NHSDrugTariffScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
