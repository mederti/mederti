"""
AIFA — Drug Recalls Scraper (Italy)
────────────────────────────────────
Source:  AIFA — Agenzia Italiana del Farmaco
URL:     https://www.aifa.gov.it/richiami

AIFA publishes recall notices as HTML news items. This scraper fetches the
recall listing page and parses entries.

Source UUID:  10000000-0000-0000-0000-000000000032
Country code: IT
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class AIFARecallsScraper(BaseRecallScraper):
    """Scraper for AIFA Italy drug recall notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000032"
    SOURCE_NAME:  str = "AIFA — Drug Recalls (Italy)"
    BASE_URL:     str = "https://www.aifa.gov.it/richiami"
    COUNTRY:      str = "Italy"
    COUNTRY_CODE: str = "IT"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching AIFA recalls", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {"html": resp.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as exc:
            self.log.error("AIFA fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("AIFA: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        # AIFA uses various markup structures — try broad selectors
        items = (
            soup.find_all("div", class_=re.compile(r"news|article|item|result|card", re.I)) or
            soup.find_all("article") or
            soup.find_all("li", class_=re.compile(r"item|result", re.I))
        )

        if not items:
            # Fallback: links to recall detail pages
            items = soup.find_all("a", href=re.compile(r"/richiami?/|richiamo", re.I))

        self.log.info("AIFA items found", extra={"count": len(items)})

        for item in items[:200]:
            try:
                result = self._normalise_item(item, today)
                if result:
                    normalised.append(result)
            except Exception as exc:
                self.log.debug("AIFA item error", extra={"error": str(exc)})

        if not normalised:
            normalised = self._text_fallback(soup, today)

        self.log.info("AIFA normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_item(self, item, today: str) -> dict | None:
        text = item.get_text(" ", strip=True)
        if not text or len(text) < 10:
            return None

        drug_kw = ["compressa", "capsula", "iniezione", "soluzione", "mg", "fiala",
                   "farmaco", "medicinale", "antibiotico", "vaccino"]
        if not any(kw in text.lower() for kw in drug_kw):
            return None

        name_el = item.find(["h2", "h3", "h4", "strong", "a"])
        name = name_el.get_text(strip=True) if name_el else text[:80]
        name = re.split(r"[,\-–—\n]", name)[0].strip()[:100]
        if len(name) < 3:
            return None

        date_el = item.find("time") or item.find(attrs={"class": re.compile(r"date|time", re.I)})
        date_raw = ""
        if date_el:
            date_raw = date_el.get("datetime", "") or date_el.get_text(strip=True)
        announced_date = self._parse_date(date_raw) or today

        lots = re.findall(r"\b([A-Z0-9]{4,15})\b", text)
        lots = [l for l in lots if re.search(r"\d", l)][:10]

        link_el = item.find("a", href=True)
        press_url = self.BASE_URL
        if link_el:
            href = link_el["href"]
            press_url = f"https://www.aifa.gov.it{href}" if href.startswith("/") else href

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
        drug_kw = ["compressa", "capsula", "mg", "farmaco", "richiamo"]
        for p in soup.find_all(["p", "li", "div"]):
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
        if any(w in lower for w in ["contaminazione", "impurità"]):
            return "contamination"
        if any(w in lower for w in ["etichett", "etichettatura"]):
            return "mislabelling"
        if any(w in lower for w in ["dosaggio", "potenza", "tenore"]):
            return "subpotency"
        if any(w in lower for w in ["sterile", "sterilità"]):
            return "sterility"
        if any(w in lower for w in ["confezionamento", "imballaggio"]):
            return "packaging"
        if any(w in lower for w in ["particelle", "corpo estraneo"]):
            return "foreign_matter"
        return "other"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — AIFA Recalls"); print("=" * 60)
        scraper = AIFARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = AIFARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
