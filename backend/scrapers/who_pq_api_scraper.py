"""
WHO Prequalified APIs Scraper  →  api_suppliers (who_pq=true)
──────────────────────────────────────────────────────────────
Source:  WHO Prequalification of Medicines — List of Prequalified Active
         Pharmaceutical Ingredients (APIMF programme).
Page:    https://extranet.who.int/prequal/medicines/prequalified/active-pharmaceutical-ingredients
CSV:     same path + /export?_format=csv  (robots-permissible; ~190 rows)
Columns: WHO Product ID, INN, Grade, Therapeutic area, Applicant organization,
         Date of prequalification, Confirmation date.

Why this matters
────────────────
WHO prequalification is the authoritative, openly-published global signal of
which API makers meet international quality standards for UN/global-fund
procurement — the non-US, global-south coverage that FDA DMF (US-market) and
DECRS miss. Each row names the applicant (manufacturer) and the INN, so it maps
directly onto api_suppliers with the who_pq flag (a column the schema already
carries). Smaller than the DMF list but high-trust and citable.

It complements, not duplicates, fda_dmf: a maker prequalified by WHO but absent
from the US DMF list is exactly the kind of global supplier a US-only view hides.

Country: the WHO list has no country column. We leave country NULL; the
fda_decrs run enriches api_suppliers.country by manufacturer name afterwards.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.who_pq_api_scraper
    python3 -m backend.scrapers.who_pq_api_scraper
    python3 run_all_scrapers.py who_pq

Cadence: quarterly (WHO updates the list as new APIs are prequalified).
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class WHOPQAPIScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000095"
    SOURCE_NAME:  str = "WHO Prequalified Active Pharmaceutical Ingredients"
    BASE_URL:     str = "https://extranet.who.int"
    COUNTRY:      str = "Global"
    COUNTRY_CODE: str = "ZZ"

    REQUEST_TIMEOUT: float = 90.0
    SCRAPER_VERSION: str = "1.0.0"

    PAGE_URL: str = "https://extranet.who.int/prequal/medicines/prequalified/active-pharmaceutical-ingredients"
    CSV_URL: str = PAGE_URL + "/export?_format=csv"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/csv,text/html",
    }

    INSERT_CHUNK: int = 200

    _GENERIC_PREFIX_DENY = {"zinc", "iron", "calcium", "sodium", "potassium", "magnesium", "amino", "amino acid"}

    # ── fetch ───────────────────────────────────────────────────────────────
    def fetch(self) -> str:
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(self.CSV_URL)
            resp.raise_for_status()
            self.log.info("Downloaded WHO PQ API CSV", extra={"bytes": len(resp.text)})
            return resp.text

    # ── normalize ─────────────────────────────────────────────────────────--
    def normalize(self, raw: str) -> list[dict]:
        if not raw:
            return []
        reader = csv.DictReader(io.StringIO(raw))
        seen: set[tuple[str, str]] = set()
        events: list[dict] = []
        for row in reader:
            r = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            inn = r.get("INN", "")
            applicant = r.get("Applicant organization", "") or r.get("Applicant", "")
            if not inn or not applicant:
                continue
            generic = self._clean_inn(inn)
            if not generic:
                continue
            key = (generic.lower(), applicant.lower())
            if key in seen:
                continue
            seen.add(key)
            events.append({
                "generic_name": generic,
                "manufacturer_name": applicant,
                "who_product_id": r.get("WHO Product ID") or None,
                "grade": r.get("Grade") or None,
                "therapeutic_area": r.get("Therapeutic area") or None,
                "pq_date": self._clean_date(r.get("Date of prequalification")),
            })
        self.log.info("Normalised WHO PQ APIs", extra={"rows": len(events)})
        return events

    # ── upsert ──────────────────────────────────────────────────────────────
    def upsert(self, events: list[dict]) -> dict:
        counts = {"inserted": 0, "matched_to_drug": 0, "existing": 0, "errors": 0}
        if not events:
            return counts

        drug_exact, drug_prefix = self._load_drug_index()
        existing_keys = self._load_existing_keys()
        batch: list[dict] = []

        def flush() -> None:
            nonlocal batch
            if not batch:
                return
            try:
                self.db.table("api_suppliers").insert(batch).execute()
                counts["inserted"] += len(batch)
            except Exception as exc:
                counts["errors"] += len(batch)
                self.log.warning("WHO PQ insert failed", extra={"error": str(exc), "size": len(batch)})
            batch = []

        for ev in events:
            generic = ev["generic_name"]
            holder = ev["manufacturer_name"]
            drug_id, canonical = self._match_drug(generic.lower(), drug_exact, drug_prefix)
            stored_generic = canonical or generic
            if (stored_generic.lower(), holder.lower()) in existing_keys:
                counts["existing"] += 1
                continue
            existing_keys.add((stored_generic.lower(), holder.lower()))
            if drug_id:
                counts["matched_to_drug"] += 1
            batch.append({
                "drug_id": drug_id,
                "generic_name": stored_generic,
                "manufacturer_name": holder,
                "country": None,  # enriched later by fda_decrs name match
                "capabilities": ["API manufacture (WHO prequalified)"],
                "cep_holder": False,
                "dmf_holder": False,
                "who_pq": True,
                "source": "who_pq",
                "source_url": self.PAGE_URL,
                "raw_data": {
                    "who_product_id": ev.get("who_product_id"),
                    "grade": ev.get("grade"),
                    "therapeutic_area": ev.get("therapeutic_area"),
                    "prequalification_date": ev.get("pq_date"),
                },
            })
            if len(batch) >= self.INSERT_CHUNK:
                flush()
        flush()
        return counts

    # ── helpers ───────────────────────────────────────────────────────────--
    def _clean_inn(self, inn: str) -> str:
        s = re.sub(r"\([^)]*\)", " ", inn)          # drop salt parenthetical
        s = s.replace("&", " ")
        s = re.sub(r"\s+", " ", s).strip(" -/").lower()
        return s

    @staticmethod
    def _clean_date(raw: str | None) -> str | None:
        if not raw:
            return None
        s = re.sub(r"\s+", " ", raw).strip()
        for fmt in ("%d %b, %Y", "%d %B, %Y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return s or None

    def _load_drug_index(self):
        exact: dict[str, tuple[str, str]] = {}
        prefix: dict[str, list[tuple[str, str, str]]] = {}
        page = 0
        size = 1000
        while True:
            resp = (
                self.db.table("drugs")
                .select("id, generic_name, generic_name_normalised")
                .range(page * size, page * size + size - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            for r in rows:
                norm = (r.get("generic_name_normalised") or r.get("generic_name") or "").strip().lower()
                if not norm:
                    continue
                exact.setdefault(norm, (r["id"], r["generic_name"]))
                fw = norm.split()[0].rstrip(";,")
                if len(fw) >= 4:
                    prefix.setdefault(fw, []).append((norm, r["id"], r["generic_name"]))
            if len(rows) < size:
                break
            page += 1
        self.log.info("Loaded drug index", extra={"exact": len(exact)})
        return exact, prefix

    def _load_existing_keys(self) -> set[tuple[str, str]]:
        keys: set[tuple[str, str]] = set()
        page = 0
        size = 1000
        while True:
            resp = (
                self.db.table("api_suppliers")
                .select("generic_name, manufacturer_name")
                .eq("source", "who_pq")
                .range(page * size, page * size + size - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            for r in rows:
                keys.add(((r.get("generic_name") or "").lower(), (r.get("manufacturer_name") or "").lower()))
            if len(rows) < size:
                break
            page += 1
        return keys

    def _match_drug(self, norm: str, exact: dict, prefix: dict) -> tuple[str | None, str | None]:
        if norm in exact:
            return exact[norm]
        fw = norm.split()[0].rstrip(";,") if norm else ""
        if len(fw) >= 4 and fw in prefix:
            best = None
            best_len = -1
            for cand_norm, did, name in prefix[fw]:
                if cand_norm in self._GENERIC_PREFIX_DENY:
                    continue
                if norm == cand_norm or norm.startswith(cand_norm + " "):
                    if len(cand_norm) > best_len:
                        best, best_len = (did, name), len(cand_norm)
            if best:
                return best
        return None, None

    # ── run ───────────────────────────────────────────────────────────────--
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
                "records_processed": counts.get("inserted", 0),
                "matched_to_drug": counts.get("matched_to_drug", 0),
                "existing": counts.get("existing", 0),
                "errors": counts.get("errors", 0),
                "finished_at": finished_at.isoformat(),
            }
        except Exception as exc:
            self.log.error("WHO PQ run failed", extra={"error": str(exc)})
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
        print("DRY RUN — WHO Prequalified APIs")
        print("=" * 60)
        scraper = WHOPQAPIScraper(db_client=MagicMock())
        raw = scraper.fetch()
        events = scraper.normalize(raw)
        print(f"  Rows               : {len(events)}")
        print(f"  Unique substances  : {len({e['generic_name'] for e in events})}")
        print(f"  Unique applicants  : {len({e['manufacturer_name'] for e in events})}")
        for e in events[:8]:
            print(f"    {e['generic_name'][:28]:28s}  ←  {e['manufacturer_name']}")
        sys.exit(0)

    scraper = WHOPQAPIScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
