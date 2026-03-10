"""
FDA Drug Recalls Scraper — Full Recall Database (all manufacturers, all classes)
─────────────────────────────────────────────────────────────────────────────────
Source:  U.S. Food and Drug Administration — Drug Enforcement Reports
         via OpenFDA public API (same endpoint as FDA Enforcement scraper)
API:     https://api.fda.gov/drug/enforcement.json

Differences from fda_enforcement_scraper.py:
  - Source ID: 10000000-0000-0000-0000-000000000025 (not 24)
  - Fetches ALL manufacturers (not foreign only)
  - Fetches ALL statuses and ALL classes (not just Ongoing Class I/II)
  - Writes to `recalls` table (not shortage_events)
  - Uses recall_number as recall_ref for deterministic dedup
"""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class FDARecallsScraper(BaseRecallScraper):
    """Full FDA drug recall database scraper — all manufacturers, all classes."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000025"
    SOURCE_NAME:  str = "FDA Drug Enforcement — Full Recall Database"
    BASE_URL:     str = "https://api.fda.gov"
    API_URL:      str = "https://api.fda.gov/drug/enforcement.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 0.5   # OpenFDA allows ~240 req/min
    PAGE_SIZE: int = 100

    _CLASS_MAP: dict[str, str] = {
        "Class I":   "I",
        "Class II":  "II",
        "Class III": "III",
    }

    _STATUS_MAP: dict[str, str] = {
        "Ongoing":    "active",
        "Terminated": "completed",
    }

    _REASON_MAP: dict[str, str] = {
        "contamination":        "contamination",
        "sterility":            "sterility",
        "sterile":              "sterility",
        "particulate":          "foreign_matter",
        "foreign":              "foreign_matter",
        "impurity":             "contamination",
        "potency":              "subpotency",
        "dissolution":          "subpotency",
        "labeling":             "mislabelling",
        "labelling":            "mislabelling",
        "mislabeled":           "mislabelling",
        "cgmp":                 "other",
        "gmp":                  "other",
        "packaging":            "packaging",
        "subpotent":            "subpotency",
        "superpotent":          "subpotency",
        "failed":               "other",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """Fetch all drug enforcement records (all statuses, all manufacturers)."""
        params = {
            "search": 'product_type:"Drugs"',
            "limit":  self.PAGE_SIZE,
            "skip":   0,
        }
        resp = self._get(self.API_URL, params=params)
        data = resp.json()
        meta  = data.get("meta", {}).get("results", {})
        total = meta.get("total", 0)
        pages = math.ceil(total / self.PAGE_SIZE)

        records = data.get("results", [])
        self.log.info("FDA Recalls page 1", extra={"total": total, "pages": pages})

        for page in range(1, pages):
            params["skip"] = page * self.PAGE_SIZE
            try:
                page_resp = self._get(self.API_URL, params=params)
                records.extend(page_resp.json().get("results", []))
                self.log.debug("FDA Recalls page N", extra={"page": page + 1, "fetched": len(records)})
            except Exception as exc:
                self.log.warning("FDA Recalls page error — stopping early", extra={"page": page + 1, "error": str(exc)})
                break

        self.log.info("FDA Recalls fetch complete", extra={"total": len(records)})
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info("Normalising FDA Recalls", extra={"raw_count": len(records)})

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
                self.log.warning("FDA Recalls normalise error", extra={"error": str(exc)})

        self.log.info(
            "FDA Recalls normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        # ── Generic name ──────────────────────────────────────────────────────
        openfda    = rec.get("openfda") or {}
        inn_list   = openfda.get("generic_name") or []
        brand_list = openfda.get("brand_name") or []

        generic_name = inn_list[0] if inn_list else self._extract_drug_name(
            rec.get("product_description", "")
        )
        if not generic_name:
            return None

        brand_name = brand_list[0] if brand_list else None

        # ── Recall class ──────────────────────────────────────────────────────
        classification = (rec.get("classification") or "").strip()
        recall_class = self._CLASS_MAP.get(classification)

        # ── Status ────────────────────────────────────────────────────────────
        fda_status = (rec.get("status") or "").strip()
        status = self._STATUS_MAP.get(fda_status, "active")

        # ── Dates ─────────────────────────────────────────────────────────────
        announced_date = self._parse_fda_date(rec.get("recall_initiation_date"))
        if not announced_date:
            announced_date = datetime.now(timezone.utc).date().isoformat()

        completion_date = self._parse_fda_date(rec.get("termination_date"))

        # ── Reason ────────────────────────────────────────────────────────────
        raw_reason = (rec.get("reason_for_recall") or "").strip()
        reason_cat = self._map_reason(raw_reason)

        # ── Meta ──────────────────────────────────────────────────────────────
        recall_no  = (rec.get("recall_number") or "").strip()
        firm       = (rec.get("recalling_firm") or "").strip()
        lot_nums   = [l.strip() for l in (rec.get("code_info") or "").split(",") if l.strip()]

        press_url = (
            f"https://www.accessdata.fda.gov/scripts/ires/?action=recall&recallNumber={recall_no}"
            if recall_no else self.BASE_URL
        )

        # ── Recall type (batch vs product_wide) ───────────────────────────────
        product_qty = (rec.get("product_quantity") or "").lower()
        recall_type = "batch" if lot_nums else ("product_wide" if "all" in product_qty else None)

        return {
            "generic_name":     generic_name,
            "brand_name":       brand_name,
            "manufacturer":     firm or None,
            "recall_class":     recall_class,
            "recall_type":      recall_type,
            "reason":           raw_reason or None,
            "reason_category":  reason_cat,
            "lot_numbers":      lot_nums,
            "announced_date":   announced_date,
            "completion_date":  completion_date,
            "status":           status,
            "press_release_url": press_url,
            "confidence_score": 95,
            "recall_ref":       recall_no or None,
            "raw_record": {
                "recall_number":  recall_no or None,
                "classification": classification,
                "recalling_firm": firm or None,
                "country":        rec.get("country"),
                "status":         fda_status,
            },
        }

    def _map_reason(self, raw: str) -> str | None:
        if not raw:
            return None
        lower = raw.lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return "other"

    @staticmethod
    def _extract_drug_name(product_desc: str) -> str:
        if not product_desc:
            return ""
        m = re.match(r'^([A-Za-z][A-Za-z\s\-]{2,40}?)(?:\s+\d|\s*,)', product_desc.strip())
        if m:
            return m.group(1).strip().title()
        return product_desc.split(",")[0].strip()[:60].title()

    @staticmethod
    def _parse_fda_date(raw: str | None) -> str | None:
        if not raw or len(str(raw).strip()) < 8:
            return None
        s = str(raw).strip()
        try:
            return datetime.strptime(s[:8], "%Y%m%d").date().isoformat()
        except ValueError:
            return None


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
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = FDARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records fetched  : {len(raw)}")

        recalls = scraper.normalize(raw)
        print(f"── Normalised recalls   : {len(recalls)}")

        if recalls:
            sample = {k: v for k, v in recalls[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            _sk = lambda x: (x[0] is None, x[0] or "")  # noqa: E731 — None-safe sort key

            print("\n── Class breakdown:")
            for k, v in sorted(Counter(r.get("recall_class") for r in recalls).items(), key=_sk):
                print(f"   {str(k):15s} {v}")

            print("\n── Status breakdown:")
            for k, v in sorted(Counter(r.get("status") for r in recalls).items(), key=_sk):
                print(f"   {str(k):15s} {v}")

            print("\n── Reason category breakdown:")
            for k, v in sorted(Counter(r.get("reason_category") for r in recalls).items(), key=_sk):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = FDARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
