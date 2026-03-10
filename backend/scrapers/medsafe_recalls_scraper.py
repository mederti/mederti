"""
Medsafe — Product Recalls Scraper (New Zealand)
────────────────────────────────────────────────
Source:  Medsafe — New Zealand Medicines and Medical Devices Safety Authority
URL:     https://www.medsafe.govt.nz/safety/Recalls.asp

Source UUID:  10000000-0000-0000-0000-000000000034
Country code: NZ
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class MedsafeRecallsScraper(BaseRecallScraper):
    """Scraper for Medsafe NZ product recall notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000034"
    SOURCE_NAME:  str = "Medsafe — Product Recalls (New Zealand)"
    BASE_URL:     str = "https://www.medsafe.govt.nz/safety/Recalls.asp"
    COUNTRY:      str = "New Zealand"
    COUNTRY_CODE: str = "NZ"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-NZ,en;q=0.9",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching Medsafe recalls", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {"html": resp.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as exc:
            self.log.error("Medsafe fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("Medsafe: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        # Medsafe typically uses HTML tables for recalls
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue

            headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
            if not any(h for h in headers if h in ["product", "medicine", "recall", "date"]):
                continue

            for row in rows[1:]:
                cells = [td.get_text(strip=True) for td in row.find_all("td")]
                if len(cells) < 2:
                    continue
                try:
                    result = self._normalise_row(cells, headers, today)
                    if result:
                        normalised.append(result)
                except Exception as exc:
                    self.log.debug("Medsafe row error", extra={"error": str(exc)})

        if not normalised:
            # Fallback: find recall items in divs/lists
            for item in soup.find_all(["li", "div", "p"]):
                text = item.get_text(" ", strip=True)
                drug_kw = ["tablet", "capsule", "injection", "mg", "medicine", "recall"]
                if 20 < len(text) < 400 and any(kw in text.lower() for kw in drug_kw):
                    name = " ".join(text.split()[:4])[:60]
                    normalised.append({
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
                        "confidence_score": 55,
                        "recall_ref":       text[:60],
                        "raw_record":       {"text": text[:300]},
                    })
                if len(normalised) >= 100:
                    break

        self.log.info("Medsafe normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_row(self, cells: list[str], headers: list[str], today: str) -> dict | None:
        def _get(keys: list[str]) -> str:
            for k in keys:
                for i, h in enumerate(headers):
                    if k in h and i < len(cells):
                        return cells[i].strip()
            return cells[0] if cells else ""

        name = _get(["product", "medicine", "name", "brand"])
        if not name or len(name) < 3:
            return None

        date_raw = _get(["date", "recall date", "notified"])
        announced_date = self._parse_date(date_raw) or today

        lot_raw = _get(["lot", "batch", "code"])
        lots = [l.strip() for l in re.split(r"[,;/]", lot_raw) if l.strip()] if lot_raw else []

        reason_raw = _get(["reason", "action"])
        mfr = _get(["sponsor", "manufacturer", "company"])

        return {
            "generic_name":     name[:100],
            "brand_name":       None,
            "manufacturer":     mfr[:200] or None,
            "recall_class":     None,
            "recall_type":      "batch" if lots else None,
            "reason":           reason_raw[:500] or None,
            "reason_category":  self._map_reason(reason_raw),
            "lot_numbers":      lots[:20],
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": self.BASE_URL,
            "confidence_score": 78,
            "recall_ref":       f"{name[:30]}|{announced_date}",
            "raw_record":       {"name": name, "date": date_raw, "lots": lot_raw},
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d %B %Y", "%d/%m/%Y", "%Y-%m-%d", "%B %Y"):
            try:
                return datetime.strptime(raw.strip()[:20], fmt).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{4}-\d{2}-\d{2}", raw)
        return m.group(0) if m else None

    @staticmethod
    def _map_reason(raw: str) -> str | None:
        if not raw:
            return "other"
        lower = raw.lower()
        if any(w in lower for w in ["contamination", "impurity"]):
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
        print("=" * 60); print("DRY RUN — Medsafe Recalls"); print("=" * 60)
        scraper = MedsafeRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = MedsafeRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
