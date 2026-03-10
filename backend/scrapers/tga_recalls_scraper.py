"""
TGA Product Recalls Scraper (Australia)
────────────────────────────────────────
Source:  TGA — Therapeutic Goods Administration
URL:     https://www.tga.gov.au/safety/recalls-and-other-market-actions/market-actions

Data access note
────────────────
TGA recalls are published via DRAC (Drug Recall and Adverse Compliance system),
which is a JavaScript-rendered search interface. As of 2025 all static JSON/CSV
endpoints have been retired.

The DRAC search UI (https://apps.tga.gov.au/PROD/DRAC/arn-entry.aspx) requires
Playwright to export data. Until a Playwright-based implementation is complete,
this scraper attempts the old JSON endpoint as a fallback, then returns 0 records
gracefully if unavailable.

Source UUID:  10000000-0000-0000-0000-000000000027  (TGA Recalls, AU)
Country code: AU
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class TgaRecallsScraper(BaseRecallScraper):
    """Scraper for TGA product recall data (medicine subset)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000027"
    SOURCE_NAME:  str = "TGA — Product Recalls (Australia)"
    BASE_URL:     str = "https://www.tga.gov.au/safety/recalls-and-other-market-actions/market-actions"
    JSON_URL:     str = "https://www.tga.gov.au/sites/default/files/product-recalls.json"
    COUNTRY:      str = "Australia"
    COUNTRY_CODE: str = "AU"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "application/json, text/html;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Referer":         "https://www.tga.gov.au/",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Fetch TGA recalls. Tries JSON endpoint first, falls back to HTML.

        Returns:
            {"records": list[dict], "source": str, "fetched_at": str}
        """
        self.log.info("Fetching TGA recalls", extra={"url": self.JSON_URL})

        # Try JSON feed first
        try:
            with httpx.Client(
                headers=self._HEADERS,
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(self.JSON_URL)
                if resp.status_code == 200:
                    data = resp.json()
                    records = data if isinstance(data, list) else data.get("data", data.get("recalls", []))
                    self.log.info("TGA recalls JSON fetched", extra={"records": len(records)})
                    return {
                        "records": records,
                        "source": "json",
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    }
        except Exception as exc:
            self.log.debug("TGA JSON endpoint not available", extra={"error": str(exc)})

        # Fallback: HTML page
        try:
            with httpx.Client(
                headers={**self._HEADERS, "Accept": "text/html"},
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(self.BASE_URL)
                resp.raise_for_status()
            self.log.info("TGA recalls HTML fetched", extra={"bytes": len(resp.content)})
            return {
                "records": [],
                "html": resp.text,
                "source": "html",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            self.log.warning("TGA recalls fetch failed — returning 0 records gracefully",
                             extra={"error": str(exc)})

        return {"records": [], "source": "none", "fetched_at": datetime.now(timezone.utc).isoformat()}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        """Convert TGA recall records to recall dicts."""
        source = raw.get("source", "none") if isinstance(raw, dict) else "none"
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []

        if source == "json":
            records = raw.get("records", []) if isinstance(raw, dict) else []
            for item in records:
                try:
                    result = self._normalise_json_record(item, today)
                    if result:
                        normalised.append(result)
                except Exception as exc:
                    self.log.debug("TGA recalls: item error", extra={"error": str(exc)})

        elif source == "html":
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(raw.get("html", ""), "html.parser")
                for item in soup.find_all(["article", "li", "tr"]):
                    text = item.get_text(strip=True)
                    if not text or len(text) < 10:
                        continue
                    if any(w in text.lower() for w in ["medicine", "drug", "tablet", "capsule", "injection"]):
                        normalised.append({
                            "generic_name":     text[:80],
                            "brand_name":       None,
                            "manufacturer":     None,
                            "recall_class":     None,
                            "recall_type":      None,
                            "reason_category":  "other",
                            "lot_numbers":      [],
                            "announced_date":   today,
                            "status":           "active",
                            "press_release_url": self.BASE_URL,
                            "confidence_score": 50,
                            "recall_ref":       text[:60],
                            "raw_record":       {"text": text[:300]},
                        })
            except Exception as exc:
                self.log.warning("TGA recalls HTML parse error", extra={"error": str(exc)})

        self.log.info(
            "TGA recalls normalisation done",
            extra={"normalised": len(normalised), "source": source},
        )
        return normalised

    def _normalise_json_record(self, item: dict, today: str) -> dict | None:
        # Only process medicine recalls
        category = (item.get("category") or item.get("type") or "").lower()
        if category and not any(w in category for w in ["medicine", "drug", "pharmaceutical", "biolog"]):
            return None

        name = (
            item.get("product_name") or item.get("productName") or
            item.get("name") or item.get("title") or ""
        ).strip()
        if not name:
            return None

        date_raw = item.get("recall_date") or item.get("date") or item.get("published") or ""
        announced_date = self._parse_date(date_raw) or today

        lot_raw = item.get("lot_numbers") or item.get("batch") or ""
        lot_numbers = [l.strip() for l in str(lot_raw).split(",") if l.strip()] if lot_raw else []

        return {
            "generic_name":     name,
            "brand_name":       item.get("brand_name") or None,
            "manufacturer":     item.get("sponsor") or item.get("manufacturer") or None,
            "recall_class":     None,
            "recall_type":      "batch" if lot_numbers else None,
            "reason":           item.get("reason") or item.get("recall_reason") or None,
            "reason_category":  "other",
            "lot_numbers":      lot_numbers,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": item.get("url") or self.BASE_URL,
            "confidence_score": 80,
            "recall_ref":       item.get("id") or item.get("arn") or name[:40],
            "raw_record":       item,
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d %B %Y"):
            try:
                return datetime.strptime(str(raw)[:10], fmt[:10]).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{4}-\d{2}-\d{2}", str(raw))
        return m.group(0) if m else None


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — TGA Recalls"); print("=" * 60)
        scraper = TgaRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  source : {raw.get('source')}")
        print(f"  records: {len(raw.get('records', []))}")
        recalls = scraper.normalize(raw)
        print(f"  recalls: {len(recalls)}")
        sys.exit(0)
    scraper = TgaRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
