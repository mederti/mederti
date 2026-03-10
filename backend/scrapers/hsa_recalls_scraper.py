"""
HSA — Drug Recalls Scraper (Singapore)
────────────────────────────────────────
Source:  Health Sciences Authority — Safety Alerts and Product Recalls
URL:     https://www.hsa.gov.sg/announcements/safety-alerts-and-product-recalls

Source UUID:  10000000-0000-0000-0000-000000000035
Country code: SG
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class HSARecallsScraper(BaseRecallScraper):
    """Scraper for HSA Singapore drug recalls and safety alerts."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000035"
    SOURCE_NAME:  str = "HSA — Drug Recalls (Singapore)"
    BASE_URL:     str = "https://www.hsa.gov.sg/announcements/safety-alerts-and-product-recalls"
    COUNTRY:      str = "Singapore"
    COUNTRY_CODE: str = "SG"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-SG,en;q=0.9",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching HSA recalls", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {"html": resp.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as exc:
            self.log.error("HSA fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("HSA: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        # HSA uses a table or list layout for announcements
        items = (
            soup.find_all("tr") or
            soup.find_all("li", class_=re.compile(r"item|result|announce", re.I)) or
            soup.find_all("a", href=re.compile(r"recall|safety|alert", re.I))
        )

        self.log.info("HSA items found", extra={"count": len(items)})

        for item in items[:200]:
            try:
                text = item.get_text(" ", strip=True)
                if not text or len(text) < 10:
                    continue

                drug_kw = ["tablet", "capsule", "injection", "mg", "medicine", "drug",
                           "pharmaceutical", "recall", "alert", "topical"]
                if not any(kw in text.lower() for kw in drug_kw):
                    continue

                name_el = item.find(["a", "strong", "b"])
                name = name_el.get_text(strip=True) if name_el else text[:60]
                name = re.split(r"[,\-–—\n]", name)[0].strip()[:100]
                if len(name) < 3:
                    continue

                # Date
                date_el = item.find("td", class_=re.compile(r"date", re.I)) or \
                          item.find(attrs={"class": re.compile(r"date", re.I)})
                date_raw = date_el.get_text(strip=True) if date_el else ""
                announced_date = self._parse_date(date_raw) or today

                # Lots
                lots = re.findall(r"\b([A-Z0-9]{4,15})\b", text)
                lots = [l for l in lots if re.search(r"\d", l)][:10]

                # Link
                link_el = item.find("a", href=True) if item.name != "a" else item
                press_url = self.BASE_URL
                if link_el and hasattr(link_el, "__getitem__"):
                    try:
                        href = link_el["href"]
                        press_url = f"https://www.hsa.gov.sg{href}" if href.startswith("/") else href
                    except Exception:
                        pass

                normalised.append({
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
                })
            except Exception as exc:
                self.log.debug("HSA item error", extra={"error": str(exc)})

        self.log.info("HSA normalisation done", extra={"records": len(normalised)})
        return normalised

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw.strip()[:20], fmt).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{4}-\d{2}-\d{2}", raw)
        return m.group(0) if m else None

    @staticmethod
    def _map_reason(text: str) -> str | None:
        lower = text.lower()
        if any(w in lower for w in ["contamination", "contaminated"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "dissolution"]):
            return "subpotency"
        if "sterility" in lower:
            return "sterility"
        if "packaging" in lower:
            return "packaging"
        if any(w in lower for w in ["foreign", "particulate"]):
            return "foreign_matter"
        return "other"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — HSA Recalls"); print("=" * 60)
        scraper = HSARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = HSARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
