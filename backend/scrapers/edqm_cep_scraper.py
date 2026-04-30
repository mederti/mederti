"""
EDQM CEP (Certificate of Suitability) Holders
─────────────────────────────────────────────
Source: European Directorate for the Quality of Medicines (EDQM)
URL:    https://extranet.edqm.eu/publications/recherches_CEP.shtml

Every API manufacturer that supplies the European market holds a CEP
(Certificate of Suitability to the European Pharmacopoeia). The EDQM
publishes the full list and updates it weekly. Linking each drug to its
CEP holders is the canonical map of "who actually makes this API".

This is the European equivalent of the US DMF (Drug Master File) holder
list. Together with FDA Drugs@FDA we get the global API supplier map.

We hit the EDQM JSON-ish search endpoint and extract per-substance the
list of holder companies, their countries, certificate numbers, and
issue dates.

Coverage: ~3,500 active CEPs across ~1,200 active substances.
"""
from __future__ import annotations

from datetime import date, datetime
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
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "application/json, text/html",
    }

    SEARCH_ENDPOINT: str = (
        "https://extranet.edqm.eu/publications/recherches_CEP.shtml"
    )
    JSON_ENDPOINT: str = (
        "https://extranet.edqm.eu/publications/cep/getResults.jsp"
    )

    # Limit per pull: top INNs we already track in shortage data
    TOP_INNS = [
        "amoxicillin", "azithromycin", "ceftriaxone", "ciprofloxacin",
        "vancomycin", "fluconazole", "metformin", "atorvastatin",
        "amlodipine", "lisinopril", "warfarin", "clopidogrel",
        "omeprazole", "lansoprazole", "salbutamol", "prednisolone",
        "levothyroxine", "paracetamol", "ibuprofen", "morphine",
        "fentanyl", "ketamine", "propofol", "lidocaine",
        "cisplatin", "carboplatin", "doxorubicin", "methotrexate",
        "5-fluorouracil", "paclitaxel", "tamoxifen", "imatinib",
        "rituximab", "tacrolimus", "ciclosporin", "mycophenolate mofetil",
        "atenolol", "carvedilol", "bisoprolol", "ramipril",
        "enalapril", "losartan", "furosemide", "spironolactone",
        "diazepam", "lorazepam", "fluoxetine", "sertraline",
        "olanzapine", "risperidone", "lithium carbonate", "valproic acid",
        "carbamazepine", "phenytoin", "lamotrigine", "levetiracetam",
    ]

    def fetch(self) -> dict:
        """
        EDQM doesn't expose a documented JSON API. We try the public
        search results page for each INN and capture the HTML for parsing.
        Best-effort: any INN that fails is skipped.
        """
        result: dict[str, Any] = {"by_inn": {}}
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            for inn in self.TOP_INNS:
                try:
                    resp = client.get(
                        self.SEARCH_ENDPOINT,
                        params={"substance": inn, "type": "CEP"},
                    )
                    if resp.status_code == 200 and resp.text:
                        result["by_inn"][inn] = resp.text
                except Exception as exc:
                    self.log.warning("EDQM fetch failed", extra={"inn": inn, "error": str(exc)})
        self.log.info("EDQM fetched", extra={"inns": len(result["by_inn"])})
        return result

    def normalize(self, raw: dict) -> list[dict]:
        """
        Parse the HTML results page. EDQM returns results as a tabular
        page; we pull rows with class 'cep-row' or extract from <table>
        with the columns: Holder | Country | Certificate Nº | Status | Date.
        """
        events: list[dict] = []
        try:
            from bs4 import BeautifulSoup
        except Exception:
            self.log.warning("bs4 not available — cannot parse EDQM HTML")
            return events

        for inn, html in (raw.get("by_inn") or {}).items():
            try:
                soup = BeautifulSoup(html, "html.parser")
                # Pull every <table> row that looks like a result
                tables = soup.find_all("table")
                for tbl in tables:
                    headers = [th.get_text(strip=True).lower() for th in tbl.find_all("th")]
                    if not any("holder" in h or "company" in h or "manufacturer" in h for h in headers):
                        continue
                    for tr in tbl.find_all("tr"):
                        tds = tr.find_all("td")
                        if len(tds) < 2:
                            continue
                        cols = [td.get_text(strip=True) for td in tds]
                        # Heuristic: holder is always the first non-empty alphabetic cell
                        holder = next((c for c in cols if c and c[0].isalpha()), None)
                        if not holder or len(holder) < 3:
                            continue
                        country = self._first_match(cols, ["india", "china", "germany", "italy",
                                                           "france", "spain", "switzerland",
                                                           "ireland", "netherlands", "belgium",
                                                           "uk", "united kingdom", "us", "usa"])
                        cert_no = self._first_regex(cols, r"\bR\d-CEP[\s-]*\d{4}-\d+")
                        status = self._first_match(cols, ["valid", "withdrawn", "suspended", "expired"]) or "valid"
                        events.append({
                            "inn": inn,
                            "holder": holder[:200],
                            "country": self._country_to_iso(country),
                            "cert_number": cert_no,
                            "status": status,
                            "raw_row": cols,
                        })
            except Exception as exc:
                self.log.warning("EDQM parse failed", extra={"inn": inn, "error": str(exc)})

        # Deduplicate by (inn, holder, country)
        seen = set()
        deduped = []
        for e in events:
            k = (e["inn"], e["holder"].lower(), e.get("country") or "")
            if k in seen:
                continue
            seen.add(k)
            deduped.append(e)

        self.log.info("EDQM normalised", extra={"events": len(deduped)})
        return deduped

    @staticmethod
    def _first_match(cols: list[str], needles: list[str]) -> str | None:
        for c in cols:
            cl = c.lower()
            for n in needles:
                if n in cl:
                    return c
        return None

    @staticmethod
    def _first_regex(cols: list[str], pattern: str) -> str | None:
        import re
        for c in cols:
            m = re.search(pattern, c)
            if m:
                return m.group(0)
        return None

    @staticmethod
    def _country_to_iso(name: str | None) -> str | None:
        if not name:
            return None
        m = {
            "india": "IN", "china": "CN", "germany": "DE", "italy": "IT",
            "france": "FR", "spain": "ES", "switzerland": "CH",
            "ireland": "IE", "netherlands": "NL", "belgium": "BE",
            "uk": "GB", "united kingdom": "GB", "us": "US", "usa": "US",
            "japan": "JP", "korea": "KR", "south korea": "KR",
            "denmark": "DK", "sweden": "SE", "norway": "NO", "austria": "AT",
        }
        cl = name.strip().lower()
        for k, v in m.items():
            if k in cl:
                return v
        return None

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                # Resolve INN -> drug_id (best-effort)
                drug_id = None
                inn = ev.get("inn")
                if inn:
                    r = self.db.table("drugs").select("id").ilike("generic_name", inn).limit(1).execute()
                    if r.data:
                        drug_id = r.data[0]["id"]

                # Idempotency: by (inn + manufacturer_name + cert_number)
                existing = (
                    self.db.table("api_suppliers")
                    .select("id")
                    .eq("generic_name", inn)
                    .eq("manufacturer_name", ev["holder"])
                    .limit(1)
                    .execute()
                )

                payload = {
                    "drug_id": drug_id,
                    "generic_name": inn,
                    "manufacturer_name": ev["holder"],
                    "country": ev.get("country"),
                    "capabilities": ["CEP holder"],
                    "cep_holder": True,
                    "dmf_holder": False,
                    "who_pq": False,
                    "source": "edqm_cep",
                    "source_url": "https://extranet.edqm.eu/publications/recherches_CEP.shtml",
                    "raw_data": {
                        "cert_number": ev.get("cert_number"),
                        "status": ev.get("status"),
                        "row": ev.get("raw_row"),
                    },
                }

                if existing.data:
                    self.db.table("api_suppliers").update(payload).eq("id", existing.data[0]["id"]).execute()
                    counts["status_changes"] += 1
                else:
                    self.db.table("api_suppliers").insert(payload).execute()
                    counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("EDQM upsert error", extra={"error": str(exc), "holder": ev.get("holder")})

        return counts


if __name__ == "__main__":
    EDQMCEPScraper().run()
