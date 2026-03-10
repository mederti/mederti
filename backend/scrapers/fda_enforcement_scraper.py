"""
FDA Drug Enforcement — Foreign Manufacturer Supply-Side Signal Scraper
────────────────────────────────────────────────────────────────────────
Source:  U.S. Food and Drug Administration — Drug Enforcement Reports
         via OpenFDA public API
URL:     https://api.fda.gov/drug/enforcement.json

Data source (confirmed 2026-02-22):
    OpenFDA exposes a public, unauthenticated JSON API for drug enforcement
    (recall) events.  This scraper pulls ONGOING recalls from NON-US
    manufacturers/recalling firms as a supply-side risk signal.

    A foreign manufacturer recall indicates:
      - Class I (most serious): immediate health risk — HIGH supply signal
      - Class II (moderate):    potential health risk — MEDIUM supply signal
      - Class III (minor):      unlikely health risk — LOW signal (skipped)

    This is NOT a traditional shortage list; it is a leading indicator that
    a foreign facility has compliance/quality issues that may precede
    supply disruptions into downstream markets.

API endpoint:
    GET https://api.fda.gov/drug/enforcement.json
    Params:
      search=status:"Ongoing"     → only active recalls
      limit=100                   → page size (max 1000)
      skip=N                      → pagination offset

Response JSON:
    {
      "meta":    { "results": { "total": <int>, "skip": <int>, "limit": <int> } },
      "results": [ ... ]
    }

Per-record fields used:
    country                  → filter: exclude United States
    recalling_firm           → manufacturer / MAH (generic_name fallback)
    product_description      → drug name / generic_name source
    reason_for_recall        → reason text
    classification           → "Class I" / "Class II" / "Class III"
    status                   → "Ongoing" / "Terminated"
    recall_initiation_date   → YYYYMMDD string
    termination_date         → YYYYMMDD string (if status=Terminated)
    recall_number            → unique identifier
    openfda.generic_name     → INN if available
    openfda.brand_name       → brand name if available
    distribution_pattern     → affected regions

Data source UUID:  10000000-0000-0000-0000-000000000024  (FDA-FE, US)
Country:           United States
Country code:      US
Signal type:       supply_signal (not a direct shortage list)
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone

from backend.scrapers.base_scraper import BaseScraper


class FDAEnforcementScraper(BaseScraper):
    """
    Supply-side signal scraper: FDA drug enforcement reports from foreign
    manufacturers.  Class I/II ongoing recalls from non-US firms are flagged
    as supply-chain risk signals.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000024"
    SOURCE_NAME:  str = "FDA Drug Enforcement — Foreign Manufacturer Recalls"
    BASE_URL:     str = "https://api.fda.gov"
    API_URL:      str = "https://api.fda.gov/drug/enforcement.json"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 0.5   # OpenFDA rate-limits to ~240 req/min

    PAGE_SIZE: int = 100   # Conservative; max 1000 but 100 keeps under rate limit

    # Class I/II = significant signal; skip Class III (minor, unlikely health risk)
    INCLUDE_CLASSES: set[str] = {"Class I", "Class II"}

    _REASON_MAP: dict[str, str] = {
        "contamination":        "manufacturing_issue",
        "sterility":            "manufacturing_issue",
        "sterile":              "manufacturing_issue",
        "particulate":          "manufacturing_issue",
        "impurity":             "manufacturing_issue",
        "potency":              "manufacturing_issue",
        "dissolution":          "manufacturing_issue",
        "labeling":             "regulatory_action",
        "labelling":            "regulatory_action",
        "mislabeled":           "regulatory_action",
        "cgmp":                 "manufacturing_issue",
        "gmp":                  "manufacturing_issue",
        "raw material":         "raw_material",
        "active ingredient":    "raw_material",
        "out of specification": "manufacturing_issue",
        "subpotent":            "manufacturing_issue",
        "superpotent":          "manufacturing_issue",
        "failed":               "manufacturing_issue",
        "counterfeit":          "regulatory_action",
        "unapproved":           "regulatory_action",
        "packaging":            "manufacturing_issue",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch all ONGOING drug enforcement records for non-US manufacturers.
        Paginates through the full OpenFDA enforcement dataset.
        """
        # First page: determine total
        params = {
            "search": 'status:"Ongoing" AND product_type:"Drugs"',
            "limit":  self.PAGE_SIZE,
            "skip":   0,
        }
        resp  = self._get(self.API_URL, params=params)
        data  = resp.json()
        meta  = data.get("meta", {}).get("results", {})
        total = meta.get("total", 0)
        pages = math.ceil(total / self.PAGE_SIZE)

        records = data.get("results", [])
        self.log.info(
            "FDA Enforcement page 1",
            extra={"total": total, "pages": pages, "fetched": len(records)},
        )

        for page in range(1, pages):
            params["skip"] = page * self.PAGE_SIZE
            resp = self._get(self.API_URL, params=params)
            page_results = resp.json().get("results", [])
            records.extend(page_results)
            self.log.debug(
                "FDA Enforcement page N",
                extra={"page": page + 1, "skip": params["skip"],
                       "fetched": len(page_results)},
            )

        # Filter to foreign manufacturers only
        foreign = [r for r in records if r.get("country", "").strip().upper() != "UNITED STATES"]
        self.log.info(
            "FDA Enforcement fetch complete",
            extra={"total_ongoing": len(records), "foreign": len(foreign)},
        )
        return foreign

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising FDA Enforcement records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(records)},
        )

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
                self.log.warning(
                    "Failed to normalise FDA Enforcement record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised),
                   "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        classification = (rec.get("classification") or "").strip()

        # Skip Class III (minor, not a meaningful supply signal)
        if classification not in self.INCLUDE_CLASSES:
            return None

        # ── Generic name ──────────────────────────────────────────────────────
        openfda    = rec.get("openfda") or {}
        inn_list   = openfda.get("generic_name") or []
        brand_list = openfda.get("brand_name") or []

        generic_name = inn_list[0] if inn_list else self._extract_drug_name(
            rec.get("product_description", "")
        )
        if not generic_name:
            return None

        brand_names = [b for b in brand_list if b.lower() != generic_name.lower()]

        # ── Status ────────────────────────────────────────────────────────────
        # This scraper only fetches Ongoing records; status = "active"
        status = "active"
        severity = "critical" if classification == "Class I" else "high"

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_fda_date(rec.get("recall_initiation_date"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()
        end_date = None

        # ── Reason ────────────────────────────────────────────────────────────
        raw_reason  = (rec.get("reason_for_recall") or "").strip()
        reason_cat  = self._map_reason(raw_reason)

        # ── Manufacturer / country ────────────────────────────────────────────
        firm    = (rec.get("recalling_firm") or "").strip()
        country = (rec.get("country") or "").strip()
        dist    = (rec.get("distribution_pattern") or "").strip()
        recall_no = (rec.get("recall_number") or "").strip()

        # ── Source URL ────────────────────────────────────────────────────────
        source_url = f"https://www.accessdata.fda.gov/scripts/ires/?action=recall&recallNumber={recall_no}" if recall_no else "https://www.accessdata.fda.gov/scripts/ires/"

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts = [f"[SUPPLY-SIDE SIGNAL] FDA {classification} Recall"]
        if firm:    notes_parts.append(f"Firm: {firm}")
        if country: notes_parts.append(f"Country: {country}")
        if dist:    notes_parts.append(f"Distribution: {dist[:100]}")
        if raw_reason: notes_parts.append(f"Reason: {raw_reason[:200]}")
        notes = "\n".join(notes_parts)

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    raw_reason or None,
            "reason_category":           reason_cat,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": None,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "recall_number":   recall_no or None,
                "classification":  classification,
                "recalling_firm":  firm or None,
                "country":         country or None,
                "status":          rec.get("status"),
            },
        }

    def _map_reason(self, raw: str) -> str:
        if not raw:
            return "manufacturing_issue"  # default for recalls
        lower = raw.lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return "manufacturing_issue"

    @staticmethod
    def _extract_drug_name(product_desc: str) -> str:
        """Extract the drug name from a product description string."""
        if not product_desc:
            return ""
        # Take the first meaningful segment (before first comma or dosage info)
        m = re.match(r'^([A-Za-z][A-Za-z\s\-]{2,40}?)(?:\s+\d|\s*,)', product_desc.strip())
        if m:
            return m.group(1).strip().title()
        return product_desc.split(",")[0].strip()[:60].title()

    @staticmethod
    def _parse_fda_date(raw: str | None) -> str | None:
        """Parse FDA YYYYMMDD date strings → ISO-8601."""
        if not raw or len(str(raw).strip()) < 8:
            return None
        s = str(raw).strip()
        try:
            dt = datetime.strptime(s[:8], "%Y%m%d")
            return dt.date().isoformat()
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
        from collections import Counter

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = FDAEnforcementScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw foreign records fetched : {len(raw)}")

        events = scraper.normalize(raw)
        print(f"── Normalised events           : {len(events)}")

        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            print("\n── Severity breakdown:")
            for k, v in sorted(Counter(e.get("severity") for e in events).items()):
                print(f"   {str(k):12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(Counter(e.get("reason_category") for e in events).items()):
                print(f"   {str(k):30s} {v}")
            print("\n── Top 10 countries:")
            countries = Counter(e["raw_record"]["country"] for e in events)
            for country, count in countries.most_common(10):
                print(f"   {str(country):30s} {count}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = FDAEnforcementScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
