"""
Spain — Nomenclátor de facturación (SNS) Pricing Scraper
─────────────────────────────────────────────────────────
Source:  Ministerio de Sanidad — Nomenclátor de facturación, updated monthly.
         The official per-product price file (the AEMPS prescripción nomenclator
         is clinical-only and carries no prices).

Access:  the displaytag CSV export is session-gated — a bare export request
         returns the search HTML page. We prime a session with the product
         search, then request the export with the same cookies, which yields
         the full CSV (~20k rows).

Fields:  Código Nacional, product name, principio activo (INN), Precio venta al
         público con IVA (retail price), precio de referencia, laboratorio.
         price_type=retail_public, EUR. Month-bucketed effective_date.

Cadence: weekly cron (Sanidad refreshes monthly, ~25th).
"""
from __future__ import annotations

import csv
import re
from datetime import date

import httpx

from backend.scrapers.pricing.base import PricingScraper

HOST = "https://www.sanidad.gob.es"
ENDPOINT = f"{HOST}/profesionales/nomenclator.do"
# displaytag export params: d-4015021-e=1 (CSV format), 6578706f7274=1 ("export")
_SEARCH_PARAMS = {"metodo": "buscarProductos", "especialidad": "%%%"}
_EXPORT_PARAMS = {**_SEARCH_PARAMS, "d-4015021-e": "1", "6578706f7274": "1"}

# Column indices in the facturación CSV
_CN, _NAME, _GENERIC, _LAB, _ESTADO, _INN, _PVP, _PREF = 0, 1, 3, 5, 6, 10, 11, 12

_STRENGTH_RE = re.compile(
    r"(\d[\d.,]*\s?(?:mg|mcg|g|ml|ui|%|mg/ml|mcg/ml)(?:/[\d.]*\s?(?:ml|g|h)?)?)",
    re.IGNORECASE,
)


def _parse_price(s: str) -> float | None:
    s = (s or "").strip()
    if not s:
        return None
    # ES format: "." thousands, "," decimal. Fall back to plain float.
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        v = float(s)
        return v if v > 0 else None
    except ValueError:
        return None


class SpainNomenclatorScraper(PricingScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000103"
    SOURCE_NAME:  str = "Spain Nomenclátor de facturación (SNS)"
    BASE_URL:     str = "https://www.sanidad.gob.es/profesionales/nomenclator.do"
    COUNTRY:      str = "Spain"
    COUNTRY_CODE: str = "ES"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 90.0
    SCRAPER_VERSION:  str = "1.0.0"

    def fetch(self) -> dict:
        # Session-primed export: search first (establishes the result set in the
        # displaytag session), then export with the same cookie jar.
        with httpx.Client(
            timeout=self.REQUEST_TIMEOUT, follow_redirects=True,
            headers={"User-Agent": self.DEFAULT_HEADERS["User-Agent"]},
        ) as c:
            c.get(ENDPOINT, params=_SEARCH_PARAMS)
            resp = c.get(ENDPOINT, params=_EXPORT_PARAMS)
            resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        if "csv" not in ct:
            raise RuntimeError(f"Nomenclátor export did not return CSV (content-type={ct})")
        lines = resp.text.splitlines()
        self.log.info("Nomenclátor de facturación fetched", extra={"lines": len(lines)})
        return {"lines": lines}

    def normalize(self, raw: dict) -> list[dict]:
        out: list[dict] = []
        effective = date.today().replace(day=1).isoformat()
        rows = list(csv.reader(raw.get("lines", [])))
        for c in rows[1:]:  # skip header
            if len(c) <= _PVP:
                continue
            price = _parse_price(c[_PVP])
            if price is None:
                continue  # no public price (magistral formulas, withdrawn, …)
            inn = (c[_INN] or "").strip()
            if not inn:
                continue  # medical devices / health products carry no INN — skip
            name = (c[_NAME] or "").strip()
            strength_m = _STRENGTH_RE.search(name)
            out.append({
                "product_name":     name or inn,
                "generic_name":     inn or name,    # principio activo = INN
                "inn":              inn or None,
                "strength":         strength_m.group(1).strip() if strength_m else None,
                "price_type":       "retail_public",
                "category":         "PVP con IVA",
                "authority":        "Ministerio de Sanidad",
                "pack_price":       price,
                "currency":         "EUR",
                "effective_date":   effective,
                "identifier_type":  "CN",
                "identifier_value": (c[_CN] or "").strip() or None,
                "source_url":       self.BASE_URL,
                "raw_record":       {
                    "estado": (c[_ESTADO] or "").strip() if len(c) > _ESTADO else None,
                    "laboratorio": (c[_LAB] or "").strip() if len(c) > _LAB else None,
                    "precio_referencia": _parse_price(c[_PREF]) if len(c) > _PREF else None,
                    "pvp_con_iva": price,
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
        print("DRY RUN — Spain Nomenclátor de facturación")
        print("=" * 60)
        scraper = SpainNomenclatorScraper(db_client=MagicMock())
        raw = scraper.fetch()
        rows = scraper.normalize(raw)
        print(f"  priced presentations: {len(rows)}")
        for r in rows[:8]:
            print(f"    {r['product_name'][:36]:36} inn={(r['inn'] or '')[:16]:16} CN {r['identifier_value']:>8}  €{r['pack_price']}")
        sys.exit(0)

    scraper = SpainNomenclatorScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
