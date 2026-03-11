"""
ASHP Drug Shortages Database Scraper (US Supplement)
─────────────────────────────────────────────────────
Source:  ASHP / University of Utah Drug Information Service
URL:     https://www.ashp.org/drug-shortages/current-shortages/drug-shortages-list

COPYRIGHT NOTICE:
    Drug Shortage Bulletins are copyrighted by the Drug Information Service
    of the University of Utah and provided by ASHP as its exclusive
    authorized distributor. This scraper stores ONLY structured metadata
    fields (drug names, status, alternative drug names) and does NOT
    reproduce bulletin text verbatim.

    Usage requires a valid license from ASHP.
    Contact: softwaresupport@ashp.org

This scraper supplements (not replaces) the existing FDA shortage scraper.
It provides richer clinical detail: recommended alternatives, estimated
resupply dates, and available product lists.

Data source UUID:  10000000-0000-0000-0000-000000000042
Country:           United States
Country code:      US
Confidence:        95/100 (ASHP is the gold standard for US shortage data)

Cron:  Every 12 hours (disabled by default — uncomment when ASHP_API_KEY is set)
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class ASHPScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000044"
    SOURCE_NAME: str  = "ASHP Drug Shortages Database (US Supplement)"
    BASE_URL: str     = "https://www.ashp.org/drug-shortages/current-shortages/drug-shortages-list"
    COUNTRY: str      = "United States"
    COUNTRY_CODE: str = "US"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT: float  = 30.0
    SCRAPER_VERSION: str    = "1.0.0"

    # ASHP status → internal status
    _STATUS_MAP: dict[str, str] = {
        "active":        "active",
        "current":       "active",
        "ongoing":       "active",
        "resolved":      "resolved",
        "no longer a shortage": "resolved",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch ASHP shortage data via their licensed API.

        Requires ASHP_API_KEY and ASHP_API_BASE_URL environment variables.
        Raises ScraperError if credentials are missing.
        """
        api_key = os.environ.get("ASHP_API_KEY", "").strip()
        api_base = os.environ.get("ASHP_API_BASE_URL", "").strip()

        if not api_key:
            raise ScraperError(
                "ASHP_API_KEY not set. The ASHP Drug Shortages Database requires "
                "a paid license key. Contact softwaresupport@ashp.org to obtain one."
            )

        if not api_base:
            raise ScraperError(
                "ASHP_API_BASE_URL not set. Set this to the Firebase REST API base "
                "URL provided in your ASHP license documentation."
            )

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": api_base,
        })

        # Firebase REST API — fetch all shortage records
        url = f"{api_base.rstrip('/')}/drugShortages.json"
        resp = self._get_json(url, params={"auth": api_key})

        # Firebase returns either a list (with null gaps) or a dict keyed by ID
        if isinstance(resp, list):
            records = [r for r in resp if r is not None]
        elif isinstance(resp, dict):
            records = [v for v in resp.values() if v is not None and isinstance(v, dict)]
        else:
            self.log.warning("Unexpected ASHP API response type", extra={"type": type(resp).__name__})
            records = []

        self.log.info("ASHP API fetch complete", extra={"records": len(records)})
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ASHP records into standard shortage event dicts."""
        self.log.info(
            "Normalising ASHP records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise ASHP record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        """Convert a single ASHP record to a normalised shortage event dict."""
        # ── Drug name ────────────────────────────────────────────────────────
        generic_name = (
            rec.get("genericName")
            or rec.get("generic_name")
            or rec.get("name")
            or rec.get("drugName")
            or ""
        ).strip()

        if not generic_name:
            return None

        # ── Status ───────────────────────────────────────────────────────────
        raw_status = (rec.get("status") or rec.get("shortageStatus") or "active").strip().lower()
        status = self._STATUS_MAP.get(raw_status, "active")

        # ── Dates ────────────────────────────────────────────────────────────
        start_date = self._parse_ashp_date(
            rec.get("dateCreated") or rec.get("created") or rec.get("dateAdded")
        )
        if not start_date:
            start_date = date.today().isoformat()

        updated_date = self._parse_ashp_date(
            rec.get("dateUpdated") or rec.get("lastUpdated") or rec.get("dateModified")
        )

        end_date = None
        if status == "resolved":
            end_date = updated_date or date.today().isoformat()

        # ── Estimated resupply ───────────────────────────────────────────────
        estimated_resolution = self._parse_ashp_date(
            rec.get("estimatedResupplyDate") or rec.get("resupplyDate")
        )

        # ── Reason ───────────────────────────────────────────────────────────
        raw_reason = (rec.get("reason") or rec.get("shortageReason") or "").strip()
        reason_category = map_reason_category(raw_reason) if raw_reason else "unknown"

        # ── Severity: use ASHP severity if available, default high ───────────
        raw_severity = (rec.get("severity") or rec.get("impact") or "").strip().lower()
        if "critical" in raw_severity:
            severity = "critical"
        elif "high" in raw_severity or "significant" in raw_severity:
            severity = "high"
        elif "low" in raw_severity or "minimal" in raw_severity:
            severity = "low"
        else:
            severity = "high" if status == "active" else "low"

        # ── Available alternatives (structured only, NO full text) ───────────
        alternatives = self._extract_alternatives(rec)

        # ── Notes (metadata only, NOT copyrighted bulletin text) ─────────────
        notes_parts: list[str] = []
        if updated_date:
            notes_parts.append(f"Last updated: {updated_date}")
        if rec.get("safetyAlert"):
            notes_parts.append("Safety alert active")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name,
            "status":                    status,
            "severity":                  severity,
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution,
            "source_url":                self.BASE_URL,
            "notes":                     notes,
            "source_confidence_score":   95,
            "available_alternatives":    alternatives,
            "raw_record":                self._sanitise_raw_record(rec),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_alternatives(rec: dict) -> list[dict] | None:
        """
        Extract structured alternative drug information.

        Returns a list of dicts: [{"generic_name": "...", "ndc": "...", "notes": "..."}]

        COPYRIGHT COMPLIANCE: We extract only structured fields (drug names,
        NDC codes). We do NOT store full recommendation text.
        """
        alternatives: list[dict] = []

        # availableProducts field (list of products still in supply)
        for prod in rec.get("availableProducts", []):
            if not isinstance(prod, dict):
                continue
            name = prod.get("genericName") or prod.get("name") or ""
            ndc = prod.get("NDC") or prod.get("ndc") or ""
            if name or ndc:
                alt = {}
                if name:
                    alt["generic_name"] = str(name).strip()
                if ndc:
                    alt["ndc"] = str(ndc).strip()
                # Only include "discontinued" flag, not text descriptions
                if prod.get("discontinued"):
                    alt["discontinued"] = True
                alternatives.append(alt)

        # alternativeAgents field (therapeutic alternatives)
        for agent in rec.get("alternativeAgents", []):
            if isinstance(agent, str):
                alternatives.append({"generic_name": agent.strip()})
            elif isinstance(agent, dict):
                name = agent.get("genericName") or agent.get("name") or ""
                if name:
                    alternatives.append({"generic_name": str(name).strip(), "type": "alternative"})

        return alternatives if alternatives else None

    @staticmethod
    def _sanitise_raw_record(rec: dict) -> dict:
        """
        Remove copyrighted text fields from the raw record before storage.

        COPYRIGHT COMPLIANCE: We strip fields that contain bulletin text
        (clinical recommendations, detailed descriptions) to avoid storing
        copyrighted University of Utah content.
        """
        # Fields to exclude from raw_data storage (copyrighted text)
        _TEXT_FIELDS = {
            "bulletinText", "bulletin_text", "clinicalRecommendations",
            "clinical_recommendations", "description", "fullText",
            "fullDescription", "recommendation", "recommendations",
        }
        return {k: v for k, v in rec.items() if k not in _TEXT_FIELDS}

    @staticmethod
    def _parse_ashp_date(raw: Any) -> str | None:
        """Parse various ASHP date formats to ISO-8601."""
        if not raw:
            return None
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None

        # Handle Unix timestamps (milliseconds)
        if raw_str.isdigit() and len(raw_str) >= 10:
            try:
                ts = int(raw_str)
                if ts > 1e12:  # milliseconds
                    ts = ts / 1000
                return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
            except (ValueError, OSError):
                pass

        # Handle ISO-8601 and common date formats
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass

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
        print("Fetches live ASHP data but makes NO database writes.")
        print("Requires: ASHP_API_KEY and ASHP_API_BASE_URL env vars.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = ASHPScraper(db_client=MagicMock())

        print("\n── Fetching from ASHP API …")
        try:
            raw = scraper.fetch()
            print(f"── Raw records received : {len(raw)}")

            print("── Normalising records …")
            events = scraper.normalize(raw)
            print(f"── Normalised events    : {len(events)}")

            if events:
                print("\n── Sample event (first record, raw_record omitted):")
                sample = {k: v for k, v in events[0].items() if k != "raw_record"}
                print(json.dumps(sample, indent=2, default=str))

                from collections import Counter

                status_counts   = Counter(e["status"] for e in events)
                severity_counts = Counter(e.get("severity") for e in events)
                reason_counts   = Counter(e.get("reason_category") for e in events)
                alt_counts      = sum(1 for e in events if e.get("available_alternatives"))

                print("\n── Status breakdown:")
                for k, v in sorted(status_counts.items()):
                    print(f"   {k:25s} {v}")
                print("\n── Severity breakdown:")
                for k, v in sorted(severity_counts.items()):
                    print(f"   {str(k):12s} {v}")
                print("\n── Reason category breakdown:")
                for k, v in sorted(reason_counts.items()):
                    print(f"   {str(k):30s} {v}")
                print(f"\n── Records with alternatives: {alt_counts}/{len(events)}")

        except ScraperError as e:
            print(f"\n!! ScraperError: {e}")
            print("   → Set ASHP_API_KEY and ASHP_API_BASE_URL to test this scraper.")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # ── Live run ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)

    scraper = ASHPScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
