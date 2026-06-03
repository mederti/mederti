"""
FDA Drug Master File (DMF) Scraper  →  api_suppliers
─────────────────────────────────────────────────────
Source:  FDA "List of Drug Master Files (DMFs)" — updated quarterly
Page:    https://www.fda.gov/drugs/drug-master-files-dmfs/list-drug-master-files-dmfs
File:    a single .xlsx (~2.5 MB) reachable via a /media/<id>/download link
         on that page. Columns: DMF#, STATUS, TYPE, SUBMIT DATE, HOLDER, SUBJECT.

Why this matters
────────────────
This is the single most important supply-chain dataset Mederti was missing.
A Type II DMF is filed by a manufacturer of an active pharmaceutical
ingredient (API) so that finished-drug applicants can reference it. The set
of *active Type II DMFs* for a substance is therefore a direct, primary-source
census of who can legally supply that API into the US market — i.e. the
manufacturing-concentration signal at the heart of the Johns Hopkins
Prescription Drug Supply Chain dashboard.

We ingest active Type II records into `api_suppliers`, which the
`/api/drug-resilience/[drug_id]` endpoint already consumes to compute a
concentration-risk band (1 supplier = "very high", >6 = "low"). Populating
this table lights up that widget from "unknown" to real numbers.

Honest limitations (v1)
───────────────────────
  • The DMF list does NOT include country of manufacture. We store
    `country = NULL`; the JHU-style "where is the API made" enrichment
    requires FDA establishment-registration / import data (a later ingest).
    `manufacturer_name` is recorded verbatim so country can be back-filled.
  • SUBJECT strings are messy (salt forms, grades, USP/BP suffixes). We match
    to `drugs` by normalised exact + first-word prefix and otherwise leave
    `drug_id` NULL — the resilience route still joins on `generic_name.ilike`,
    so an unmatched-but-named row is still useful. We never auto-create a drug
    (the subject set includes excipients/grades that are not real medicines).

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.fda_dmf_scraper   # preview
    python3 -m backend.scrapers.fda_dmf_scraper                     # live
    python3 run_all_scrapers.py fda_dmf                             # via runner

Cadence: quarterly (the FDA refreshes the list ~quarterly).
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from typing import Any

import httpx
import openpyxl

from backend.scrapers.base_scraper import BaseScraper


class FDADMFScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000092"
    SOURCE_NAME:  str = "FDA Drug Master Files — API Manufacturer Census"
    BASE_URL:     str = "https://www.fda.gov"
    COUNTRY:      str = "United States"
    COUNTRY_CODE: str = "US"

    REQUEST_TIMEOUT: float = 120.0
    SCRAPER_VERSION: str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/html,application/xhtml+xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    LIST_PAGE: str = "https://www.fda.gov/drugs/drug-master-files-dmfs/list-drug-master-files-dmfs"
    # Fallback if the page scrape fails to find the link (1Q2026 file id).
    FALLBACK_DOWNLOAD: str = "https://www.fda.gov/media/192069/download?attachment"

    # Only active Type II (drug substance / API) DMFs are supplier signals.
    WANT_TYPE: str = "II"
    WANT_STATUS: str = "A"

    INSERT_CHUNK: int = 500

    # Bare element/class drug names that must not absorb distinct compounds via
    # prefix matching (e.g. "zinc omadine" ≠ elemental "zinc").
    _GENERIC_PREFIX_DENY = {
        "zinc", "iron", "calcium", "sodium", "potassium", "magnesium",
        "copper", "selenium", "manganese", "chromium", "fluoride",
        "phosphate", "amino acid", "amino", "dextrose", "glucose",
    }

    # Grade / pharmacopoeia / physical-form descriptors stripped from SUBJECT
    # before matching. Salt forms are deliberately KEPT (first-word prefix
    # matching handles them, e.g. "metoprolol tartrate" → "metoprolol").
    _NOISE_TOKENS = {
        "usp", "nf", "bp", "ep", "jp", "jpc", "fcc", "ph", "eur", "pheur",
        "grade", "powder", "granular", "granules", "crystalline", "crystals",
        "micronized", "micronised", "anhydrous", "sterile", "dc", "spray",
        "dried", "solution", "ophthalmic", "injection", "pellets", "beads",
        "usp/nf", "technical", "purified",
    }

    # ── fetch ───────────────────────────────────────────────────────────────
    def fetch(self) -> bytes:
        """Resolve the current download link from the list page, then download
        the .xlsx. Falls back to the last-known media id if the page changes."""
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            download_url = self.FALLBACK_DOWNLOAD
            try:
                page = client.get(self.LIST_PAGE)
                if page.status_code == 200:
                    m = re.search(r'href="(/media/\d+/download[^"]*)"', page.text)
                    if m:
                        download_url = self.BASE_URL + m.group(1)
                        self.log.info("Resolved DMF download link", extra={"url": download_url})
                    else:
                        self.log.warning("Download link not found on page; using fallback")
            except Exception as exc:
                self.log.warning("DMF list page fetch failed; using fallback", extra={"error": str(exc)})

            resp = client.get(download_url)
            resp.raise_for_status()
            content = resp.content
            self.log.info("Downloaded DMF workbook", extra={"bytes": len(content)})
            return content

    # ── normalize ─────────────────────────────────────────────────────────--
    def normalize(self, raw: bytes) -> list[dict]:
        if not raw:
            return []

        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)

        # The first row is a title banner ("1Q2026-EXCEL"); the real header is
        # the first row whose cells include "DMF#".
        header: tuple | None = None
        for row in it:
            cells = [str(c).strip().upper() if c is not None else "" for c in row]
            if any(c.startswith("DMF") for c in cells):
                header = tuple(cells)
                break
        if not header:
            self.log.error("DMF header row not found")
            return []

        def col(*names: str) -> int | None:
            for nm in names:
                for i, h in enumerate(header):
                    if nm in h:
                        return i
            return None

        i_num = col("DMF")
        i_status = col("STATUS")
        i_type = col("TYPE")
        i_date = col("SUBMIT")
        i_holder = col("HOLDER")
        i_subject = col("SUBJECT", "TITLE")
        if i_holder is None or i_subject is None or i_type is None or i_status is None:
            self.log.error("DMF columns missing", extra={"header": header})
            return []

        seen: set[tuple[str, str]] = set()
        events: list[dict] = []
        scanned = 0
        for row in it:
            scanned += 1
            typ = (str(row[i_type]).strip().upper() if row[i_type] else "")
            status = (str(row[i_status]).strip().upper() if row[i_status] else "")
            if typ != self.WANT_TYPE or status != self.WANT_STATUS:
                continue

            holder = (str(row[i_holder]).strip() if row[i_holder] else "")
            subject_raw = (str(row[i_subject]).strip() if row[i_subject] else "")
            if not holder or not subject_raw:
                continue

            generic = self._clean_subject(subject_raw)
            if not generic:
                continue

            key = (generic.lower(), holder.lower())
            if key in seen:
                continue
            seen.add(key)

            events.append({
                "generic_name": generic,
                "manufacturer_name": self._titlecase_company(holder),
                "dmf_number": (str(row[i_num]).strip() if i_num is not None and row[i_num] is not None else None),
                "submit_date": self._iso_date(row[i_date]) if i_date is not None else None,
                "subject_raw": subject_raw,
            })

        self.log.info(
            "Normalised active Type II DMFs",
            extra={"scanned": scanned, "supplier_rows": len(events)},
        )
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
                self.log.warning("Batch insert failed", extra={"error": str(exc), "size": len(batch)})
            batch = []

        for ev in events:
            generic = ev["generic_name"]
            holder = ev["manufacturer_name"]

            # Resolve the drug first so the stored generic_name (canonical when
            # matched) is what we de-duplicate on — otherwise reruns re-insert
            # prefix-matched rows whose stored name differs from the subject.
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
                # Canonical drug name when matched so the resilience route's
                # generic_name.ilike join is exact.
                "generic_name": stored_generic,
                "manufacturer_name": holder,
                "country": None,  # not in the DMF list — see module docstring
                "capabilities": ["API manufacture (FDA DMF Type II)"],
                "cep_holder": False,
                "dmf_holder": True,
                "who_pq": False,
                "source": "fda_dmf",
                "source_url": self.LIST_PAGE,
                "raw_data": {
                    "dmf_number": ev.get("dmf_number"),
                    "submit_date": ev.get("submit_date"),
                    "subject": ev.get("subject_raw"),
                    "dmf_type": "II",
                    "dmf_status": "Active",
                },
            })
            if len(batch) >= self.INSERT_CHUNK:
                flush()
        flush()

        return counts

    # ── helpers ───────────────────────────────────────────────────────────--
    def _clean_subject(self, subject: str) -> str:
        s = subject.strip()
        s = re.sub(r"\([^)]*\)", " ", s)          # drop parentheticals
        s = re.sub(r"\d+(\.\d+)?\s*%", " ", s)     # drop "5%"
        s = s.replace("&", " ")
        s = re.sub(r"[^A-Za-z0-9\s\-/]", " ", s)   # keep words/digits/-/
        tokens = [t for t in re.split(r"\s+", s) if t]
        kept: list[str] = []
        for t in tokens:
            tl = t.lower().strip("-/")
            if tl in self._NOISE_TOKENS:
                continue
            if tl.isdigit():                        # standalone grade numbers
                continue
            kept.append(t)
        cleaned = " ".join(kept).strip(" -/").lower()
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned

    @staticmethod
    def _titlecase_company(name: str) -> str:
        # Keep common all-caps legal suffixes uppercase; title-case the rest.
        keep_upper = {"LLC", "INC", "LTD", "LP", "PLC", "AG", "SA", "SPA", "USA", "GMBH", "BV", "NV", "AB", "PVT", "CO"}
        out = []
        for w in name.split():
            stripped = w.strip(".,")
            if stripped.upper() in keep_upper:
                out.append(stripped.upper())
            elif w.isupper() and len(w) > 1:
                out.append(w.title())
            else:
                out.append(w)
        return " ".join(out)

    @staticmethod
    def _iso_date(raw: Any) -> str | None:
        if not raw:
            return None
        if isinstance(raw, (datetime, date)):
            return raw.date().isoformat() if isinstance(raw, datetime) else raw.isoformat()
        s = str(raw).strip()
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return None

    def _load_drug_index(self) -> tuple[dict[str, tuple[str, str]], dict[str, list[tuple[str, str, str]]]]:
        """Preload (id, generic_name, generic_name_normalised) for all drugs once.
        Returns an exact-match dict and a first-word prefix index."""
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
        """Existing (generic_name, manufacturer_name) keys for source='fda_dmf',
        so reruns are idempotent without a DB unique constraint."""
        keys: set[tuple[str, str]] = set()
        page = 0
        size = 1000
        while True:
            resp = (
                self.db.table("api_suppliers")
                .select("generic_name, manufacturer_name")
                .eq("source", "fda_dmf")
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

    @staticmethod
    def _match_drug(
        norm: str,
        exact: dict[str, tuple[str, str]],
        prefix: dict[str, list[tuple[str, str, str]]],
    ) -> tuple[str | None, str | None]:
        if norm in exact:
            did, name = exact[norm]
            return did, name
        fw = norm.split()[0].rstrip(";,") if norm else ""
        if len(fw) >= 4 and fw in prefix:
            # Accept only token-boundary prefix matches: the candidate's full
            # name must be a leading whole-word segment of the DMF subject
            # (e.g. "metoprolol" ⊂ "metoprolol tartrate"). This catches salt
            # forms while rejecting same-first-word false positives such as
            # "zinc omadine" → "zinc sulfate". Prefer the longest (most
            # specific) qualifying candidate.
            best: tuple[str, str] | None = None
            best_len = -1
            for cand_norm, did, name in prefix[fw]:
                # Don't let a distinct compound ("zinc omadine") collapse onto a
                # bare element/class drug ("zinc") via prefix; exact still works.
                if cand_norm in FDADMFScraper._GENERIC_PREFIX_DENY:
                    continue
                if norm == cand_norm or norm.startswith(cand_norm + " "):
                    if len(cand_norm) > best_len:
                        best, best_len = (did, name), len(cand_norm)
            if best:
                return best
        return None, None

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
                "records_processed": counts.get("inserted", 0),
                "matched_to_drug": counts.get("matched_to_drug", 0),
                "existing": counts.get("existing", 0),
                "errors": counts.get("errors", 0),
                "finished_at": finished_at.isoformat(),
            }
        except Exception as exc:
            self.log.error("FDA DMF run failed", extra={"error": str(exc)})
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
        print("DRY RUN — FDA Drug Master Files")
        print("=" * 60)
        scraper = FDADMFScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  Workbook bytes      : {len(raw):,}")
        events = scraper.normalize(raw)
        print(f"  Active Type II rows : {len(events):,}")
        uniq_subj = len({e['generic_name'] for e in events})
        uniq_holder = len({e['manufacturer_name'] for e in events})
        print(f"  Unique substances   : {uniq_subj:,}")
        print(f"  Unique manufacturers: {uniq_holder:,}")
        print("  Sample rows:")
        for e in events[:8]:
            print(f"    {e['generic_name'][:34]:34s}  ←  {e['manufacturer_name'][:38]}")
        sys.exit(0)

    scraper = FDADMFScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
