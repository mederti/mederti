"""
EDQM CEP (Certificate of Suitability) Holders
─────────────────────────────────────────────
Source: European Directorate for the Quality of Medicines (EDQM)
        Certification Online Database
URL:    https://extranet.edqm.eu/4DLink1/4DCGI/Query_CEP

A CEP (Certificate of Suitability to the European Pharmacopoeia) shows that
a manufacturer's active substance meets the Ph. Eur. monograph. EU marketing
authorisations reference CEPs for their API, so the set of VALID CEP holders
for a substance is the closest public census of who can supply that API into
Europe — the EU counterpart to the FDA DMF Type II list (fda_dmf).

How we fetch
────────────
The database has no documented API or bulk export. Its search form is a plain
GET to /4DLink1/4DCGI/Query_CEP; a "Substance Name contains X" query returns
every certificate for that substance (valid and historic) in one HTML table.
A status-wide query ("Status = VALID") is capped at 100 rows, so we query per
substance instead. The substance list is the drugs already linked to an API
supplier (fda_dmf / who_pq) — those are the molecules whose supplier census
the resilience widget shows — plus a small hand-picked fallback list.

Honest limitations
──────────────────
  • EDQM substance names follow the Ph. Eur. monograph (e.g. "Paracetamol",
    "Amoxicillin trihydrate"). US-named drugs ("acetaminophen") get no match.
  • A substance match requires the monograph name to BE the drug name or the
    drug name followed by a salt/form word ("amoxicillin" ⊂ "amoxicillin
    trihydrate"). "Contains" false positives are dropped.
  • Only Chemical certificates (incl. Chemical+TSE "double") count as API
    suppliers; TSE-only and Herbal certificates are skipped.
  • Only status "Valid" rows are stored. Holders whose CEPs are all withdrawn,
    suspended or expired are not suppliers; a previously stored row whose CEP
    is no longer valid is removed on the next run for that substance.
  • Holder country is the ISO-2 code EDQM prints after the holder's city —
    it is the holder's address, which is usually but not always the site.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.edqm_cep_scraper   # preview, no writes
    python3 -m backend.scrapers.edqm_cep_scraper                     # live
    python3 run_all_scrapers.py edqm_cep                             # via runner
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class EDQMCEPScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000094"
    SOURCE_NAME:  str = "EDQM CEP — EU API Manufacturer Register"
    BASE_URL:     str = "https://extranet.edqm.eu"
    COUNTRY:      str = "European Union"
    COUNTRY_CODE: str = "EU"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "2.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "text/html",
    }

    QUERY_URL: str = "https://extranet.edqm.eu/4DLink1/4DCGI/Query_CEP"
    SOURCE_URL: str = "https://extranet.edqm.eu/publications/recherches_CEP.shtml"

    # Fallback when the DB substance list can't be loaded (Ph. Eur. names).
    FALLBACK_SUBSTANCES = [
        "amoxicillin", "azithromycin", "ceftriaxone", "ciprofloxacin",
        "vancomycin", "fluconazole", "metformin", "atorvastatin",
        "amlodipine", "lisinopril", "warfarin", "clopidogrel",
        "omeprazole", "lansoprazole", "salbutamol", "prednisolone",
        "levothyroxine", "paracetamol", "ibuprofen", "morphine",
        "fentanyl", "ketamine", "propofol", "lidocaine",
        "cisplatin", "carboplatin", "doxorubicin", "methotrexate",
        "fluorouracil", "paclitaxel", "tamoxifen", "imatinib",
        "tacrolimus", "ciclosporin", "mycophenolate mofetil",
        "atenolol", "carvedilol", "bisoprolol", "ramipril",
        "enalapril", "losartan", "furosemide", "spironolactone",
        "diazepam", "lorazepam", "fluoxetine", "sertraline",
        "olanzapine", "risperidone", "lithium carbonate", "valproic acid",
        "carbamazepine", "phenytoin", "lamotrigine", "levetiracetam",
    ]

    _CEP_NO = re.compile(r"\b(?:R\d-)?CEP\s+\d{4}-\d{3}\b(?:\s*-\s*Rev\s*\d+)?")
    _TRAILING_CC = re.compile(r"\s([A-Z]{2})$")

    # ── fetch ────────────────────────────────────────────────────────────────
    def fetch(self) -> dict:
        """Returns {"by_substance": {drug_name: [row cells, ...]},
        "queried": [names whose query succeeded]}. Parsed rows, not HTML,
        so nothing large is held across ~1,200 queries."""
        substances = self._load_substances()
        by_substance: dict[str, list[list[str]]] = {}
        queried: list[str] = []
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            for i, name in enumerate(substances):
                try:
                    resp = client.get(self.QUERY_URL, params={
                        "vSelectName": "1",      # Substance Name
                        "Case_TSE": "none",
                        "vContains": "1",        # contains
                        "vContainsDate": "1",
                        "vtsubName": name,
                        "SWTP": "1",
                        "OK": "Search",
                    })
                    if resp.status_code != 200:
                        self.log.warning("EDQM query non-200", extra={"substance": name, "status": resp.status_code})
                        continue
                    rows = self._parse_rows(resp.text)
                    if rows is None:
                        self.log.warning("EDQM result page unrecognised", extra={"substance": name})
                        continue
                    queried.append(name)
                    if rows:
                        by_substance[name] = rows
                except Exception as exc:
                    self.log.warning("EDQM fetch failed", extra={"substance": name, "error": str(exc)})
                if i and i % 100 == 0:
                    self.log.info("EDQM progress", extra={"done": i, "of": len(substances)})
                time.sleep(self.RATE_LIMIT_DELAY)
        self.log.info("EDQM fetched", extra={"queried": len(queried), "of": len(substances), "with_rows": len(by_substance)})
        return {"by_substance": by_substance, "queried": queried, "attempted": len(substances)}

    def _load_substances(self) -> list[str]:
        names: set[str] = set()
        try:
            page, size = 0, 1000
            while True:
                rows = (
                    self.db.table("api_suppliers")
                    .select("generic_name")
                    .not_.is_("drug_id", "null")
                    .in_("source", ["fda_dmf", "who_pq"])
                    .range(page * size, page * size + size - 1)
                    .execute()
                ).data or []
                for r in rows:
                    n = (r.get("generic_name") or "").strip().lower()
                    if len(n) >= 4:
                        names.add(n)
                if len(rows) < size:
                    break
                page += 1
        except Exception as exc:
            self.log.warning("Could not load substance list; using fallback", extra={"error": str(exc)})
        names.update(self.FALLBACK_SUBSTANCES)
        return sorted(names)

    def _parse_rows(self, html: str) -> list[list[str]] | None:
        """Result rows as cell-text lists, or None if the page isn't a result
        page (e.g. the bare search form came back)."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text(" ", strip=True)
        if "records matching your search" not in text and "No record" not in text:
            return None
        out: list[list[str]] = []
        for tr in soup.find_all("tr"):
            if tr.find("table"):
                continue  # layout wrapper, not a data row
            cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            if len(cells) >= 10 and any(self._CEP_NO.search(c) for c in cells):
                out.append(cells)
        return out

    # ── normalize ────────────────────────────────────────────────────────────
    def normalize(self, raw: dict) -> list[dict]:
        """One event per (drug, holder) with all of that holder's valid
        chemical CEPs for the drug."""
        grouped: dict[tuple[str, str], dict] = {}
        for drug, rows in (raw.get("by_substance") or {}).items():
            for cells in rows:
                ev = self._row_to_cert(cells)
                if not ev or ev["status"].lower() != "valid":
                    continue
                if "chemical" not in ev["cep_type"].lower():
                    continue
                if not self._substance_matches(drug, ev["substance"]):
                    continue
                key = (drug, ev["holder"].lower())
                g = grouped.setdefault(key, {
                    "drug": drug,
                    "holder": ev["holder"],
                    "country": ev["country"],
                    "certificates": [],
                })
                g["certificates"].append({
                    "cep_number": ev["cep_number"],
                    "substance": ev["substance"],
                    "monograph": ev["monograph"],
                    "cep_type": ev["cep_type"],
                    "issue_date": ev["issue_date"],
                    "holder_raw": ev["holder_raw"],
                })
        events = list(grouped.values())
        self.log.info("EDQM normalised", extra={"suppliers": len(events)})
        return events

    def _row_to_cert(self, cells: list[str]) -> dict | None:
        # Columns: Monograph | Substance | Type | Holder (name city CC) |
        #          SPOR IDs | CEP number | Issue date | Status | Renewal |
        #          End date | Closure date
        cep_idx = next((i for i, c in enumerate(cells) if self._CEP_NO.search(c)), None)
        if cep_idx is None or cep_idx < 4 or cep_idx + 2 >= len(cells):
            return None
        holder_raw = cells[3].strip()
        m = self._TRAILING_CC.search(holder_raw)
        country = m.group(1) if m else None
        return {
            "monograph": cells[0].strip(" ."),
            "substance": cells[1].strip(),
            "cep_type": cells[2].strip(),
            "holder_raw": holder_raw,
            "holder": self._holder_name(holder_raw[: m.start()].strip() if m else holder_raw),
            "country": country,
            "cep_number": self._CEP_NO.search(cells[cep_idx]).group(0),
            "issue_date": self._iso(cells[cep_idx + 1]),
            "status": cells[cep_idx + 2].strip(),
        }

    # Legal-form words that end a company name. The holder cell is
    # "<name> <city> <CC>" in one text node; cutting after the last legal-form
    # word drops the city ("LUPIN LIMITED Mumbai" → "LUPIN LIMITED") so names
    # line up with fda_dmf holders. No legal-form word → keep name + city.
    _LEGAL_FORM = re.compile(
        r"^(.*\b(?:LIMITED|LTD\.?|INC\.?|CORP(?:ORATION)?\.?|LLC|LLP|GMBH|AG|S\.?A\.?S?\.?|"
        r"S\.?P\.?A\.?|S\.?R\.?L\.?|S\.?L\.?|B\.?V\.?|N\.?V\.?|A/S|AB|OY|PLC|PVT\.?|CO\.,? ?LTD\.?|KG|SE|KFT\.?|"
        r"SP\. Z O\.O\.|D\.O\.O\.|A\.S\.)(?=\s|$))",
        re.IGNORECASE,
    )

    @classmethod
    def _holder_name(cls, name_and_city: str) -> str:
        m = cls._LEGAL_FORM.match(name_and_city)
        return (m.group(1) if m else name_and_city).strip(" ,")[:200]

    @staticmethod
    def _substance_matches(drug: str, substance: str) -> bool:
        name = substance.split(",")[0].strip().lower()
        name = re.sub(r"\s+", " ", name)
        return name == drug or name.startswith(drug + " ")

    @staticmethod
    def _iso(raw: str) -> str | None:
        try:
            return datetime.strptime(raw.strip(), "%d/%m/%Y").date().isoformat()
        except ValueError:
            return None

    # ── upsert ───────────────────────────────────────────────────────────────
    def upsert(self, events: list[dict], queried: list[str]) -> dict:
        counts = {"inserted": 0, "updated": 0, "removed": 0, "errors": 0}
        drug_ids = self._load_drug_ids({e["drug"] for e in events})

        existing: dict[tuple[str, str], str] = {}
        page, size = 0, 1000
        while True:
            rows = (
                self.db.table("api_suppliers")
                .select("id, generic_name, manufacturer_name")
                .eq("source", "edqm_cep")
                .range(page * size, page * size + size - 1)
                .execute()
            ).data or []
            for r in rows:
                existing[((r["generic_name"] or "").lower(), (r["manufacturer_name"] or "").lower())] = r["id"]
            if len(rows) < size:
                break
            page += 1

        seen: set[tuple[str, str]] = set()
        for ev in events:
            key = (ev["drug"], ev["holder"].lower())
            seen.add(key)
            drug_id, canonical = drug_ids.get(ev["drug"], (None, None))
            payload = {
                "drug_id": drug_id,
                "generic_name": canonical or ev["drug"],
                "manufacturer_name": ev["holder"],
                "country": ev["country"],
                "capabilities": ["API manufacture (EDQM CEP)"],
                "cep_holder": True,
                "dmf_holder": False,
                "who_pq": False,
                "source": "edqm_cep",
                "source_url": self.SOURCE_URL,
                "raw_data": {"certificates": ev["certificates"], "status": "Valid"},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                row_id = existing.get(((canonical or ev["drug"]).lower(), ev["holder"].lower()))
                if row_id:
                    self.db.table("api_suppliers").update(payload).eq("id", row_id).execute()
                    counts["updated"] += 1
                else:
                    self.db.table("api_suppliers").insert(payload).execute()
                    counts["inserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("EDQM upsert error", extra={"error": str(exc), "holder": ev["holder"]})

        # Remove stored holders that no longer have a valid CEP — but only for
        # substances whose query succeeded this run, so a failed request never
        # deletes good rows.
        queried_canon = {(drug_ids.get(q, (None, None))[1] or q).lower() for q in queried}
        seen_canon = {((drug_ids.get(d, (None, None))[1] or d).lower(), h) for d, h in seen}
        for key, row_id in existing.items():
            if key[0] in queried_canon and key not in seen_canon:
                try:
                    self.db.table("api_suppliers").delete().eq("id", row_id).execute()
                    counts["removed"] += 1
                except Exception as exc:
                    counts["errors"] += 1
                    self.log.warning("EDQM stale-row delete failed", extra={"error": str(exc), "id": row_id})
        return counts

    def _load_drug_ids(self, names: set[str]) -> dict[str, tuple[str, str]]:
        """Exact (case-insensitive) drug match per substance name, reusing the
        drug the DMF/WHO PQ rows already resolved to. No fuzzy matching."""
        out: dict[str, tuple[str, str]] = {}
        page, size = 0, 1000
        while True:
            rows = (
                self.db.table("api_suppliers")
                .select("generic_name, drug_id")
                .not_.is_("drug_id", "null")
                .in_("source", ["fda_dmf", "who_pq"])
                .range(page * size, page * size + size - 1)
                .execute()
            ).data or []
            for r in rows:
                n = (r.get("generic_name") or "").strip()
                if n.lower() in names:
                    out.setdefault(n.lower(), (r["drug_id"], n))
            if len(rows) < size:
                break
            page += 1
        return out

    # ── run (custom: ~1,200 queries; bypass raw_scrapes) ─────────────────────
    def run(self) -> dict:
        started = datetime.now(timezone.utc).isoformat()
        try:
            raw = self.fetch()
            if raw["attempted"] and len(raw["queried"]) < raw["attempted"] * 0.5:
                raise RuntimeError(
                    f"EDQM queries mostly failed ({len(raw['queried'])}/{raw['attempted']}) — "
                    "refusing to upsert a partial census"
                )
            events = self.normalize(raw)
            counts = self.upsert(events, raw["queried"])
            finished_at = datetime.now(timezone.utc)
            self._touch_data_source(finished_at)
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "success",
                "records_found": len(events),
                "records_processed": counts["inserted"] + counts["updated"],
                **counts,
                "finished_at": finished_at.isoformat(),
            }
        except Exception as exc:
            self.log.error("EDQM CEP run failed", extra={"error": str(exc)})
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
    scraper = EDQMCEPScraper()

    if dry_run:
        # Reads the substance list from the DB, queries EDQM, writes nothing.
        limit = int(os.environ.get("EDQM_DRY_RUN_LIMIT", "0") or 0)
        if limit:
            orig = scraper._load_substances
            scraper._load_substances = lambda: orig()[:limit]  # type: ignore[method-assign]
        raw = scraper.fetch()
        events = scraper.normalize(raw)
        print("=" * 60)
        print("DRY RUN — EDQM CEP")
        print("=" * 60)
        print(f"  Substances queried OK : {len(raw['queried'])}/{raw['attempted']}")
        print(f"  With any CEP rows     : {len(raw['by_substance'])}")
        print(f"  Valid chemical holders: {len(events)}")
        print(f"  Substances w/ holders : {len({e['drug'] for e in events})}")
        for e in events[:12]:
            print(f"    {e['drug'][:26]:26s} ← {e['holder'][:40]:40s} {e['country'] or '??'}  ({len(e['certificates'])} CEP)")
        sys.exit(0)

    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
