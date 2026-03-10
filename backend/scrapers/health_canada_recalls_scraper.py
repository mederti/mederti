"""
Health Canada — Recalls and Safety Alerts Scraper
──────────────────────────────────────────────────
Source:  Health Canada — Recalls and Safety Alerts open data
API:     https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json

The JSON feed contains all recall/safety categories (Food, Drug, Medical Device, etc.).
This scraper filters to Drug/Health Product recalls only.

Source UUID:  10000000-0000-0000-0000-000000000026
Country code: CA
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class HealthCanadaRecallsScraper(BaseRecallScraper):
    """Scraper for Health Canada Recalls and Safety Alerts (Drug subset)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000026"
    SOURCE_NAME:  str = "Health Canada — Recalls and Safety Alerts"
    BASE_URL:     str = "https://recalls-rappels.canada.ca/en/search/site"
    JSON_URL:     str = (
        "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/"
        "HCRSAMOpenData.json"
    )
    COUNTRY:      str = "Canada"
    COUNTRY_CODE: str = "CA"

    RATE_LIMIT_DELAY: float = 1.0

    # Health Canada category codes / keywords identifying drug products
    _DRUG_CATEGORIES: frozenset[str] = frozenset([
        "health product", "health products", "drug", "drugs", "medication",
        "pharmaceutical", "biologic", "biologics", "natural health",
    ])

    _CLASS_MAP: dict[str, str] = {
        "class 1": "I",
        "class i":  "I",
        "class 2": "II",
        "class ii": "II",
        "class 3": "III",
        "class iii": "III",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        self.log.info("Fetching Health Canada recalls JSON", extra={"url": self.JSON_URL})
        try:
            data = self._get_json(self.JSON_URL)
            records = data if isinstance(data, list) else []
            self.log.info("Health Canada recalls fetched", extra={"total": len(records)})
            return records
        except Exception as exc:
            self.log.warning(
                "Health Canada JSON fetch failed — trying HTML fallback",
                extra={"error": str(exc)},
            )
            return []

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info("Normalising Health Canada recalls", extra={"raw_count": len(records)})

        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning("HC recall normalise error", extra={"error": str(exc)})

        self.log.info(
            "Health Canada recalls normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        # Filter to drug/health product category
        category = (
            rec.get("product_categorycd") or
            rec.get("product_category") or
            rec.get("category") or ""
        ).lower()

        title = (rec.get("title") or rec.get("recall_title") or "").lower()

        is_drug = any(kw in category for kw in self._DRUG_CATEGORIES) or \
                  any(kw in title for kw in ["drug", "medication", "pharmaceutical", "health product"])

        if not is_drug:
            return None

        # ── Generic name ──────────────────────────────────────────────────────
        # HC uses "title" as the product name field
        name_raw = rec.get("title") or rec.get("product_name") or rec.get("name") or ""
        generic_name = self._clean_name(name_raw)
        if not generic_name:
            return None

        # ── Recall class ──────────────────────────────────────────────────────
        class_raw = (rec.get("recall_class") or rec.get("class") or "").lower()
        recall_class = self._CLASS_MAP.get(class_raw)

        # ── Dates ─────────────────────────────────────────────────────────────
        date_raw = rec.get("date_published") or rec.get("date") or rec.get("recall_date") or ""
        announced_date = self._parse_date(date_raw)
        if not announced_date:
            announced_date = datetime.now(timezone.utc).date().isoformat()

        # ── Reason ────────────────────────────────────────────────────────────
        reason_raw = rec.get("reason") or rec.get("recall_reason") or ""
        reason_cat = self._map_reason(reason_raw)

        # ── Lot numbers ───────────────────────────────────────────────────────
        lot_raw = rec.get("lot_numbers") or rec.get("lots") or ""
        lot_numbers = [l.strip() for l in str(lot_raw).split(",") if l.strip()] if lot_raw else []

        # ── Press release URL ─────────────────────────────────────────────────
        url_slug = rec.get("url") or rec.get("recall_url") or ""
        press_url = (
            f"https://recalls-rappels.canada.ca{url_slug}"
            if url_slug and url_slug.startswith("/") else
            (url_slug or self.BASE_URL)
        )

        # ── Recall ref (for dedup) ────────────────────────────────────────────
        recall_ref = str(rec.get("recall_id") or rec.get("id") or press_url)

        return {
            "generic_name":     generic_name,
            "brand_name":       rec.get("brand_name") or None,
            "manufacturer":     rec.get("company") or rec.get("manufacturer") or None,
            "recall_class":     recall_class,
            "recall_type":      "batch" if lot_numbers else None,
            "reason":           reason_raw or None,
            "reason_category":  reason_cat,
            "lot_numbers":      lot_numbers,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 90,
            "recall_ref":       recall_ref,
            "raw_record":       rec,
        }

    @staticmethod
    def _clean_name(raw: str) -> str:
        """Extract a usable drug name from HC title field."""
        if not raw:
            return ""
        # Remove dosage info after first comma or em-dash
        name = re.split(r"[,\-–—]", raw)[0].strip()
        # Remove batch/lot info
        name = re.sub(r"\b(lot|batch|recall|class)\b.*", "", name, flags=re.IGNORECASE).strip()
        return name[:100] if len(name) >= 3 else ""

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%B %d, %Y", "%d %B %Y"):
            try:
                return datetime.strptime(str(raw)[:len(fmt)], fmt).date().isoformat()
            except Exception:
                pass
        # Try ISO substring
        m = re.search(r"\d{4}-\d{2}-\d{2}", str(raw))
        if m:
            return m.group(0)
        return None

    @staticmethod
    def _map_reason(raw: str) -> str | None:
        if not raw:
            return None
        lower = raw.lower()
        if any(w in lower for w in ["contamination", "contaminated", "impurity"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling", "mislabel", "packaging text"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "subpotent", "dissolution", "strength"]):
            return "subpotency"
        if any(w in lower for w in ["packaging", "container", "seal", "closure"]):
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
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN — Health Canada Recalls")
        print("=" * 60)
        scraper = HealthCanadaRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records: {len(raw)}")
        recalls = scraper.normalize(raw)
        print(f"── Normalised : {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)

    scraper = HealthCanadaRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
