"""
AEMPS — Drug Recalls Scraper (Spain)
──────────────────────────────────────
Source:  AEMPS — Agencia Española de Medicamentos y Productos Sanitarios
URL:     https://cima.aemps.es/cima/publico/lista.html (CIMA)
         https://www.aemps.gob.es/informa/notasInformativas/medicamentosUsoHumano/

Source UUID:  10000000-0000-0000-0000-000000000033
Country code: ES
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class AEMPSRecallsScraper(BaseRecallScraper):
    """Scraper for AEMPS Spain drug recall notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000033"
    SOURCE_NAME:  str = "AEMPS — Drug Recalls (Spain)"
    BASE_URL:     str = "https://www.aemps.gob.es/informa/notasInformativas/medicamentosUsoHumano/"
    COUNTRY:      str = "Spain"
    COUNTRY_CODE: str = "ES"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching AEMPS recalls", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {"html": resp.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as exc:
            self.log.error("AEMPS fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("AEMPS: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        items = (
            soup.find_all(["article", "li"], class_=re.compile(r"news|item|nota|result", re.I)) or
            soup.find_all("a", href=re.compile(r"retirada|recall|alerta|nota", re.I)) or
            soup.find_all("tr")
        )

        self.log.info("AEMPS items found", extra={"count": len(items)})

        for item in items[:200]:
            try:
                result = self._normalise_item(item, today)
                if result:
                    normalised.append(result)
            except Exception as exc:
                self.log.debug("AEMPS item error", extra={"error": str(exc)})

        if not normalised:
            normalised = self._text_fallback(soup, today)

        self.log.info("AEMPS normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_item(self, item, today: str) -> dict | None:
        text = item.get_text(" ", strip=True)
        if not text or len(text) < 10:
            return None

        drug_kw = ["comprimido", "cápsula", "inyección", "solución", "mg", "ampolla",
                   "medicamento", "antibiótico", "retirada", "recall"]
        if not any(kw in text.lower() for kw in drug_kw):
            return None

        name_el = item.find(["h2", "h3", "h4", "strong", "a"])
        name = name_el.get_text(strip=True) if name_el else text[:80]
        name = re.split(r"[,\-–—\n]", name)[0].strip()[:100]
        if len(name) < 3:
            return None

        date_el = item.find("time") or item.find(attrs={"class": re.compile(r"date|fecha", re.I)})
        date_raw = ""
        if date_el:
            date_raw = date_el.get("datetime", "") or date_el.get_text(strip=True)
        announced_date = self._parse_date(date_raw) or today

        lots = re.findall(r"\b([A-Z0-9]{4,15})\b", text)
        lots = [l for l in lots if re.search(r"\d", l)][:10]

        link_el = item.find("a", href=True) if not item.name == "a" else item
        press_url = self.BASE_URL
        if link_el and isinstance(link_el, dict.__class__):
            pass
        elif hasattr(item, "get") and item.get("href"):
            href = item["href"]
            press_url = f"https://www.aemps.gob.es{href}" if href.startswith("/") else href
        elif link_el and hasattr(link_el, "__getitem__"):
            try:
                href = link_el["href"]
                press_url = f"https://www.aemps.gob.es{href}" if href.startswith("/") else href
            except Exception:
                pass

        return {
            "generic_name":     name,
            "brand_name":       None,
            "manufacturer":     None,
            "recall_class":     None,
            "recall_type":      "batch" if lots else None,
            "reason":           text[:400] or None,
            "reason_category":  self._map_reason(text),
            "lot_numbers":      lots,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 72,
            "recall_ref":       press_url,
            "raw_record":       {"text": text[:300]},
        }

    def _text_fallback(self, soup, today: str) -> list[dict]:
        results: list[dict] = []
        drug_kw = ["comprimido", "cápsula", "mg", "medicamento", "retirada", "recall"]
        for p in soup.find_all(["p", "li", "td"]):
            text = p.get_text(" ", strip=True)
            if 20 < len(text) < 400 and any(kw in text.lower() for kw in drug_kw):
                name = " ".join(text.split()[:4])[:60]
                results.append({
                    "generic_name":     name,
                    "brand_name":       None,
                    "manufacturer":     None,
                    "recall_class":     None,
                    "recall_type":      None,
                    "reason":           text[:300],
                    "reason_category":  "other",
                    "lot_numbers":      [],
                    "announced_date":   today,
                    "status":           "active",
                    "press_release_url": self.BASE_URL,
                    "confidence_score": 45,
                    "recall_ref":       text[:60],
                    "raw_record":       {"text": text[:300]},
                })
            if len(results) >= 100:
                break
        return results

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y"):
            try:
                return datetime.strptime(raw[:10], fmt[:10]).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{4}-\d{2}-\d{2}", raw)
        return m.group(0) if m else None

    @staticmethod
    def _map_reason(text: str) -> str | None:
        lower = text.lower()
        if any(w in lower for w in ["contaminación", "impureza"]):
            return "contamination"
        if any(w in lower for w in ["etiquetado", "etiqueta"]):
            return "mislabelling"
        if any(w in lower for w in ["potencia", "dosificación"]):
            return "subpotency"
        if any(w in lower for w in ["estéril", "esterilidad"]):
            return "sterility"
        if any(w in lower for w in ["envase", "embalaje"]):
            return "packaging"
        if any(w in lower for w in ["partícula", "cuerpo extraño"]):
            return "foreign_matter"
        return "other"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — AEMPS Recalls"); print("=" * 60)
        scraper = AEMPSRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = AEMPSRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
