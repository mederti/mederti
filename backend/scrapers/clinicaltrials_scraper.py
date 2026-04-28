"""
ClinicalTrials.gov Phase III Scraper
─────────────────────────────────────
Source:  ClinicalTrials.gov v2 REST API
URL:     https://clinicaltrials.gov/api/v2/studies

ClinicalTrials.gov is the global registry of clinical trials. Phase III trials
are the final pre-approval stage — completion of a Phase III trial typically
means a regulatory submission within 6-12 months and approval within 12-18
months. This is the strongest medium-term foresight signal for new drug
entries to the market.

We pull Phase 3 trials matching drugs in our catalogue and store them for
foresight on future generic competition, brand launches, and supply pressure.

API docs: https://clinicaltrials.gov/data-api/api

Strategy:
  1. Iterate through drugs in our catalogue (chunked).
  2. For each batch, query the Studies endpoint with intervention name match.
  3. Filter to Phase 3 + active/completed.
  4. Upsert into clinical_trials table.

Cadence: weekly cron is fine — trial state changes slowly.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class ClinicalTrialsScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000081"
    SOURCE_NAME:  str = "ClinicalTrials.gov — Phase III Trials"
    BASE_URL:     str = "https://clinicaltrials.gov/api/v2/studies"
    COUNTRY:      str = "Global"
    COUNTRY_CODE: str = "ZZ"  # special: global, not country-bound

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    # We chunk through drugs in the catalogue; for each, query the API by intervention name.
    DRUGS_PER_BATCH: int = 50
    MAX_TOTAL_TRIALS: int = 5000  # safety cap per run

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "application/json",
    }

    def fetch(self) -> list[dict]:
        """
        For each drug in our catalogue, query Phase III trials by intervention name.
        Returns a flat list of trial JSON objects with our internal `_drug_id` injected.
        """
        all_trials: list[dict] = []
        seen_nct_ids: set[str] = set()

        # Get the top N drugs from the catalogue (chunked, paginated).
        # We focus on drugs that have shortage history (they matter most).
        offset = 0
        limit = self.DRUGS_PER_BATCH
        total_processed = 0

        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT) as client:
            while True:
                drugs_resp = (
                    self.db.table("drugs")
                    .select("id, generic_name")
                    .order("created_at", desc=False)
                    .range(offset, offset + limit - 1)
                    .execute()
                )
                drugs = drugs_resp.data or []
                if not drugs:
                    break

                for drug in drugs:
                    drug_id = drug["id"]
                    name = (drug.get("generic_name") or "").strip()
                    if not name or len(name) < 4:
                        continue

                    try:
                        trials = self._query_for_drug(client, name)
                        for t in trials:
                            nct = t.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
                            if not nct or nct in seen_nct_ids:
                                continue
                            seen_nct_ids.add(nct)
                            t["_drug_id"] = drug_id
                            all_trials.append(t)

                            if len(all_trials) >= self.MAX_TOTAL_TRIALS:
                                self.log.info("Hit MAX_TOTAL_TRIALS cap", extra={"count": len(all_trials)})
                                return all_trials
                    except Exception as exc:
                        self.log.warning(
                            "ClinicalTrials.gov query failed",
                            extra={"drug": name, "error": str(exc)},
                        )

                    total_processed += 1

                offset += limit
                self.log.info("ClinicalTrials.gov progress", extra={"drugs_processed": total_processed, "trials_found": len(all_trials)})

                if len(drugs) < limit:
                    break

        self.log.info("ClinicalTrials.gov fetch complete", extra={"total_trials": len(all_trials)})
        return all_trials

    def _query_for_drug(self, client: httpx.Client, drug_name: str) -> list[dict]:
        """Hit the Studies API for one drug name, Phase 3 only, last 5 years."""
        params = {
            "query.intr": f'"{drug_name}"',
            "filter.overallStatus": "RECRUITING|ACTIVE_NOT_RECRUITING|COMPLETED|UNKNOWN",
            "filter.advanced": "AREA[Phase]PHASE3 OR AREA[Phase]PHASE4",
            "pageSize": 50,
            "format": "json",
        }
        try:
            resp = client.get(self.BASE_URL, params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()
            return data.get("studies", []) or []
        except Exception:
            return []

    def normalize(self, raw: list[dict]) -> list[dict]:
        normalised: list[dict] = []
        for t in raw:
            try:
                rec = self._normalise_trial(t)
                if rec:
                    normalised.append(rec)
            except Exception as exc:
                self.log.warning("Failed to normalise trial", extra={"error": str(exc)})
        self.log.info("Normalised trials", extra={"count": len(normalised)})
        return normalised

    def _normalise_trial(self, t: dict) -> dict | None:
        protocol = t.get("protocolSection", {}) or {}
        ident   = protocol.get("identificationModule", {}) or {}
        status  = protocol.get("statusModule", {}) or {}
        design  = protocol.get("designModule", {}) or {}
        intr    = protocol.get("armsInterventionsModule", {}) or {}
        spons   = protocol.get("sponsorCollaboratorsModule", {}) or {}
        cond    = protocol.get("conditionsModule", {}) or {}
        loc     = protocol.get("contactsLocationsModule", {}) or {}

        nct_id = ident.get("nctId")
        if not nct_id:
            return None

        phases = design.get("phases", []) or []
        phase = phases[0] if phases else None

        # Primary completion date
        pcd = status.get("primaryCompletionDateStruct", {}).get("date")
        sd = status.get("startDateStruct", {}).get("date")

        interventions = intr.get("interventions", []) or []
        intervention_name = interventions[0].get("name") if interventions else None

        sponsor = spons.get("leadSponsor", {}).get("name")

        # conditionsModule.conditions is a list of plain strings (not dicts)
        cond_list = cond.get("conditions", []) or []
        conditions = [c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else None) for c in cond_list]
        conditions = [c for c in conditions if c]

        locations = loc.get("locations", []) or []
        countries = list({l.get("country") for l in locations if l.get("country")})

        results_first = (status.get("resultsFirstPostDateStruct", {}) or {}).get("date")

        return {
            "nct_id": nct_id,
            "drug_id": t.get("_drug_id"),
            "intervention_name": intervention_name,
            "brief_title": ident.get("briefTitle"),
            "sponsor": sponsor,
            "phase": phase.replace("PHASE", "Phase ") if phase and phase.startswith("PHASE") else phase,
            "overall_status": status.get("overallStatus"),
            "primary_completion_date": pcd,
            "start_date": sd,
            "conditions": conditions,
            "countries": countries,
            "results_first_posted": results_first,
            "enrollment_count": (design.get("enrollmentInfo", {}) or {}).get("count"),
            "source_url": f"https://clinicaltrials.gov/study/{nct_id}",
            "raw_data": t,
        }

    def run(self):
        """Bypass the base run() — clinical trials are too large to log to raw_scrapes.
        We fetch + normalise + upsert directly."""
        from datetime import datetime, timezone
        started = datetime.now(timezone.utc).isoformat()
        try:
            raw = self.fetch()
            events = self.normalize(raw)
            counts = self.upsert(events)
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "success",
                "records_found": len(raw),
                "records_processed": counts.get("upserted", 0),
                "errors": counts.get("errors", 0),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            self.log.error("ClinicalTrials.gov run failed", extra={"error": str(exc)})
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "failed",
                "error": str(exc),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }

    def upsert(self, events: list[dict]) -> dict:
        """Override default — we write to clinical_trials table."""
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                payload = {k: v for k, v in ev.items() if k in (
                    "nct_id", "drug_id", "intervention_name", "brief_title", "sponsor",
                    "phase", "overall_status", "primary_completion_date", "start_date",
                    "conditions", "countries", "results_first_posted", "enrollment_count",
                    "source_url", "raw_data",
                )}
                payload["last_synced_at"] = datetime.now(timezone.utc).isoformat()
                self.db.table("clinical_trials").upsert(
                    payload, on_conflict="nct_id"
                ).execute()
                counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("Failed to upsert clinical trial", extra={"nct_id": ev.get("nct_id"), "error": str(exc)})
        return counts


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
        print("DRY RUN — ClinicalTrials.gov")
        print("=" * 60)
        # Need real DB for this scraper because we iterate through drugs catalogue
        from backend.utils.db import get_supabase_client
        scraper = ClinicalTrialsScraper(db_client=get_supabase_client())
        # Limit dry-run scope
        scraper.MAX_TOTAL_TRIALS = 25
        scraper.DRUGS_PER_BATCH = 5
        raw = scraper.fetch()
        print(f"  Trials fetched: {len(raw)}")
        events = scraper.normalize(raw)
        print(f"  Normalised: {len(events)}")
        if events:
            print("\n  Sample (first 3):")
            for e in events[:3]:
                print(f"    {e['nct_id']} | {e.get('phase','?'):8} | {e.get('overall_status','?'):20} | {e.get('intervention_name','?')[:40]} | completion={e.get('primary_completion_date','?')}")
        sys.exit(0)

    scraper = ClinicalTrialsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
