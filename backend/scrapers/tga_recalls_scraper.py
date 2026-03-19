"""
TGA Product Recalls Scraper (Australia) — DRAC
───────────────────────────────────────────────
Source:  TGA — Therapeutic Goods Administration
System:  DRAC (Database of Recalls, Product Alerts and Product Corrections)
URL:     https://apps.tga.gov.au/PROD/DRAC/

Strategy: enumerate detail pages by TGA Action ID (RC-{year}-RN-{num:05d}-1).
Each detail page is a standalone HTML page with labelled <span> fields.
Filter to ProductType == "Medicine" only.

Source UUID:  10000000-0000-0000-0000-000000000027  (TGA Recalls, AU)
Country code: AU
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class _SpanParser(HTMLParser):
    """Extract <span id="lbl*"> values from DRAC detail page."""

    def __init__(self):
        super().__init__()
        self._current_id: str | None = None
        self._capture = False
        self.fields: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "span" and (sid := d.get("id", "")).startswith("lbl"):
            self._current_id = sid
            self._capture = True
            self.fields[sid] = ""

    def handle_data(self, data):
        if self._capture and self._current_id:
            self.fields[self._current_id] += data

    def handle_endtag(self, tag):
        if tag == "span" and self._capture:
            self._capture = False


class TgaRecallsScraper(BaseRecallScraper):
    """Scraper for TGA DRAC recall data (medicine subset)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000027"
    SOURCE_NAME:  str = "TGA — Product Recalls (Australia)"
    BASE_URL:     str = "https://apps.tga.gov.au/PROD/DRAC"
    DETAIL_URL:   str = "https://apps.tga.gov.au/PROD/DRAC/arn-detail.aspx?k={action_id}"
    COUNTRY:      str = "Australia"
    COUNTRY_CODE: str = "AU"

    RATE_LIMIT_DELAY: float = 0.5
    REQUEST_TIMEOUT:  float = 15.0

    # How many years back to scan
    SCAN_YEARS: list[int] = list(range(2020, datetime.now().year + 1))
    # Max ID to try per year (most years have <1000 total entries)
    MAX_ID_PER_YEAR: int = 1000
    # Stop after N consecutive misses within a year
    MAX_CONSECUTIVE_MISS: int = 40

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html",
        "Accept-Language":  "en-AU,en;q=0.9",
    }

    _CLASS_MAP: dict[str, str] = {
        "class i":   "I",
        "class ii":  "II",
        "class iii": "III",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Enumerate DRAC detail pages for each year. Return list of parsed records.
        Only includes Medicine product type.
        """
        all_records: list[dict] = []
        total_checked = 0
        total_exist = 0

        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=False,
        ) as client:
            for year in self.SCAN_YEARS:
                year_count = 0
                consecutive_miss = 0

                for num in range(1, self.MAX_ID_PER_YEAR + 1):
                    action_id = f"RC-{year}-RN-{num:05d}-1"
                    total_checked += 1

                    try:
                        resp = client.get(self.DETAIL_URL.format(action_id=action_id))
                    except Exception:
                        consecutive_miss += 1
                        if consecutive_miss >= self.MAX_CONSECUTIVE_MISS:
                            break
                        continue

                    if resp.status_code != 200:
                        consecutive_miss += 1
                        if consecutive_miss >= self.MAX_CONSECUTIVE_MISS:
                            break
                        continue

                    consecutive_miss = 0
                    total_exist += 1

                    # Parse the detail page
                    parser = _SpanParser()
                    parser.feed(resp.text)
                    f = parser.fields

                    # Only keep Medicine
                    product_type = f.get("lblProductType", "").strip()
                    if product_type != "Medicine":
                        continue

                    year_count += 1
                    all_records.append({
                        "action_id":    action_id,
                        "product_type": product_type,
                        "product_name": f.get("lblProductName", "").strip(),
                        "artg_no":      f.get("lblArtgNo", "").strip(),
                        "action_type":  f.get("lblRecallType", "").strip(),
                        "action_level": f.get("lblLevel", "").strip(),
                        "hazard_class": f.get("lblClass", "").strip(),
                        "reason":       f.get("lblInformation", "").strip(),
                        "instructions": f.get("lblReason", "").strip(),
                        "action_date":  f.get("lblRecallDate", "").strip(),
                        "sponsor":      f.get("lblSponsor", "").strip(),
                        "contact":      f.get("lblContact", "").strip(),
                    })

                    # Rate limit
                    if self.RATE_LIMIT_DELAY > 0:
                        time.sleep(self.RATE_LIMIT_DELAY)

                self.log.info(
                    "TGA DRAC year scan",
                    extra={"year": year, "medicines": year_count},
                )

        self.log.info(
            "TGA DRAC fetch complete",
            extra={
                "checked": total_checked,
                "existed": total_exist,
                "medicines": len(all_records),
            },
        )
        return all_records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result:
                    normalised.append(result)
                else:
                    skipped += 1
            except Exception as exc:
                skipped += 1
                self.log.debug("TGA recall normalise error", extra={"error": str(exc)})

        self.log.info(
            "TGA recalls normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        name_raw = rec.get("product_name", "")
        if not name_raw:
            return None

        # Clean product name — take first line / first 100 chars
        name = re.split(r"[\n\r]", name_raw)[0].strip()
        # Remove batch/lot info from name
        name = re.sub(r"\b(Batch|Lot|batch|lot)\s*(Number|No|#)?:?\s*.*", "", name).strip()
        name = name[:100] if len(name) >= 3 else ""
        if not name:
            return None

        # Hazard class
        hc = rec.get("hazard_class", "").lower().strip()
        recall_class = self._CLASS_MAP.get(hc)

        # Action type → recall_type (DB enum: batch, market_withdrawal, or NULL)
        action_type = rec.get("action_type", "").lower()
        if "recall" in action_type:
            recall_type = "batch"
        elif "correction" in action_type or "alert" in action_type:
            recall_type = None  # not a recall per se
        else:
            recall_type = None

        # Date — format is D/MM/YYYY or DD/MM/YYYY
        date_raw = rec.get("action_date", "")
        announced_date = self._parse_date(date_raw)
        if not announced_date:
            announced_date = datetime.now(timezone.utc).date().isoformat()

        # Reason
        reason = rec.get("reason", "") or None
        reason_cat = self._map_reason(reason) if reason else "other"

        # Lot numbers — extract from product name
        lot_numbers = []
        lot_match = re.findall(r"(?:Batch|Lot)\s*(?:Number|No|#)?:?\s*([\w\-/]+)", name_raw)
        if lot_match:
            lot_numbers = [l.strip() for l in lot_match]

        # URL
        action_id = rec.get("action_id", "")
        press_url = self.DETAIL_URL.format(action_id=action_id)

        return {
            "generic_name":     name,
            "brand_name":       None,
            "manufacturer":     rec.get("sponsor") or None,
            "recall_class":     recall_class,
            "recall_type":      recall_type,
            "reason":           (reason[:500] if reason else None),
            "reason_category":  reason_cat,
            "lot_numbers":      lot_numbers,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 90,
            "recall_ref":       action_id,
            "raw_record":       rec,
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d %B %Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(raw.strip(), fmt).date().isoformat()
            except Exception:
                pass
        m = re.search(r"\d{4}-\d{2}-\d{2}", str(raw))
        return m.group(0) if m else None

    @staticmethod
    def _map_reason(raw: str) -> str:
        if not raw:
            return "other"
        lower = raw.lower()
        if any(w in lower for w in ["contamination", "contaminated", "impurity", "impurities"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling", "mislabel", "packaging text"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "subpotent", "dissolution", "strength", "assay"]):
            return "subpotency"
        if any(w in lower for w in ["packaging", "container", "seal", "closure", "leak"]):
            return "packaging"
        if any(w in lower for w in ["sterile", "sterility", "non-sterile"]):
            return "sterility"
        if any(w in lower for w in ["foreign", "particulate", "particles", "matter"]):
            return "foreign_matter"
        return "other"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — TGA Recalls (DRAC)"); print("=" * 60)
        scraper = TgaRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  raw records: {len(raw)}")
        recalls = scraper.normalize(raw)
        print(f"  normalised : {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = TgaRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
