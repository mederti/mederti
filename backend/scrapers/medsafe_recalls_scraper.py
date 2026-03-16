"""
Medsafe — Product Recalls Scraper (New Zealand)
────────────────────────────────────────────────
Source:  Medsafe — New Zealand Medicines and Medical Devices Safety Authority
URL:     https://www.medsafe.govt.nz/hot/recalls/RecallSearch.asp

Approach:
  1. POST the search form with optType=Medicine to get the recall listing table.
  2. Parse each row: Date | Brand Name (with detail link) | Recall Action.
  3. Fetch each detail page (RecallDetail.asp?ID=...) for rich data:
     batch numbers, manufacturer, issue/reason, recall level, dose form.

Source UUID:  10000000-0000-0000-0000-000000000034
Country code: NZ
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class MedsafeRecallsScraper(BaseRecallScraper):
    """Scraper for Medsafe NZ product recall notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000034"
    SOURCE_NAME:  str = "Medsafe — Product Recalls (New Zealand)"
    BASE_URL:     str = "https://www.medsafe.govt.nz/hot/recalls/RecallSearch.asp"
    COUNTRY:      str = "New Zealand"
    COUNTRY_CODE: str = "NZ"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language":  "en-NZ,en;q=0.9",
    }

    # Detail page base (relative IDs appended)
    _DETAIL_BASE: str = "https://www.medsafe.govt.nz/hot/recalls/RecallDetail.asp?ID="

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """POST the search form for all Medicine recalls since 1 Jul 2012."""
        self.log.info("Fetching Medsafe recalls", extra={"url": self.BASE_URL})
        try:
            with httpx.Client(
                headers=self._HEADERS,
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.post(
                    self.BASE_URL,
                    data={
                        "optType":     "Medicine",
                        "txtName":     "",
                        "Ingredients": "",
                        "txtDateFrom": "1 Jul 2012",
                        "txtDateTo":   "",
                        "cmdSearch":   "Search",
                    },
                )
                resp.raise_for_status()
                return {
                    "html": resp.text,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }
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

        # ── Validate the page contains actual results ──────────────────────
        results_heading = soup.find("h3", id="results")
        count_p = soup.find("p", string=re.compile(r"Number of product recall actions", re.I))
        if not results_heading and not count_p:
            self.log.warning("Medsafe: no recall results section found — page may be 404 or empty")
            return []

        # ── Find the results table (has headers: Date | Brand Name | Recall Action) ──
        normalised: list[dict] = []
        today = datetime.now(timezone.utc).date().isoformat()

        for table in soup.find_all("table", attrs={"border": "1"}):
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue

            header_cells = rows[0].find_all("th")
            headers = [th.get_text(strip=True).lower() for th in header_cells]

            # Must have "date" and "brand name" columns
            if not (any("date" in h for h in headers) and any("brand" in h for h in headers)):
                continue

            for row in rows[1:]:
                cells = row.find_all("td")
                if len(cells) < 2:
                    continue

                try:
                    result = self._parse_listing_row(cells, today)
                    if result:
                        normalised.append(result)
                except Exception as exc:
                    self.log.debug("Medsafe row parse error", extra={"error": str(exc)})

        # ── Fetch detail pages for richer data ─────────────────────────────
        enriched = []
        for item in normalised:
            detail_id = item.pop("_detail_id", None)
            if detail_id:
                try:
                    detail = self._fetch_detail(detail_id)
                    if detail:
                        self._merge_detail(item, detail)
                except Exception as exc:
                    self.log.debug("Detail fetch failed", extra={"id": detail_id, "error": str(exc)})
            enriched.append(item)

        self.log.info("Medsafe normalisation done", extra={"records": len(enriched)})
        return enriched

    # ─────────────────────────────────────────────────────────────────────────
    # Listing row parser
    # ─────────────────────────────────────────────────────────────────────────

    def _parse_listing_row(self, cells, today: str) -> dict | None:
        """Parse a row from the search results table.
        Columns: Date | Brand Name (with <a> link to detail) | Recall Action
        """
        date_raw = cells[0].get_text(strip=True)
        announced_date = self._parse_date(date_raw) or today

        # Brand name + detail link
        brand_cell = cells[1]
        brand_name = brand_cell.get_text(strip=True)
        if not brand_name or len(brand_name) < 2:
            return None

        # Extract detail page ID from link
        detail_id = None
        link = brand_cell.find("a", href=True)
        if link:
            m = re.search(r"ID=(\d+)", link["href"])
            if m:
                detail_id = m.group(1)

        # Recall action type (column 3)
        action = cells[2].get_text(strip=True) if len(cells) > 2 else "Recall"

        detail_url = f"{self._DETAIL_BASE}{detail_id}" if detail_id else self.BASE_URL

        return {
            "generic_name":      brand_name[:100],
            "brand_name":        brand_name[:200],
            "manufacturer":      None,
            "recall_class":      None,
            "recall_type":       None,
            "reason":            None,
            "reason_category":   "other",
            "lot_numbers":       [],
            "announced_date":    announced_date,
            "status":            "active",
            "press_release_url": detail_url,
            "confidence_score":  90,
            "recall_ref":        f"MEDSAFE-{detail_id}" if detail_id else f"{brand_name[:30]}|{announced_date}",
            "raw_record":        {"brand_name": brand_name, "date": date_raw, "action": action},
            "_detail_id":        detail_id,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Detail page fetcher + parser
    # ─────────────────────────────────────────────────────────────────────────

    def _fetch_detail(self, recall_id: str) -> dict | None:
        """Fetch and parse a RecallDetail.asp?ID=... page."""
        url = f"{self._DETAIL_BASE}{recall_id}"
        time.sleep(self.RATE_LIMIT_DELAY)
        self.log.debug("Fetching recall detail", extra={"url": url})

        try:
            with httpx.Client(
                headers=self._HEADERS,
                timeout=self.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(url)
                resp.raise_for_status()
        except Exception:
            return None

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")

        # The detail page uses a <table border="0"> with rows of:
        #   <td style="...font-weight: bold">Label:</td><td>Value</td>
        fields: dict[str, str] = {}
        for table in soup.find_all("table", attrs={"border": "0"}):
            for row in table.find_all("tr"):
                tds = row.find_all("td")
                if len(tds) >= 2:
                    label = tds[0].get_text(strip=True).rstrip(":").strip()
                    value = tds[1].get_text(" ", strip=True)
                    if label and value:
                        fields[label.lower()] = value

        if not fields:
            return None

        return fields

    def _merge_detail(self, item: dict, detail: dict) -> None:
        """Merge detail page fields into the normalised recall record."""
        # Manufacturer
        mfr = detail.get("manufacturer") or detail.get("recalling organisation")
        if mfr and mfr.strip():
            item["manufacturer"] = mfr.strip()[:200]

        # Reason / Issue
        issue = detail.get("issue") or detail.get("reason for recall")
        if issue:
            item["reason"] = issue[:500]
            item["reason_category"] = self._map_reason(issue)

        # Batch / Lot numbers from "Affected" field
        affected = detail.get("affected", "")
        if affected:
            # e.g. "Batch Number: 1075495 and 1081745"
            batch_text = re.sub(r"(?i)batch\s*(?:number|no\.?)?:?\s*", "", affected)
            lots = [l.strip() for l in re.split(r"[,;&]|\band\b", batch_text) if l.strip()]
            if lots:
                item["lot_numbers"] = lots[:20]
                item["recall_type"] = "batch"

        # Recall level → map to recall class
        level = detail.get("level of recall", "").lower()
        if "consumer" in level or "public" in level:
            item["recall_class"] = "I"
        elif "healthcare" in level or "professional" in level:
            item["recall_class"] = "II"
        elif "wholesaler" in level or "retail" in level or "hospital" in level:
            item["recall_class"] = "III"

        # Dose form (store in raw_record for reference)
        dose = detail.get("dose form/strength") or detail.get("dose form")
        if dose:
            item["raw_record"]["dose_form"] = dose

        # Update brand name from detail if available
        brand = detail.get("brand name")
        if brand and brand.strip():
            item["brand_name"] = brand.strip()[:200]
            item["generic_name"] = brand.strip()[:100]

    # ─────────────────────────────────────────────────────────────────────────
    # Helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d/%m/%Y", "%d %B %Y", "%Y-%m-%d", "%B %Y"):
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
        if any(w in lower for w in ["contamination", "impurity", "nitrosamine"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling", "incorrect"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "dissolution", "assay"]):
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
        for i, r in enumerate(recalls[:5]):
            print(f"\n── Record {i+1}:")
            print(json.dumps({k: v for k, v in r.items() if k != "raw_record"}, indent=2, default=str))
        if len(recalls) > 5:
            print(f"\n... and {len(recalls) - 5} more")
        sys.exit(0)
    scraper = MedsafeRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
