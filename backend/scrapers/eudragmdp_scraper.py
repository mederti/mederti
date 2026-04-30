"""
GMP Non-Compliance Register (UK MHRA + EU EudraGMDP feed)
─────────────────────────────────────────────────────────
Primary source: MHRA-GMDP XLSX export
   https://cms.mhra.gov.uk/mhra/gmp?f%5B0%5D=gmp_compliance%3ANC&_format=xlsx

The EMA's older NCS spreadsheet was retired; the equivalent UK MHRA
register at cms.mhra.gov.uk publishes the full list of non-compliant
facilities (UK + global) as a downloadable XLSX. MHRA's NCS process
mirrors EudraGMDP and the data feeds into the same EU-wide pool.

This is the European equivalent of the FDA's Warning Letter / OAI list
and is the strongest leading indicator we have for EU/UK shortages.

Coverage: every site MHRA inspectors have classified as non-compliant.
Updated weekly by MHRA.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class EudraGMDPScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000093"
    SOURCE_NAME:  str = "EMA EudraGMDP — EU GMP Non-Compliance"
    BASE_URL:     str = "https://www.ema.europa.eu"
    COUNTRY:      str = "European Union"
    COUNTRY_CODE: str = "EU"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; MedertiScraper/1.0; +https://mederti.com)",
        "Accept": "*/*",
    }

    NCS_URL: str = "https://cms.mhra.gov.uk/mhra/gmp?_format=xlsx"

    def fetch(self) -> dict:
        # Keep bytes off the raw_scrapes log (not JSON-serializable).
        # We stash them on the instance and return only metadata.
        self._xlsx_bytes: bytes | None = None
        result: dict = {"source_url": self.NCS_URL, "bytes": 0, "status": None}
        with httpx.Client(headers=self.HEADERS, timeout=self.REQUEST_TIMEOUT, follow_redirects=True) as client:
            try:
                resp = client.get(self.NCS_URL)
                result["status"] = resp.status_code
                if resp.status_code == 200 and len(resp.content) > 1000:
                    self._xlsx_bytes = resp.content
                    result["bytes"] = len(resp.content)
                    self.log.info("Fetched MHRA GMDP xlsx", extra={"bytes": len(resp.content)})
                else:
                    self.log.warning(
                        "MHRA GMDP unavailable",
                        extra={"status": resp.status_code, "bytes": len(resp.content)},
                    )
            except Exception as exc:
                self.log.warning("MHRA GMDP fetch failed", extra={"error": str(exc)})
        return result

    def normalize(self, raw: dict) -> list[dict]:
        events: list[dict] = []
        xlsx_bytes = getattr(self, "_xlsx_bytes", None)
        if not xlsx_bytes:
            return events

        try:
            import openpyxl  # part of pandas/standard distrib
        except Exception:
            self.log.warning("openpyxl not available — cannot parse EU GMP NCS xlsx")
            return events

        try:
            wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
            for sh in wb.worksheets:
                rows = list(sh.iter_rows(values_only=True))
                if not rows:
                    continue
                # Locate header row — MHRA puts header at row 5 with "Certificate Number" leading
                header_idx = 0
                for i, r in enumerate(rows[:12]):
                    cells = [str(c).lower() if c else "" for c in r]
                    if any("certificate" in c for c in cells) and any("country" in c for c in cells):
                        header_idx = i
                        break
                headers = [str(c).strip() if c else "" for c in rows[header_idx]]
                hmap = {h.lower(): i for i, h in enumerate(headers)}

                def col(row, *names) -> str | None:
                    for n in names:
                        for k, idx in hmap.items():
                            if n.lower() in k:
                                v = row[idx] if idx < len(row) else None
                                if v not in (None, ""):
                                    return str(v).strip()
                    return None

                for r in rows[header_idx + 1:]:
                    if not r or all(c in (None, "") for c in r):
                        continue

                    cert = col(r, "Certificate Number")
                    compliance = (col(r, "GMPC", "Non-compliance", "Compliance") or "").upper()
                    site_details = col(r, "Site Details") or ""
                    country = col(r, "Country") or "GB"
                    date_str = col(r, "Inspection Date", "Date")

                    # Site details look like:
                    #   "● MACARTHYS LABORATORIES ... ROMFORD, RM3 8UG, UNITED KINGDOM"
                    site_clean = site_details.replace("●", "").replace("•", "").strip()
                    site_parts = [p.strip() for p in site_clean.split(",")]
                    name = site_parts[0][:200] if site_parts else "Unknown facility"
                    city = site_parts[-3].strip()[:80] if len(site_parts) >= 3 else None

                    classification = "OAI" if "NON" in compliance or "NC" in compliance else "NAI"
                    is_compliant = "GMPC" in compliance and "NON" not in compliance

                    parsed = self._parse_date(date_str)

                    events.append({
                        "fei_number": cert[:60] if cert else None,
                        "duns_number": None,
                        "facility_name": name,
                        "company_name": name,
                        "country": self._country_to_iso(country) or country[:2].upper(),
                        "state_or_region": None,
                        "city": city,
                        "facility_type": None,
                        "last_inspection_date": parsed,
                        "last_inspection_classification": classification,
                        "gmp_certified": is_compliant,
                        "gmp_authority": "MHRA",
                        "warning_letter_count_5y": 0 if is_compliant else 1,
                        "source": "mhra_gmdp",
                        "source_url": self.NCS_URL,
                        "raw_data": {
                            h: (str(r[i]) if i < len(r) and r[i] is not None else None)
                            for i, h in enumerate(headers)
                        },
                    })
        except Exception as exc:
            self.log.warning("Failed to parse MHRA GMDP xlsx", extra={"error": str(exc)})

        self.log.info("Normalised EU GMP NCS events", extra={"count": len(events)})
        return events

    @staticmethod
    def _country_to_iso(name: str | None) -> str | None:
        if not name:
            return None
        m = {
            "austria": "AT", "belgium": "BE", "bulgaria": "BG", "croatia": "HR",
            "cyprus": "CY", "czech republic": "CZ", "czechia": "CZ", "denmark": "DK",
            "estonia": "EE", "finland": "FI", "france": "FR", "germany": "DE",
            "greece": "GR", "hungary": "HU", "iceland": "IS", "ireland": "IE",
            "italy": "IT", "latvia": "LV", "liechtenstein": "LI", "lithuania": "LT",
            "luxembourg": "LU", "malta": "MT", "netherlands": "NL", "norway": "NO",
            "poland": "PL", "portugal": "PT", "romania": "RO", "slovakia": "SK",
            "slovenia": "SI", "spain": "ES", "sweden": "SE", "switzerland": "CH",
            "united kingdom": "GB", "uk": "GB", "india": "IN", "china": "CN",
            "united states": "US", "usa": "US",
        }
        return m.get(name.strip().lower())

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        if not raw:
            return None
        if isinstance(raw, date):
            return raw.isoformat()
        s = str(raw).strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %B %Y", "%b %d, %Y", "%d %b %Y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return None

    def upsert(self, events: list[dict]) -> dict:
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}
        for ev in events:
            try:
                existing = None
                # Match by (facility_name + country) since NCS has no FEI
                if ev.get("facility_name"):
                    r = (
                        self.db.table("manufacturing_facilities")
                        .select("id, warning_letter_count_5y, oai_count_5y")
                        .eq("facility_name", ev["facility_name"])
                        .eq("country", ev.get("country", "EU"))
                        .limit(1)
                        .execute()
                    )
                    if r.data:
                        existing = r.data[0]

                payload = {
                    "facility_name": ev["facility_name"],
                    "company_name": ev.get("company_name"),
                    "country": ev.get("country", "EU"),
                    "state_or_region": ev.get("state_or_region"),
                    "city": ev.get("city"),
                    "facility_type": ev.get("facility_type"),
                    "last_inspection_date": ev.get("last_inspection_date"),
                    "last_inspection_classification": ev.get("last_inspection_classification", "OAI"),
                    "gmp_certified": ev.get("gmp_certified", False),
                    "gmp_authority": ev.get("gmp_authority", "EU"),
                    "source": ev.get("source", "eudragmdp_ncs"),
                    "source_url": ev.get("source_url"),
                    "raw_data": ev.get("raw_data"),
                }

                if existing:
                    payload["warning_letter_count_5y"] = (
                        existing.get("warning_letter_count_5y", 0) or 0
                    ) + (ev.get("warning_letter_count_5y", 0) or 0)
                    payload["oai_count_5y"] = (existing.get("oai_count_5y", 0) or 0) + 1
                    self.db.table("manufacturing_facilities").update(payload).eq("id", existing["id"]).execute()
                    counts["status_changes"] += 1
                else:
                    payload["warning_letter_count_5y"] = ev.get("warning_letter_count_5y", 1)
                    payload["oai_count_5y"] = 1
                    self.db.table("manufacturing_facilities").insert(payload).execute()
                    counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("EudraGMDP upsert error", extra={"error": str(exc), "facility": ev.get("facility_name")})

        return counts


if __name__ == "__main__":
    EudraGMDPScraper().run()
