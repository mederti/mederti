"""
ANSM — Rappels de Lots Scraper (France)
────────────────────────────────────────
Source:  ANSM — Agence nationale de sécurité du médicament et des produits de santé
URL:     https://ansm.sante.fr/rappels-de-lots

ANSM publishes lot recall notices on their website. This scraper fetches the
listing page and individual recall entries.

Source UUID:  10000000-0000-0000-0000-000000000031
Country code: FR
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class ANSMRecallsScraper(BaseRecallScraper):
    """Scraper for ANSM France lot recall notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000031"
    SOURCE_NAME:  str = "ANSM — Rappels de Lots (France)"
    BASE_URL:     str = "https://ansm.sante.fr/rappels-de-lots"
    COUNTRY:      str = "France"
    COUNTRY_CODE: str = "FR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching ANSM recalls page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {
                "html": resp.text,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            self.log.error("ANSM fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("ANSM: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        # ANSM recall items appear as article/card elements or list items
        # Try multiple selectors
        items = (
            soup.find_all("article", class_=re.compile(r"recall|product|rappel", re.I)) or
            soup.find_all("li", class_=re.compile(r"recall|product|rappel|item", re.I)) or
            soup.find_all(["article", "li", "div"], attrs={"data-type": re.compile(r"recall|rappel", re.I)}) or
            soup.find_all("div", class_=re.compile(r"card|item|entry|result", re.I))
        )

        if not items:
            # Fallback: find all links pointing to recall detail pages
            items = soup.find_all("a", href=re.compile(r"/rappels-de-lots/", re.I))

        self.log.info("ANSM items found", extra={"count": len(items)})

        for item in items[:200]:
            try:
                result = self._normalise_item(item, today)
                if result:
                    normalised.append(result)
            except Exception as exc:
                self.log.debug("ANSM item error", extra={"error": str(exc)})

        # If no items found, do a text-based pass for drug recall hints
        if not normalised:
            normalised = self._text_fallback(soup, today)

        self.log.info("ANSM normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_item(self, item, today: str) -> dict | None:
        text = item.get_text(" ", strip=True)
        if not text or len(text) < 10:
            return None

        # Drug keywords (French)
        drug_kw = ["comprimé", "gélule", "injection", "solution", "mg", "flacon", "ampoule",
                   "médicament", "produit pharmaceutique", "antibiotique", "vaccin"]
        if not any(kw in text.lower() for kw in drug_kw):
            return None

        # Name: first line or title element
        name_el = item.find(["h2", "h3", "h4", "strong", "a"])
        name = name_el.get_text(strip=True) if name_el else text[:80]
        name = re.split(r"[,\-–—\n]", name)[0].strip()[:100]
        if len(name) < 3:
            return None

        # Date
        date_el = item.find(attrs={"class": re.compile(r"date|time", re.I)}) or item.find("time")
        date_raw = ""
        if date_el:
            date_raw = date_el.get("datetime", "") or date_el.get_text(strip=True)
        announced_date = self._parse_date(date_raw) or today

        # Lots
        lots = re.findall(r"\b([A-Z0-9]{4,15})\b", text)
        lots = [l for l in lots if re.search(r"\d", l)][:10]

        # Link
        link_el = item.find("a", href=True)
        press_url = self.BASE_URL
        if link_el:
            href = link_el["href"]
            press_url = f"https://ansm.sante.fr{href}" if href.startswith("/") else href

        return {
            "generic_name":     name,
            "brand_name":       None,
            "manufacturer":     None,
            "recall_class":     None,
            "recall_type":      "batch" if lots else None,
            "reason":           text[:400] if len(text) > 10 else None,
            "reason_category":  self._map_reason(text),
            "lot_numbers":      lots,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 72,
            "recall_ref":       press_url,
            "raw_record":       {"text": text[:300], "url": press_url},
        }

    def _text_fallback(self, soup, today: str) -> list[dict]:
        results: list[dict] = []
        drug_kw = ["comprimé", "gélule", "injection", "mg", "ampoule", "médicament"]
        for p in soup.find_all(["p", "li", "div"]):
            text = p.get_text(" ", strip=True)
            if 20 < len(text) < 400 and any(kw in text.lower() for kw in drug_kw):
                name = text.split()[0:4]
                results.append({
                    "generic_name":     " ".join(name)[:60],
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
        if any(w in lower for w in ["contamination", "impureté"]):
            return "contamination"
        if any(w in lower for w in ["étiquetage", "étiquette", "mention"]):
            return "mislabelling"
        if any(w in lower for w in ["dosage", "teneur", "concentration"]):
            return "subpotency"
        if any(w in lower for w in ["stérile", "stérilité"]):
            return "sterility"
        if any(w in lower for w in ["conditionnement", "emballage"]):
            return "packaging"
        if any(w in lower for w in ["particule", "corps étranger"]):
            return "foreign_matter"
        return "other"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — ANSM Recalls"); print("=" * 60)
        scraper = ANSMRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = ANSMRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
