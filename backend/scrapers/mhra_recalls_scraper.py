"""
MHRA — Drug Alerts & Recalls Scraper (UK)
──────────────────────────────────────────
Source:  GOV.UK Drug & Device Alerts — Atom/RSS feed
Feed:    https://www.gov.uk/drug-device-alerts.atom

Each Atom entry represents a recall notice / safety alert.
Class is inferred from entry title: "Class 1 Medicines Recall" → I.

Source UUID:  10000000-0000-0000-0000-000000000029
Country code: GB
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class MHRARecallsScraper(BaseRecallScraper):
    """Scraper for MHRA Drug/Device Alerts from GOV.UK Atom feed."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000029"
    SOURCE_NAME:  str = "MHRA — Drug Alerts & Recalls (UK)"
    BASE_URL:     str = "https://www.gov.uk/drug-device-alerts"
    RSS_URL:      str = "https://www.gov.uk/drug-device-alerts.atom"
    COUNTRY:      str = "United Kingdom"
    COUNTRY_CODE: str = "GB"

    RATE_LIMIT_DELAY: float = 1.5

    # Atom namespace
    _ATOM_NS = "http://www.w3.org/2005/Atom"

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """Fetch the GOV.UK Drug & Device Alerts Atom feed."""
        self.log.info("Fetching MHRA Atom feed", extra={"url": self.RSS_URL})
        try:
            resp = self._get(
                self.RSS_URL,
                headers={"Accept": "application/atom+xml, application/xml, text/xml"},
            )
            return {"xml": resp.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except Exception as exc:
            self.log.error("MHRA feed fetch failed", extra={"error": str(exc)})
            return {"xml": "", "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        xml_text = raw.get("xml", "") if isinstance(raw, dict) else ""
        if not xml_text:
            self.log.warning("MHRA: empty feed")
            return []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            self.log.error("MHRA: XML parse error", extra={"error": str(exc)})
            return []

        ns = {"atom": self._ATOM_NS}
        entries = root.findall("atom:entry", ns)
        self.log.info("MHRA feed entries", extra={"count": len(entries)})

        normalised: list[dict] = []
        today = datetime.now(timezone.utc).date().isoformat()

        for entry in entries:
            try:
                result = self._normalise_entry(entry, ns, today)
                if result:
                    normalised.append(result)
            except Exception as exc:
                self.log.debug("MHRA entry error", extra={"error": str(exc)})

        self.log.info("MHRA normalisation done", extra={"records": len(normalised)})
        return normalised

    def _normalise_entry(self, entry: ET.Element, ns: dict, today: str) -> dict | None:
        title_el = entry.find("atom:title", ns)
        title = (title_el.text or "").strip() if title_el is not None else ""

        if not title:
            return None

        # Filter to medicines only (not devices, in vitro diagnostics, etc.)
        title_lower = title.lower()
        is_medicine = any(w in title_lower for w in [
            "medicine", "drug", "tablet", "capsule", "injection", "infusion",
            "oral", "cream", "ointment", "syrup", "solution", "inhaler",
        ])
        # Also include "Class 1/2/3 Medicines Recall" explicitly
        is_recall = "recall" in title_lower or "alert" in title_lower
        if not (is_medicine or is_recall):
            return None

        # ── Recall class ──────────────────────────────────────────────────────
        recall_class = self._extract_class(title)

        # ── Drug name ─────────────────────────────────────────────────────────
        generic_name = self._extract_drug_name(title)
        if not generic_name:
            return None

        # ── Published date ────────────────────────────────────────────────────
        updated_el = entry.find("atom:updated", ns) or entry.find("atom:published", ns)
        date_raw = (updated_el.text or "") if updated_el is not None else ""
        announced_date = self._parse_iso(date_raw) or today

        # ── Link ──────────────────────────────────────────────────────────────
        link_el = entry.find("atom:link", ns)
        press_url = link_el.get("href", self.BASE_URL) if link_el is not None else self.BASE_URL

        # ── Summary ───────────────────────────────────────────────────────────
        summary_el = entry.find("atom:summary", ns) or entry.find("atom:content", ns)
        summary_text = (summary_el.text or "") if summary_el is not None else ""
        # Strip HTML tags from summary
        summary_text = re.sub(r"<[^>]+>", " ", summary_text).strip()[:500]

        # ── Lot numbers from summary ───────────────────────────────────────────
        lot_numbers = re.findall(r"\b(?:lot|batch|b/n)[:\s]+([A-Z0-9\-/]+)", summary_text, re.IGNORECASE)

        # ── Recall ref = entry id ─────────────────────────────────────────────
        id_el = entry.find("atom:id", ns)
        recall_ref = (id_el.text or press_url).strip()

        return {
            "generic_name":     generic_name,
            "brand_name":       None,
            "manufacturer":     None,
            "recall_class":     recall_class,
            "recall_type":      "batch" if lot_numbers else None,
            "reason":           summary_text or None,
            "reason_category":  self._map_reason(summary_text),
            "lot_numbers":      lot_numbers[:20],
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 90,
            "recall_ref":       recall_ref,
            "raw_record":       {"title": title, "summary": summary_text[:200]},
        }

    @staticmethod
    def _extract_class(title: str) -> str | None:
        m = re.search(r"class\s*([123I]+)", title, re.IGNORECASE)
        if not m:
            return None
        raw = m.group(1).upper()
        return {"1": "I", "2": "II", "3": "III", "I": "I", "II": "II", "III": "III"}.get(raw)

    @staticmethod
    def _extract_drug_name(title: str) -> str:
        """
        Extract drug name from title like:
          "Class 1 Medicines Recall: Amoxicillin 500mg capsules"
          "Drug Alert (Class 2): Metformin tablets"
        """
        # After colon
        if ":" in title:
            name = title.split(":", 1)[1].strip()
        elif "–" in title:
            name = title.split("–", 1)[1].strip()
        elif "—" in title:
            name = title.split("—", 1)[1].strip()
        else:
            name = title

        # Strip strength/dosage to get INN
        name = re.split(r"\s+\d", name)[0].strip()
        # Remove trailing ' capsules', ' tablets', etc.
        name = re.sub(r"\s+(capsules?|tablets?|solution|injection|cream|ointment|syrup|inhaler).*",
                      "", name, flags=re.IGNORECASE).strip()
        return name[:80] if len(name) >= 3 else ""

    @staticmethod
    def _parse_iso(raw: str) -> str | None:
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
        except Exception:
            m = re.search(r"\d{4}-\d{2}-\d{2}", raw)
            return m.group(0) if m else None

    @staticmethod
    def _map_reason(text: str) -> str | None:
        if not text:
            return "other"
        lower = text.lower()
        if any(w in lower for w in ["contamination", "contaminated", "impurity"]):
            return "contamination"
        if any(w in lower for w in ["label", "labelling", "mislabel"]):
            return "mislabelling"
        if any(w in lower for w in ["potency", "dissolution", "strength"]):
            return "subpotency"
        if any(w in lower for w in ["sterile", "sterility"]):
            return "sterility"
        if any(w in lower for w in ["packaging", "container", "seal"]):
            return "packaging"
        if any(w in lower for w in ["foreign", "particulate"]):
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
        print("DRY RUN — MHRA Recalls")
        print("=" * 60)
        scraper = MHRARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        recalls = scraper.normalize(raw)
        print(f"── Normalised recalls: {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)

    scraper = MHRARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
