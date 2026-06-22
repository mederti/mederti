"""
Italy AIFA — Liste di Trasparenza (transparency lists) Pricing Scraper
──────────────────────────────────────────────────────────────────────
Source:  Agenzia Italiana del Farmaco (AIFA), updated ~monthly.
File:    Lista_farmaci_equivalenti.csv — stable URL, one row per equivalent
         presentation: principio attivo (INN), ATC, AIC code, brand, pack,
         public price (Prezzo Pubblico) + SSN reference price.

The public price is the pharmacy retail price → price_type=retail_public, with
the SSN reference price kept in raw_data. Because the file carries the active
ingredient (principio attivo) directly, drug_id resolution is strong (the
canonical rollup folds the Italian INN spelling onto the English head).

CSV: semicolon-delimited, latin-1, prices like "5,63 €" (comma decimal).
Cadence: weekly cron. Month-bucketed effective_date → idempotent re-runs.
"""
from __future__ import annotations

import csv
import re
from datetime import date

from backend.scrapers.pricing.base import PricingScraper

CSV_URL = "https://www.aifa.gov.it/documents/20142/825643/Lista_farmaci_equivalenti.csv"

# Column indices (no stable header names across editions — fixed positions)
_INN, _ATC, _AIC, _FARMACO, _CONFEZIONE, _DITTA, _PREZZO_PUB, _PREZZO_RIF = 0, 2, 3, 4, 5, 6, 7, 8

_STRENGTH_RE = re.compile(
    r"(\d[\d.,]*\s?(?:MG|MCG|G|ML|UI|U\.I\.|%|MG/ML|MCG/ML)(?:/[\d.]*\s?(?:ML|G|H)?)?)",
    re.IGNORECASE,
)


def _parse_price(s: str) -> float | None:
    s = (s or "").replace("\x80", "").replace("€", "").strip()
    if not s:
        return None
    # Italian format: "." thousands separator, "," decimal.
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


class AIFAScraper(PricingScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000102"
    SOURCE_NAME:  str = "Italy AIFA Liste di Trasparenza"
    BASE_URL:     str = "https://www.aifa.gov.it/liste-di-trasparenza"
    COUNTRY:      str = "Italy"
    COUNTRY_CODE: str = "IT"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    def fetch(self) -> dict:
        text = self._get(CSV_URL).content.decode("latin-1")
        lines = text.splitlines()
        self.log.info("AIFA transparency CSV fetched", extra={"lines": len(lines)})
        return {"lines": lines}

    def normalize(self, raw: dict) -> list[dict]:
        out: list[dict] = []
        effective = date.today().replace(day=1).isoformat()
        rows = list(csv.reader(raw.get("lines", []), delimiter=";"))
        for c in rows[1:]:  # skip header
            if len(c) <= _PREZZO_PUB:
                continue
            price = _parse_price(c[_PREZZO_PUB])
            if price is None or price <= 0:
                continue
            inn = c[_INN].strip()
            brand = c[_FARMACO].strip()
            confezione = c[_CONFEZIONE].strip().strip('"')
            strength_m = _STRENGTH_RE.search(confezione) or _STRENGTH_RE.search(brand)
            out.append({
                "product_name":     brand or inn,
                "generic_name":     inn,            # principio attivo = INN → strong resolution
                "inn":              inn,
                "strength":         strength_m.group(1).strip() if strength_m else None,
                "pack_description": confezione[:100] or None,
                "price_type":       "retail_public",
                "category":         "Prezzo al pubblico",
                "authority":        "AIFA",
                "pack_price":       price,
                "currency":         "EUR",
                "effective_date":   effective,
                "identifier_type":  "AIC",
                "identifier_value": c[_AIC].strip() or None,
                "source_url":       self.BASE_URL,
                "raw_record":       {
                    "atc": c[_ATC].strip() if len(c) > _ATC else None,
                    "ditta": c[_DITTA].strip() if len(c) > _DITTA else None,
                    "prezzo_riferimento_ssn": _parse_price(c[_PREZZO_RIF]) if len(c) > _PREZZO_RIF else None,
                    "prezzo_pubblico": price,
                },
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
        print("DRY RUN — Italy AIFA Liste di Trasparenza")
        print("=" * 60)
        scraper = AIFAScraper(db_client=MagicMock())
        raw = scraper.fetch()
        rows = scraper.normalize(raw)
        print(f"  priced presentations: {len(rows)}")
        for r in rows[:8]:
            print(f"    {r['product_name'][:34]:34} inn={r['generic_name'][:16]:16} AIC {r['identifier_value']:>9}  €{r['pack_price']}")
        sys.exit(0)

    scraper = AIFAScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
