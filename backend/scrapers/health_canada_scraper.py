"""
Health Canada Drug Shortages Scraper
─────────────────────────────────────
Source:  Health Canada — Drug Shortages Database
Site:    https://healthproductshortages.ca  (moved from drugshortagescanada.ca)
API:     https://healthproductshortages.ca/api/v1  (login + search; needs a free
         account in HC_DSC_EMAIL / HC_DSC_PASSWORD). Used since 2026-11-10.
Export:  https://healthproductshortages.ca/search/export — RETIRED: behind a
         Cloudflare bot challenge since ~2026-09-13 (403 to every client).
         fetch() maps API records onto the export's CSV columns below, so
         normalisation and shortage_id are unchanged.

Former export response format (probed 2026-02-22):
    POST /search/export with form-encoded parameters returns a ZIP file
    containing shortage_report_export.csv.

    ZIP → CSV structure:
        Row 1: Disclaimer banner (skip)
        Row 2: Column headers
        Row 3+: Data rows

    Confirmed CSV columns:
        Report ID, Drug Identification Number, Report Type,
        Brand name, Company Name, Common or Proper name,
        Ingredients, Strength(s), Packaging size,
        Route of administration, Shortage status, Dosage form(s),
        ATC Code, ATC description,
        Anticipated start date, Actual start date,
        Estimated end date, Actual end date,
        Reason, Date Created, Date Updated, Tier 3

Status values:
    "Actual shortage"      → active
    "Anticipated shortage" → anticipated
    "Avoided shortage"     → resolved  (never materialised)
    "Resolved"             → resolved

Reason values (Health Canada standardised strings):
    "Disruption of the manufacture of the drug."                → manufacturing_issue
    "Demand increase for the drug."                             → demand_surge
    "Shortage of an active ingredient."                         → raw_material
    "Shortage of an inactive ingredient or component."          → raw_material
    "Delay in shipping of the drug."                            → supply_chain
    "Requirements related to complying with good manufacturing
     practices."                                                → manufacturing_issue
    "Other (Please describe in comments)"                       → unknown

Tier 3:
    "Yes" = High clinical priority (life-saving; no or limited alternative).
    Used to elevate severity to "critical".

Dates: ISO 8601 (YYYY-MM-DD), already parsed — no conversion needed.

ATC codes: Present in the export — excellent for future drug enrichment.

Status filters fetched:
    active_confirmed      → "Actual shortage"    (~1,771 records)
    anticipated_shortage  → "Anticipated shortage" (~75 records)
    (resolved is ~22,000 records and times out on export; skip for now)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.retry import with_exponential_backoff


class HealthCanadaScraper(BaseScraper):
    """Scraper for the Health Canada Drug Shortages Database."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000002"
    SOURCE_NAME:  str = "Health Canada — Drug Shortages Database"
    BASE_URL:     str = "https://healthproductshortages.ca"
    COUNTRY:      str = "Canada"
    COUNTRY_CODE: str = "CA"

    # ── Fetch: the official public-access API ─────────────────────────────
    # The site (incl. /search/export, the CSV-in-ZIP export this scraper used
    # until Sep 2026) now sits behind a Cloudflare bot challenge that 403s
    # every non-browser client. We do not try to get past that challenge.
    # The documented public API under /api/v1/ is NOT behind it; it needs a
    # free healthproductshortages.ca account (credentials in env, below).
    # Contract (rdrugshortages client + fixtures; login verified live
    # 2026-11-10 — it answers "Missing email or password"):
    #   POST /api/v1/login   form email, password → response header auth-token
    #   GET  /api/v1/search  header auth-token; params limit, offset,
    #        filter_status, orderby, order, term, din, report_id
    #        → {"data": [...], "total", "offset", "limit", "remaining"}
    #   Rate limit 1000 requests/hour.
    API_BASE:     str = "https://healthproductshortages.ca/api/v1"
    EMAIL_ENV:    str = "HC_DSC_EMAIL"
    PASSWORD_ENV: str = "HC_DSC_PASSWORD"
    PAGE_SIZE:    int = 1000
    API_TIMEOUT:  float = 120.0

    # One query per status filter — the same filters the CSV export used.
    _API_STATUSES: list[str] = [
        "active_confirmed",
        "anticipated_shortage",
    ]
    # API status → the CSV "Shortage status" label _normalise_record expects.
    _API_STATUS_LABEL: dict[str, str] = {
        "active_confirmed":     "Actual shortage",
        "anticipated_shortage": "Anticipated shortage",
        "avoided_shortage":     "Avoided shortage",
        "resolved":             "Resolved",
    }

    # Health Canada publishes every current shortage, so an open row that the
    # two status lists no longer contain has left them (resolved / avoided /
    # re-dated) — a RECONCILE_ABSENT candidate (see BaseScraper). Left OFF
    # until a dry run on live API data shows a plausible absent set:
    #   s = HealthCanadaScraper(); s.run()
    #   s.reconcile_absent(found=0, execute=False)   # → open / absent counts
    RECONCILE_ABSENT: bool = False

    # Sanity floor (≈3.5k open CA rows, Nov 2026): a far smaller feed is a
    # broken query, never a real collapse in Canadian shortages.
    MIN_RECORDS: int = 500

    # ─────────────────────────────────────────────────────────────────────────
    # Status mapping
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "Actual shortage":      "active",
        "Anticipated shortage": "anticipated",
        "Avoided shortage":     "resolved",
        "Resolved":             "resolved",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # Reason mapping  (HC uses full English sentences)
    # ─────────────────────────────────────────────────────────────────────────

    _REASON_MAP: dict[str, str] = {
        "Disruption of the manufacture of the drug.":
            "manufacturing_issue",
        "Demand increase for the drug.":
            "demand_surge",
        "Shortage of an active ingredient.":
            "raw_material",
        "Shortage of an inactive ingredient or component.":
            "raw_material",
        "Delay in shipping of the drug.":
            "supply_chain",
        "Requirements related to complying with good manufacturing practices.":
            "manufacturing_issue",
        "Other (Please describe in comments)":
            "unknown",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Log in to the public API, page through each status filter, and return
        records in the CSV-row shape _normalise_record() has always consumed,
        so drug resolution — and therefore shortage_id — is unchanged.
        """
        email = os.environ.get(self.EMAIL_ENV, "").strip()
        password = os.environ.get(self.PASSWORD_ENV, "").strip()
        if not email or not password:
            raise ScraperError(
                f"Health Canada API credentials missing: set {self.EMAIL_ENV} and "
                f"{self.PASSWORD_ENV} (a free healthproductshortages.ca account). "
                "The CSV export is behind a Cloudflare bot challenge since ~2026-09-13."
            )

        with httpx.Client(timeout=self.API_TIMEOUT, follow_redirects=True,
                          headers={"User-Agent": self.DEFAULT_HEADERS["User-Agent"],
                                   "Accept": "application/json"}) as client:
            token = self._login(client, email, password)
            all_records: list[dict] = []
            for status_filter in self._API_STATUSES:
                api_records = self._search_all(client, token, status_filter)
                self._detect_tier3_key(api_records)
                rows = [self._api_to_row(r) for r in api_records
                        if ((r.get("type") or {}).get("label") or "shortage") == "shortage"]
                self.log.info("Fetched HC API status list",
                              extra={"status_filter": status_filter, "records": len(rows)})
                all_records.extend(rows)

        if len(all_records) < self.MIN_RECORDS:
            raise ScraperError(
                f"Health Canada API returned only {len(all_records)} shortage reports "
                f"(< {self.MIN_RECORDS}); refusing to write a partial view"
            )
        self.log.info("HC fetch complete", extra={"total_records": len(all_records)})
        return all_records

    @with_exponential_backoff(
        max_attempts=3, base_delay=3.0, max_delay=60.0,
        exceptions=(httpx.TimeoutException, httpx.NetworkError),
    )
    def _login(self, client: httpx.Client, email: str, password: str) -> str:
        resp = client.post(f"{self.API_BASE}/login", data={"email": email, "password": password})
        if resp.status_code != 200:
            raise ScraperError(f"Health Canada API login failed: HTTP {resp.status_code} {resp.text[:200]}")
        token = resp.headers.get("auth-token")
        if not token:
            raise ScraperError("Health Canada API login returned no auth-token header")
        return token

    @with_exponential_backoff(
        max_attempts=3, base_delay=3.0, max_delay=60.0,
        exceptions=(httpx.HTTPError, httpx.TimeoutException, httpx.NetworkError),
    )
    def _search_page(self, client: httpx.Client, token: str, status_filter: str, offset: int) -> dict:
        self._enforce_rate_limit()
        resp = client.get(
            f"{self.API_BASE}/search",
            params={"filter_status": status_filter, "limit": self.PAGE_SIZE, "offset": offset},
            headers={"auth-token": token},
        )
        resp.raise_for_status()
        return resp.json()

    def _search_all(self, client: httpx.Client, token: str, status_filter: str) -> list[dict]:
        out: list[dict] = []
        offset = 0
        for _ in range(200):  # hard cap: 200k records
            page = self._search_page(client, token, status_filter, offset)
            data = page.get("data")
            if not isinstance(data, list):
                raise ScraperError(f"Unexpected HC API response keys: {sorted(page)[:10]}")
            out.extend(data)
            remaining = int(page.get("remaining") or 0)
            if remaining <= 0 or not data:
                return out
            offset += len(data)
        raise ScraperError("HC API paging did not terminate")

    _tier3_key: str | None = None

    def _detect_tier3_key(self, api_records: list[dict]) -> None:
        """Tier 3 drives tier_3 and 'critical' severity. The API field name is
        not in the (2019) client fixtures, so find it — and fail loudly rather
        than silently write every Canadian shortage as not-Tier-3."""
        if self._tier3_key or not api_records:
            return
        keys = {k for r in api_records[:200] for k in r if "tier" in k.lower()}
        if not keys:
            raise ScraperError("HC API records carry no Tier 3 field; refusing to write tier_3=No for all")
        self._tier3_key = "tier_3" if "tier_3" in keys else sorted(keys)[0]
        self.log.info("HC Tier 3 field", extra={"key": self._tier3_key, "candidates": sorted(keys)})

    @staticmethod
    def _api_date(v: Any) -> str:
        """'2019-02-08T00:00:00-0500' → '2019-02-08' (HC local date, as in the CSV)."""
        return (v or "")[:10] if isinstance(v, str) else ""

    def _api_to_row(self, r: dict) -> dict:
        """Map one API report to the CSV export's column names."""
        def lines(v: Any) -> str:
            parts = [p.strip() for p in str(v or "").replace("\r", "").split("\n")]
            return "; ".join(p for p in parts if p)

        tier3 = r.get(self._tier3_key) if self._tier3_key else None
        if isinstance(tier3, str):
            tier3_label = "Yes" if tier3.strip().lower() in ("yes", "true", "1") else "No"
        elif tier3 is None:
            tier3_label = ""  # field absent: unknown, never assumed "No"
        else:
            tier3_label = "Yes" if tier3 else "No"

        status = (r.get("status") or "").strip()
        return {
            "Report ID":                  str(r.get("id") or ""),
            "Drug Identification Number": (r.get("din") or "").strip(),
            "Report Type":                "Shortage",
            "Brand name":                 r.get("en_drug_brand_name") or "",
            "Company Name":               r.get("company_name") or "",
            "Common or Proper name":      r.get("en_drug_common_name") or "",
            "Ingredients":                lines(r.get("en_ingredients")),
            "Strength(s)":                lines(r.get("drug_strength")),
            "Packaging size":             r.get("drug_package_quantity") or "",
            "Route of administration":    lines(r.get("drug_route")),
            "Shortage status":            self._API_STATUS_LABEL.get(status, status),
            "Dosage form(s)":             lines(r.get("drug_dosage_form")),
            "ATC Code":                   r.get("atc_number") or "",
            "ATC description":            r.get("atc_description") or "",
            "Anticipated start date":     self._api_date(r.get("anticipated_start_date")),
            "Actual start date":          self._api_date(r.get("actual_start_date")),
            "Estimated end date":         self._api_date(r.get("estimated_end_date")),
            "Actual end date":            self._api_date(r.get("actual_end_date")),
            "Reason":                     ((r.get("shortage_reason") or {}).get("en_reason") or ""),
            "Date Created":               self._api_date(r.get("created_date")),
            "Date Updated":               self._api_date(r.get("updated_date")),
            "Tier 3":                     tier3_label,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        """
        Transform the Health Canada CSV records into shortage dicts ready for
        BaseScraper.upsert().
        """
        records: list[dict] = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising HC records",
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
                    "Failed to normalise HC record",
                    extra={
                        "error":     str(exc),
                        "report_id": rec.get("Report ID"),
                        "din":       rec.get("Drug Identification Number"),
                    },
                )

        self.log.info(
            "Normalisation done",
            extra={
                "total":      len(records),
                "normalised": len(normalised),
                "skipped":    skipped,
            },
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        """
        Map a single Health Canada CSV row to the internal shortage dict format.
        Returns None if the record should be discarded (e.g. blank drug name).
        """
        # ── Generic name ─────────────────────────────────────────────────────
        # "Ingredients" contains INN names (e.g. "ADEFOVIR DIPIVOXIL").
        # For multi-ingredient drugs: "AMLODIPINE; TELMISARTAN".
        # We use the first ingredient as the canonical generic name for matching
        # (the drug lookup prefix-matches against the first word).
        ingredients_raw: str = (rec.get("Ingredients") or "").strip()
        common_name:     str = (rec.get("Common or Proper name") or "").strip()

        if ingredients_raw:
            first_ingredient = ingredients_raw.split(";")[0].strip()
            generic_name = first_ingredient.title()
        elif common_name:
            generic_name = common_name.title()
        else:
            return None  # no usable drug name — discard

        # ── Brand name ────────────────────────────────────────────────────────
        brand_raw = (rec.get("Brand name") or "").strip()
        brand_names = [brand_raw.title()] if brand_raw else []

        # ── Status ────────────────────────────────────────────────────────────
        hc_status: str = (rec.get("Shortage status") or "").strip()
        status = self._STATUS_MAP.get(hc_status, "active")

        # ── Dates (already ISO 8601 — no parsing needed) ──────────────────────
        actual_start     = self._as_date(rec.get("Actual start date"))
        anticipated_start = self._as_date(rec.get("Anticipated start date"))
        estimated_end    = self._as_date(rec.get("Estimated end date"))
        actual_end       = self._as_date(rec.get("Actual end date"))

        # Prefer actual start; fall back to anticipated; then date created
        start_date = (
            actual_start
            or anticipated_start
            or self._as_date(rec.get("Date Created"))
            or datetime.now(timezone.utc).date().isoformat()
        )

        end_date: str | None = actual_end if status == "resolved" else None
        estimated_resolution_date: str | None = (
            estimated_end if status in ("active", "anticipated") else None
        )

        # ── Reason / reason_category ──────────────────────────────────────────
        hc_reason: str = (rec.get("Reason") or "").strip()
        reason_category = self._REASON_MAP.get(hc_reason, "unknown")
        reason: str | None = (
            hc_reason if hc_reason and hc_reason != "Other (Please describe in comments)" else None
        )

        # ── Severity ──────────────────────────────────────────────────────────
        tier3: bool   = (rec.get("Tier 3") or "No").strip().lower() == "yes"
        route: str    = (rec.get("Route of administration") or "").upper()
        atc_desc: str = (rec.get("ATC description") or "").upper()
        severity = self._infer_severity(status, tier3, route, atc_desc, generic_name)

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        atc_code = (rec.get("ATC Code") or "").strip()
        if atc_code:
            notes_parts.append(f"ATC: {atc_code} — {atc_desc.title()}")
        if rec.get("Strength(s)"):
            notes_parts.append(f"Strength: {rec['Strength(s)']}")
        if route:
            notes_parts.append(f"Route: {route.title()}")
        if tier3:
            notes_parts.append("Tier 3: Yes (high clinical priority — no or limited alternatives)")
        notes: str | None = "\n".join(notes_parts) or None

        # ── Source URL ────────────────────────────────────────────────────────
        report_id = (rec.get("Report ID") or "").strip()
        source_url = (
            f"https://healthproductshortages.ca/shortage/{report_id}"
            if report_id
            else self.BASE_URL
        )

        return {
            # Drug resolution
            "generic_name":  generic_name,
            "brand_names":   brand_names,
            # Shortage event fields
            "status":                    status,
            "severity":                  severity,
            # HC's own clinical-priority designation, as a first-class signal
            # (migration 048). Also feeds severity above, but persisted here
            # as the authoritative, queryable flag.
            "tier_3":                    tier3,
            "reason":                    reason,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution_date,
            # Anticipated onset, persisted as a first-class queryable signal
            # (migration 049). HC carries BOTH an actual and an anticipated
            # start; start_date above prefers the actual, so without this the
            # >= 6-month early-warning runway lived only inside raw_data.
            # Only meaningful for anticipated rows whose onset is still ahead.
            "anticipated_start_date":    (
                anticipated_start if status == "anticipated" else None
            ),
            "source_url":                source_url,
            "notes":                     notes,
            # Original record stored verbatim
            "raw_record": {
                "report_id":         report_id or None,
                "din":               (rec.get("Drug Identification Number") or "").strip() or None,
                "brand_name":        brand_raw or None,
                "company_name":      (rec.get("Company Name") or "").strip() or None,
                "common_proper_name": common_name or None,
                "ingredients":       ingredients_raw or None,
                "strength":          (rec.get("Strength(s)") or "").strip() or None,
                "dosage_form":       (rec.get("Dosage form(s)") or "").strip() or None,
                "route":             route or None,
                "atc_code":          atc_code or None,
                "atc_description":   atc_desc.title() or None,
                "shortage_status":   hc_status or None,
                "anticipated_start": rec.get("Anticipated start date") or None,
                "actual_start":      rec.get("Actual start date") or None,
                "estimated_end":     rec.get("Estimated end date") or None,
                "actual_end":        rec.get("Actual end date") or None,
                "reason":            hc_reason or None,
                "tier3":             rec.get("Tier 3") or None,
                "date_created":      rec.get("Date Created") or None,
                "date_updated":      rec.get("Date Updated") or None,
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Field-level helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _as_date(raw: str | None) -> str | None:
        """
        Validate and return a HC date string (already YYYY-MM-DD).
        Returns None for blank / malformed values.
        """
        if not raw:
            return None
        stripped = raw.strip()
        if len(stripped) == 10 and stripped[4] == "-" and stripped[7] == "-":
            return stripped
        return None

    def _infer_severity(
        self,
        status: str,
        tier3: bool,
        route: str,
        atc_desc: str,
        generic_name: str,
    ) -> str:
        """
        Derive a severity level for a Health Canada shortage event.

        Priority order:
          1. Resolved shortages → 'low' (historical context only)
          2. Tier 3 = Yes → 'critical' (HC's own high-impact flag)
          3. Parenteral / injectable route → 'high'
          4. Life-critical ATC classes → 'high'
          5. Default → 'medium'
        """
        if status == "resolved":
            return "low"

        if tier3:
            return "critical"

        combined = f"{route} {atc_desc} {generic_name}".lower()

        if any(kw in combined for kw in [
            "intravenous", "parenteral", "infusion", "injection",
        ]):
            return "high"

        if any(kw in combined for kw in [
            "insulin", "antidiabetic", "cardiac", "antineoplastic",
            "blood glucose", "immunosuppressant", "transplant",
            "antiinfective", "antibacterial", "antifungal",
        ]):
            return "high"

        return "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
#
# Usage:
#   python -m backend.scrapers.health_canada_scraper        # live run (DB writes)
#   MEDERTI_DRY_RUN=1 python -m backend.scrapers.health_canada_scraper
#
# Needs HC_DSC_EMAIL + HC_DSC_PASSWORD (free healthproductshortages.ca account).
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
        print("Fetches live HC data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = HealthCanadaScraper(db_client=MagicMock())

        print("\n── Fetching from Health Canada export endpoint …")
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

            print("\n── Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:25s} {v}")
            print("\n── Severity breakdown:")
            for k, v in sorted(severity_counts.items()):
                print(f"   {str(k):12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # ── Live run ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)

    scraper = HealthCanadaScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
