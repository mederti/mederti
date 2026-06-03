"""
FDA DECRS Scraper  →  manufacturing_facilities + api_suppliers.country
──────────────────────────────────────────────────────────────────────
Source:  FDA "Drug Establishments Current Registration Site" (DECRS)
File:    https://www.accessdata.fda.gov/cder/drls_reg.zip  (updated daily)
         → drls_reg.txt, tab-delimited, latin-1, ~10k rows.
Columns: FEI_NUMBER, DUNS_NUMBER, FIRM_NAME, ADDRESS, EXPIRATION_DATE,
         OPERATIONS, ...REGISTRANT_NAME..., EXCLUSION_FLAG

Why this matters
────────────────
DECRS is the authoritative registry of every establishment registered to
manufacture / process / import drugs for the US market. Crucially it carries
the establishment ADDRESS — so it is the primary source for *country of
manufacture*, the one dimension the FDA Drug Master File list (see
fda_dmf_scraper) lacks. The ADDRESS tail encodes an ISO-3 country code, e.g.
"Rue Grands Navoirs, Chauny, F-02300, France (FRA)", and OPERATIONS flags
"API MANUFACTURE". This closes the last gap versus the Johns Hopkins
supply-chain dashboard (which maps API/FDF manufacturing geography).

This scraper does two things:
  1. Upserts every establishment into `manufacturing_facilities` (keyed on
     FEI) — a 10k-row registry with country + API-manufacture flag, a large
     upgrade on the inspection-only rows already there. Inspection counters
     written by fda_inspections are preserved (upsert sets only our columns).
  2. Enriches `api_suppliers.country` (NULL until now) by matching each DMF
     holder name to a DECRS firm. Matching is exact-normalised first, then a
     token-boundary-prefix / first-two-token fallback that ONLY assigns a
     country when every candidate firm agrees on one — so we never guess a
     country. ~50% of holders match; the rest stay NULL (honest gap).

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.fda_decrs_scraper
    python3 -m backend.scrapers.fda_decrs_scraper
    python3 run_all_scrapers.py fda_decrs

Cadence: quarterly (alongside fda_dmf — holder base changes slowly).
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class FDADECRSScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000093"
    SOURCE_NAME:  str = "FDA Drug Establishments Current Registration Site"
    BASE_URL:     str = "https://www.accessdata.fda.gov"
    COUNTRY:      str = "Global"
    COUNTRY_CODE: str = "ZZ"

    REQUEST_TIMEOUT: float = 120.0
    SCRAPER_VERSION: str = "1.0.0"

    DOWNLOAD_URL: str = "https://www.accessdata.fda.gov/cder/drls_reg.zip"
    SOURCE_PAGE: str = "https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "application/zip,application/octet-stream",
    }

    INSERT_CHUNK: int = 500

    # Bare element/class names that must not absorb distinct firms via prefix.
    _GENERIC_PREFIX_DENY = {"the", "new", "drug", "drugs", "pharma", "pharmaceutical", "pharmaceuticals"}

    # ── fetch ───────────────────────────────────────────────────────────────
    def fetch(self) -> str:
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(self.DOWNLOAD_URL)
            resp.raise_for_status()
            zf = zipfile.ZipFile(io.BytesIO(resp.content))
            name = next((n for n in zf.namelist() if n.lower().endswith(".txt")), None)
            if not name:
                raise RuntimeError("drls_reg.txt not found in DECRS zip")
            text = zf.read(name).decode("latin-1")
            self.log.info("Downloaded DECRS registry", extra={"bytes": len(resp.content), "txt_bytes": len(text)})
            return text

    # ── normalize ─────────────────────────────────────────────────────────--
    def normalize(self, raw: str) -> list[dict]:
        if not raw:
            return []
        reader = csv.DictReader(io.StringIO(raw), delimiter="\t")
        events: list[dict] = []
        for row in reader:
            r = {(k or "").strip(): self._cv(v) for k, v in row.items()}
            if r.get("EXCLUSION_FLAG", "").upper() == "Y":
                continue
            firm = r.get("FIRM_NAME", "")
            if not firm:
                continue
            country_name, iso3 = self._parse_country(r.get("ADDRESS", ""))
            ops = r.get("OPERATIONS", "")
            events.append({
                "fei_number": r.get("FEI_NUMBER") or None,
                "duns_number": r.get("DUNS_NUMBER") or None,
                "facility_name": firm[:200],
                "firm_norm": self._normname(firm),
                "country_name": country_name,
                "iso3": iso3,
                "is_api": "API MANUFACTURE" in ops.upper(),
                "operations": ops,
                "address": r.get("ADDRESS", ""),
                "expiration_date": r.get("EXPIRATION_DATE") or None,
            })
        self.log.info("Normalised DECRS establishments", extra={"count": len(events)})
        return events

    # ── upsert ──────────────────────────────────────────────────────────────
    def upsert(self, events: list[dict]) -> dict:
        counts = {"facilities_upserted": 0, "facility_errors": 0,
                  "suppliers_enriched": 0, "supplier_errors": 0}
        if not events:
            return counts

        # 1) Build the firm → country lookup (prefer API-manufacture sites) and
        #    a first-two-token index for agreement-based fallback matching.
        firm_country: dict[str, tuple[str, str]] = {}   # firm_norm -> (name, iso3)
        tok2_iso: dict[str, set[str]] = defaultdict(set)
        for ev in events:
            fn, name, iso = ev["firm_norm"], ev["country_name"], ev["iso3"]
            if not fn or not iso:
                continue
            if fn not in firm_country or ev["is_api"]:
                firm_country[fn] = (name, iso)
            toks = fn.split()
            if len(toks) >= 2:
                tok2_iso[" ".join(toks[:2])].add(iso)

        # 2) Upsert establishments into manufacturing_facilities, keyed on FEI.
        #    The table's FEI unique index is PARTIAL, which PostgREST can't use
        #    as an on_conflict arbiter — so we preload existing FEIs and split
        #    inserts (batched) from updates (only our columns, preserving the
        #    inspection counters fda_inspections maintains).
        existing_fei = self._load_existing_fei()
        batch: list[dict] = []
        seen_fei: set[str] = set()

        def payload(ev: dict) -> dict:
            return {
                "fei_number": ev["fei_number"],
                "duns_number": ev["duns_number"],
                "facility_name": ev["facility_name"],
                "company_name": ev["facility_name"],
                "country": ev["country_name"],
                "facility_type": "API manufacturer" if ev["is_api"] else "Drug establishment",
                "source": "fda_decrs",
                "source_url": self.SOURCE_PAGE,
                "raw_data": {
                    "operations": ev["operations"],
                    "address": ev["address"],
                    "iso3": ev["iso3"],
                    "expiration_date": ev["expiration_date"],
                    "is_api_manufacturer": ev["is_api"],
                },
            }

        def flush() -> None:
            nonlocal batch
            if not batch:
                return
            try:
                self.db.table("manufacturing_facilities").insert(batch).execute()
                counts["facilities_upserted"] += len(batch)
            except Exception as exc:
                counts["facility_errors"] += len(batch)
                self.log.warning("Facility insert failed", extra={"error": str(exc), "size": len(batch)})
            batch = []

        for ev in events:
            fei = ev["fei_number"]
            if not fei or fei in seen_fei:
                continue
            seen_fei.add(fei)
            if fei in existing_fei:
                try:
                    self.db.table("manufacturing_facilities").update(payload(ev)).eq("fei_number", fei).execute()
                    counts["facilities_upserted"] += 1
                except Exception as exc:
                    counts["facility_errors"] += 1
                    self.log.warning("Facility update failed", extra={"error": str(exc), "fei": fei})
                continue
            batch.append(payload(ev))
            if len(batch) >= self.INSERT_CHUNK:
                flush()
        flush()

        # 3) Enrich api_suppliers.country for rows still missing a country.
        holders = self._load_uncountried_holders()
        for name in holders:
            iso_name = self._match_country(name, firm_country, tok2_iso)
            if not iso_name:
                continue
            try:
                (
                    self.db.table("api_suppliers")
                    .update({"country": iso_name})
                    .eq("manufacturer_name", name)
                    .is_("country", "null")
                    .execute()
                )
                counts["suppliers_enriched"] += 1
            except Exception as exc:
                counts["supplier_errors"] += 1
                self.log.warning("Supplier country update failed", extra={"error": str(exc), "manufacturer": name})

        return counts

    # ── helpers ───────────────────────────────────────────────────────────--
    @staticmethod
    def _cv(v) -> str:
        if isinstance(v, list):
            v = " ".join(x for x in v if x)
        return (v or "").strip()

    @staticmethod
    def _parse_country(addr: str) -> tuple[str | None, str | None]:
        """ADDRESS tail looks like '..., France (FRA)'. Return (name, ISO3)."""
        m = re.search(r"([A-Za-z .'\-]+?)\s*\(([A-Z]{3})\)\s*$", addr)
        if m:
            return m.group(1).strip(", "), m.group(2)
        return None, None

    @staticmethod
    def _normname(n: str) -> str:
        n = n.upper()
        n = re.sub(r"[.,&]", " ", n)
        n = re.sub(
            r"\b(INC|LLC|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY|GMBH|AG|SA|SPA|SRL|"
            r"BV|NV|AB|PVT|PRIVATE|PLC|LP|LLP|SAS|KG|PTY|SDN|BHD)\b",
            " ", n,
        )
        return re.sub(r"\s+", " ", n).strip()

    def _match_country(
        self,
        holder: str,
        firm_country: dict[str, tuple[str, str]],
        tok2_iso: dict[str, set[str]],
    ) -> str | None:
        """Return a country NAME for a manufacturer, or None. Only assigns when
        unambiguous — every candidate firm must agree on one country."""
        nm = self._normname(holder)
        if not nm:
            return None
        if nm in firm_country:
            return firm_country[nm][0]
        # token-boundary prefix (either direction), require single-country agreement
        names: dict[str, str] = {}
        for fn, (name, iso) in firm_country.items():
            if nm == fn or nm.startswith(fn + " ") or fn.startswith(nm + " "):
                names[iso] = name
        if len(names) == 1:
            return next(iter(names.values()))
        # first-two-token agreement
        toks = nm.split()
        if len(toks) >= 2 and toks[0] not in self._GENERIC_PREFIX_DENY:
            isos = tok2_iso.get(" ".join(toks[:2]), set())
            if len(isos) == 1:
                iso = next(iter(isos))
                for fn, (name, fiso) in firm_country.items():
                    if fiso == iso and fn.startswith(" ".join(toks[:2])):
                        return name
        return None

    def _load_existing_fei(self) -> set[str]:
        """FEIs already in manufacturing_facilities, so we update rather than
        duplicate (the partial unique index can't be an on_conflict arbiter)."""
        fei: set[str] = set()
        page = 0
        size = 1000
        while True:
            resp = (
                self.db.table("manufacturing_facilities")
                .select("fei_number")
                .range(page * size, page * size + size - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            for r in rows:
                if r.get("fei_number"):
                    fei.add(r["fei_number"])
            if len(rows) < size:
                break
            page += 1
        self.log.info("Loaded existing FEIs", extra={"count": len(fei)})
        return fei

    def _load_uncountried_holders(self) -> list[str]:
        """Distinct api_suppliers.manufacturer_name where country IS NULL."""
        names: set[str] = set()
        page = 0
        size = 1000
        while True:
            resp = (
                self.db.table("api_suppliers")
                .select("manufacturer_name")
                .is_("country", "null")
                .range(page * size, page * size + size - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            for r in rows:
                if r.get("manufacturer_name"):
                    names.add(r["manufacturer_name"])
            if len(rows) < size:
                break
            page += 1
        self.log.info("Loaded uncountried holders", extra={"distinct": len(names)})
        return list(names)

    # ── run (custom: bypass raw_scrapes; large binary download) ──────────────
    def run(self) -> dict:
        started = datetime.now(timezone.utc).isoformat()
        try:
            raw = self.fetch()
            events = self.normalize(raw)
            counts = self.upsert(events)
            finished_at = datetime.now(timezone.utc)
            self._touch_data_source(finished_at)
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "success",
                "records_found": len(events),
                "records_processed": counts.get("facilities_upserted", 0),
                "suppliers_enriched": counts.get("suppliers_enriched", 0),
                "errors": counts.get("facility_errors", 0) + counts.get("supplier_errors", 0),
                "finished_at": finished_at.isoformat(),
            }
        except Exception as exc:
            self.log.error("FDA DECRS run failed", extra={"error": str(exc)})
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "failed",
                "error": str(exc),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }


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
        print("DRY RUN — FDA DECRS")
        print("=" * 60)
        scraper = FDADECRSScraper(db_client=MagicMock())
        raw = scraper.fetch()
        events = scraper.normalize(raw)
        from collections import Counter
        ctry = Counter(e["iso3"] for e in events if e["iso3"])
        api = sum(1 for e in events if e["is_api"])
        print(f"  Establishments     : {len(events):,}")
        print(f"  API-manufacture    : {api:,}")
        print(f"  Top countries      : {ctry.most_common(8)}")
        sys.exit(0)

    scraper = FDADECRSScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
