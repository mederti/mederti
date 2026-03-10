"""
EMA — Withdrawn Medicines & Recalls Scraper
────────────────────────────────────────────
Source:  European Medicines Agency — Withdrawn Authorisations dataset
Dataset: https://www.ema.europa.eu/sites/default/files/Medicines_output_withdrawn_authorisations.xlsx

Also checks the EMA JSON download endpoint for referral/recall data.

Source UUID:  10000000-0000-0000-0000-000000000028
Country code: EU
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class EMARecallsScraper(BaseRecallScraper):
    """Scraper for EMA withdrawn authorisations and EU-level drug recalls."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000028"
    SOURCE_NAME:  str = "EMA — Withdrawn Medicines & Recalls"
    BASE_URL:     str = "https://www.ema.europa.eu/en/medicines/download-medicine-data"
    DATA_URL:     str = (
        "https://www.ema.europa.eu/sites/default/files/Medicines_output_withdrawn_authorisations.xlsx"
    )
    # JSON download for EPAR dataset (fallback)
    JSON_URL:     str = (
        "https://www.ema.europa.eu/sites/default/files/Medicines_output_european_public_assessment_reports.xlsx"
    )
    COUNTRY:      str = "European Union"
    COUNTRY_CODE: str = "EU"

    RATE_LIMIT_DELAY: float = 2.0

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """Download the EMA withdrawn authorisations Excel file."""
        self.log.info("Fetching EMA withdrawn authorisations", extra={"url": self.DATA_URL})

        try:
            resp = self._get(self.DATA_URL)
            self.log.info("EMA data fetched", extra={"bytes": len(resp.content)})
            return {"content": resp.content, "source": "xlsx", "url": self.DATA_URL}
        except Exception as exc:
            self.log.warning("EMA xlsx fetch failed", extra={"error": str(exc)})
            return {"content": None, "source": "none", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        if isinstance(raw, dict) and raw.get("source") == "xlsx" and raw.get("content"):
            return self._parse_xlsx(raw["content"])

        self.log.warning("EMA: no data to normalise", extra={"raw": str(raw)[:100]})
        return []

    def _parse_xlsx(self, content: bytes) -> list[dict]:
        try:
            import openpyxl
        except ImportError:
            self.log.error("openpyxl not installed — run: pip install openpyxl")
            return []

        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []

        # First row = headers
        headers = [str(h or "").strip().lower() for h in rows[0]]
        self.log.info("EMA Excel headers", extra={"headers": headers[:15]})

        normalised: list[dict] = []
        today = datetime.now(timezone.utc).date().isoformat()

        for row in rows[1:]:
            try:
                rec = dict(zip(headers, row))
                result = self._normalise_ema_record(rec, today)
                if result:
                    normalised.append(result)
            except Exception as exc:
                self.log.debug("EMA row error", extra={"error": str(exc)})

        self.log.info("EMA normalisation done", extra={"records": len(normalised)})
        wb.close()
        return normalised

    def _normalise_ema_record(self, rec: dict, today: str) -> dict | None:
        # Field names vary — try common alternatives
        name = (
            rec.get("medicine name") or rec.get("medicine_name") or
            rec.get("name") or rec.get("product name") or ""
        )
        if not name:
            return None
        name = str(name).strip()

        # Withdrawal date
        withdrawal_raw = (
            rec.get("withdrawal date") or rec.get("withdrawal_date") or
            rec.get("date of withdrawal") or rec.get("date") or ""
        )
        announced_date = self._parse_date(str(withdrawal_raw)) or today

        # Reason
        reason_raw = (
            rec.get("withdrawal reason") or rec.get("reason") or
            rec.get("comments") or ""
        )
        reason_str = str(reason_raw).strip() if reason_raw else None

        # Active substance = generic name
        active_substance = (
            rec.get("active substance") or rec.get("active_substance") or
            rec.get("inn") or name
        )

        # MAH = manufacturer
        mah = rec.get("marketing authorisation holder") or rec.get("mah") or None

        # Recall ref — use product number if available
        recall_ref = (
            str(rec.get("product number") or rec.get("eu product number") or
                rec.get("category") or name)[:80]
        )

        return {
            "generic_name":     str(active_substance).strip()[:100],
            "brand_name":       name if name != active_substance else None,
            "manufacturer":     str(mah).strip()[:200] if mah else None,
            "recall_class":     "Unclassified",
            "recall_type":      "market_withdrawal",
            "reason":           reason_str,
            "reason_category":  self._map_reason(reason_str or ""),
            "lot_numbers":      [],
            "announced_date":   announced_date,
            "status":           "completed",
            "press_release_url": self.BASE_URL,
            "confidence_score": 85,
            "recall_ref":       recall_ref,
            "raw_record":       {k: str(v)[:200] for k, v in rec.items() if v is not None},
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw or raw in ("None", "nan", ""):
            return None
        # Excel often returns datetime objects as strings "YYYY-MM-DD HH:MM:SS"
        m = re.search(r"\d{4}-\d{2}-\d{2}", raw)
        if m:
            return m.group(0)
        for fmt in ("%d/%m/%Y", "%d.%m.%Y", "%B %d, %Y"):
            try:
                return datetime.strptime(raw[:20], fmt).date().isoformat()
            except Exception:
                pass
        return None

    @staticmethod
    def _map_reason(raw: str) -> str | None:
        if not raw:
            return "other"
        lower = raw.lower()
        if any(w in lower for w in ["contamination", "contaminated"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "efficacy"]):
            return "subpotency"
        if "sterility" in lower:
            return "sterility"
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
        print("DRY RUN — EMA Recalls")
        print("=" * 60)
        scraper = EMARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Normalised recalls: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)

    scraper = EMARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
