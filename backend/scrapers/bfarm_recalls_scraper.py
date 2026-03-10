"""
BfArM — Drug Recalls Scraper (Germany)
───────────────────────────────────────
Source:  BfArM via PharmNet.Bund recall list
URL:     https://www.pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html

PharmNet publishes a searchable recall list. This scraper fetches the HTML
table and parses drug recall entries.

Source UUID:  10000000-0000-0000-0000-000000000030
Country code: DE
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class BfArMRecallsScraper(BaseRecallScraper):
    """Scraper for BfArM/PharmNet.Bund drug recall list (Germany)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000030"
    SOURCE_NAME:  str = "BfArM — Drug Recalls (Germany)"
    BASE_URL:     str = "https://www.pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html"
    COUNTRY:      str = "Germany"
    COUNTRY_CODE: str = "DE"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Referer":         "https://www.pharmnet-bund.de/",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching BfArM recalls HTML", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            return {
                "html": resp.text,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            self.log.error("BfArM fetch failed", extra={"error": str(exc)})
            return {"html": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        html = raw.get("html", "") if isinstance(raw, dict) else ""
        if not html:
            self.log.warning("BfArM: empty HTML response")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed — run: pip install beautifulsoup4")
            return []

        soup = BeautifulSoup(html, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()

        # PharmNet table: look for <table> with recall data
        tables = soup.find_all("table")
        self.log.info("BfArM tables found", extra={"count": len(tables)})

        normalised: list[dict] = []

        for table in tables:
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue

            # Detect header row
            headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
            if not any(h for h in headers if h in ["produkt", "arzneimittel", "präparat", "name"]):
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
                    self.log.debug("BfArM row error", extra={"error": str(exc)})

        # If table parsing yielded nothing, try a generic drug-keyword pass
        if not normalised:
            normalised = self._fallback_parse(soup, today)

        self.log.info("BfArM normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_row(self, cells: list[str], headers: list[str], today: str) -> dict | None:
        def _get(key_candidates: list[str]) -> str:
            for k in key_candidates:
                for i, h in enumerate(headers):
                    if k in h and i < len(cells):
                        return cells[i].strip()
            # Fallback: return first non-empty cell for this field
            return ""

        name = _get(["produkt", "arzneimittel", "präparat", "name", "bezeichnung"])
        if not name or len(name) < 3:
            return None

        date_raw = _get(["datum", "date", "rueckruf"])
        announced_date = self._parse_date(date_raw) or today

        lot_raw = _get(["chargen", "lot", "charge", "batch"])
        lot_numbers = [l.strip() for l in re.split(r"[,;/]", lot_raw) if l.strip()] if lot_raw else []

        reason_raw = _get(["grund", "reason", "ursache", "mangel"])

        return {
            "generic_name":     name[:100],
            "brand_name":       None,
            "manufacturer":     _get(["hersteller", "manufacturer", "firma"])[:200] or None,
            "recall_class":     None,
            "recall_type":      "batch" if lot_numbers else None,
            "reason":           reason_raw[:500] or None,
            "reason_category":  self._map_reason(reason_raw),
            "lot_numbers":      lot_numbers[:20],
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": self.BASE_URL,
            "confidence_score": 75,
            "recall_ref":       f"{name[:30]}|{announced_date}",
            "raw_record":       {"name": name, "date": date_raw, "lots": lot_raw},
        }

    def _fallback_parse(self, soup, today: str) -> list[dict]:
        """Generic parse: find text blocks mentioning drug recall keywords."""
        results: list[dict] = []
        drug_keywords = ["mg", "tabletten", "kapseln", "injektionslösung", "infusionslösung", "ampullen"]

        for el in soup.find_all(["tr", "li", "p", "div"]):
            text = el.get_text(" ", strip=True)
            if len(text) < 20 or len(text) > 500:
                continue
            if any(kw in text.lower() for kw in drug_keywords):
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
                    "confidence_score": 50,
                    "recall_ref":       text[:60],
                    "raw_record":       {"text": text[:300]},
                })
            if len(results) >= 200:
                break

        return results

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(raw[:10], fmt).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{2}\.\d{2}\.\d{4}", raw)
        if m:
            try:
                return datetime.strptime(m.group(0), "%d.%m.%Y").date().isoformat()
            except Exception:
                pass
        return None

    @staticmethod
    def _map_reason(raw: str) -> str | None:
        if not raw:
            return "other"
        lower = raw.lower()
        if any(w in lower for w in ["verunreinigung", "kontamination", "contamination"]):
            return "contamination"
        if any(w in lower for w in ["kennzeichnung", "kennzeichnungs", "etikett"]):
            return "mislabelling"
        if any(w in lower for w in ["gehalt", "wirkstoff", "potenz"]):
            return "subpotency"
        if any(w in lower for w in ["steril", "sterilität"]):
            return "sterility"
        if any(w in lower for w in ["verpackung", "behälter"]):
            return "packaging"
        if any(w in lower for w in ["fremdkörper", "fremdstoff"]):
            return "foreign_matter"
        return "other"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — BfArM Recalls"); print("=" * 60)
        scraper = BfArMRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Records: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = BfArMRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
