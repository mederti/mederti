"""
UK MHRA GMP register (certificates + non-compliance statements)
───────────────────────────────────────────────────────────────
Source: MHRA-GMDP public site, XLSX export of every GMP certificate and
        non-compliance statement MHRA has issued (UK and overseas sites)
   https://cms.mhra.gov.uk/mhra/gmp?_format=xlsx

Runner key is `mhra_gmdp`. The module/class names say "EudraGMDP" for
history only: EMA's EudraGMDP database has no bulk export, and this file is
MHRA's own register — UK-inspector findings, not EU-wide ones.

What we store (manufacturing_facilities, source='mhra_gmdp'), per site:
  • gmp_certified          — the site's most recent statement is a GMP
                             certificate ("GMPC"), not a non-compliance one
  • last_inspection_date   — date on that most recent statement
  • last_inspection_classification — 'OAI' when that statement is
                             "Non Compliant", else 'NAI'. This maps MHRA's
                             outcome onto the column's FDA vocabulary;
                             gmp_authority='MHRA' marks the origin.
  • oai_count_5y           — number of distinct MHRA non-compliance
                             inspection dates in the last 5 years, recomputed
                             from the file every run, never accumulated
  • warning_letter_count_5y — always 0 here: MHRA does not issue FDA-style
                             warning letters, so we don't claim any.

Coverage: ~1,700 statements, ~1,000 sites; MHRA updates it continuously.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class EudraGMDPScraper(BaseScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000093"
    SOURCE_NAME:  str = "MHRA GMDP — UK GMP certificates & non-compliance"
    BASE_URL:     str = "https://cms.mhra.gov.uk"
    COUNTRY:      str = "United Kingdom"
    COUNTRY_CODE: str = "GB"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "2.0.0"

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
        statements: list[dict] = []
        xlsx_bytes = getattr(self, "_xlsx_bytes", None)
        if not xlsx_bytes:
            return []

        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
        for sh in wb.worksheets:
            rows = list(sh.iter_rows(values_only=True))
            header_idx = None
            for i, r in enumerate(rows[:12]):
                cells = [str(c).lower() if c else "" for c in r]
                if any("certificate" in c for c in cells) and any("country" in c for c in cells):
                    header_idx = i
                    break
            if header_idx is None:
                continue
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
                compliance = (col(r, "GMPC or Non-compliance", "Compliance") or "").strip().lower()
                if compliance not in ("gmpc", "non compliant"):
                    continue
                # "● MARKSANS PHARMA LIMITED, PLOT NO. A-1, ..., VERNA, IN-403722, INDIA"
                site = (col(r, "Site Details") or "").replace("●", "").replace("•", "").strip()
                parts = [p.strip() for p in site.split(",") if p.strip()]
                if not parts:
                    continue
                country_name = col(r, "Country")
                statements.append({
                    "facility_name": parts[0][:200],
                    "city": parts[-3][:80] if len(parts) >= 3 else None,
                    "country": self._country_to_iso(country_name),
                    "country_name": country_name,
                    "non_compliant": compliance == "non compliant",
                    "date": self._parse_date(col(r, "Inspection Date")),
                    "certificate": col(r, "Certificate Number"),
                    "site_details": site,
                })

        # One event per site (name + country), from all its statements.
        five_years_ago = (date.today().replace(year=date.today().year - 5)).isoformat()
        by_site: dict[tuple[str, str | None], list[dict]] = {}
        for st in statements:
            by_site.setdefault((st["facility_name"].lower(), st["country"]), []).append(st)

        events: list[dict] = []
        for sts in by_site.values():
            sts.sort(key=lambda x: x["date"] or "")
            latest = sts[-1]
            # One inspection can yield several statements (e.g. "[H]" human and
            # "[I]" IMP variants on the same date) — count inspection dates.
            nc_5y = len({x["date"] for x in sts if x["non_compliant"] and (x["date"] or "") >= five_years_ago})
            events.append({
                "facility_name": latest["facility_name"],
                "company_name": latest["facility_name"],
                "country": latest["country"],
                "city": latest["city"],
                "last_inspection_date": latest["date"],
                "last_inspection_classification": "OAI" if latest["non_compliant"] else "NAI",
                "gmp_certified": not latest["non_compliant"],
                "oai_count_5y": nc_5y,
                "raw_data": {
                    "country_name": latest["country_name"],
                    "statements": [
                        {"certificate": x["certificate"], "outcome": "Non Compliant" if x["non_compliant"] else "GMPC",
                         "date": x["date"], "site_details": x["site_details"]}
                        for x in sts
                    ],
                },
            })

        self.log.info("Normalised MHRA GMP register", extra={"statements": len(statements), "sites": len(events)})
        return events

    _COUNTRY_ISO = {
        "austria": "AT", "belgium": "BE", "bulgaria": "BG", "croatia": "HR",
        "cyprus": "CY", "czech republic": "CZ", "czechia": "CZ", "denmark": "DK",
        "estonia": "EE", "finland": "FI", "france": "FR", "germany": "DE",
        "greece": "GR", "hungary": "HU", "iceland": "IS", "ireland": "IE",
        "italy": "IT", "latvia": "LV", "liechtenstein": "LI", "lithuania": "LT",
        "luxembourg": "LU", "malta": "MT", "netherlands": "NL", "norway": "NO",
        "poland": "PL", "portugal": "PT", "romania": "RO", "slovakia": "SK",
        "slovenia": "SI", "spain": "ES", "sweden": "SE", "switzerland": "CH",
        "united kingdom": "GB", "uk": "GB", "india": "IN", "china": "CN",
        "united states": "US", "usa": "US", "puerto rico": "PR", "taiwan": "TW",
        "korea, republic of": "KR", "south korea": "KR", "republic of korea": "KR",
        "turkey": "TR", "turkiye": "TR", "türkiye": "TR", "bangladesh": "BD",
        "japan": "JP", "singapore": "SG", "brazil": "BR", "canada": "CA",
        "australia": "AU", "new zealand": "NZ", "israel": "IL", "jordan": "JO",
        "south africa": "ZA", "mexico": "MX", "argentina": "AR", "pakistan": "PK",
        "egypt": "EG", "saudi arabia": "SA", "united arab emirates": "AE",
        "malaysia": "MY", "thailand": "TH", "vietnam": "VN", "viet nam": "VN",
        "indonesia": "ID", "philippines": "PH", "sri lanka": "LK", "nepal": "NP",
        "serbia": "RS", "bosnia and herzegovina": "BA", "north macedonia": "MK",
        "ukraine": "UA", "belarus": "BY", "russia": "RU", "russian federation": "RU",
        "hong kong": "HK", "jersey": "JE", "guernsey": "GG", "isle of man": "IM",
        "barbados": "BB", "kenya": "KE", "morocco": "MA", "tunisia": "TN",
        "iran": "IR", "lebanon": "LB", "uruguay": "UY", "chile": "CL",
        "colombia": "CO", "peru": "PE", "cuba": "CU", "albania": "AL",
        "moldova": "MD", "oman": "OM", "georgia": "GE", "armenia": "AM", "kazakhstan": "KZ",
    }

    @classmethod
    def _country_to_iso(cls, name: str | None) -> str | None:
        """Full-name lookup only. Unknown names return None (the raw name is
        kept in raw_data) — never a guessed first-two-letters code."""
        if not name:
            return None
        return cls._COUNTRY_ISO.get(name.strip().lower())

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
        """Absolute (idempotent) writes, scoped to source='mhra_gmdp' rows so
        FDA-sourced facilities are never overwritten. Matching is by
        facility_name, then country — older runs stored guessed country codes
        ("TA" for Taiwan), so a name-only match is accepted when that is the
        only mhra_gmdp row with the name, which also repairs the code."""
        counts = {"upserted": 0, "errors": 0, "skipped": 0, "status_changes": 0}

        existing: dict[str, list[dict]] = {}
        page, size = 0, 1000
        while True:
            rows = (
                self.db.table("manufacturing_facilities")
                .select("id, facility_name, country")
                .eq("source", "mhra_gmdp")
                .range(page * size, page * size + size - 1)
                .execute()
            ).data or []
            for r in rows:
                existing.setdefault((r["facility_name"] or "").lower(), []).append(r)
            if len(rows) < size:
                break
            page += 1

        for ev in events:
            try:
                cands = existing.get(ev["facility_name"].lower(), [])
                match = next((c for c in cands if c["country"] == ev["country"]), None)
                if match is None and len(cands) == 1:
                    match = cands[0]
                payload = {
                    "facility_name": ev["facility_name"],
                    "company_name": ev["company_name"],
                    "country": ev["country"],
                    "city": ev["city"],
                    "last_inspection_date": ev["last_inspection_date"],
                    "last_inspection_classification": ev["last_inspection_classification"],
                    "gmp_certified": ev["gmp_certified"],
                    "gmp_authority": "MHRA",
                    "oai_count_5y": ev["oai_count_5y"],
                    "warning_letter_count_5y": 0,
                    "source": "mhra_gmdp",
                    "source_url": self.NCS_URL,
                    "raw_data": ev["raw_data"],
                    "updated_at": datetime.now().astimezone().isoformat(),
                }
                if match:
                    self.db.table("manufacturing_facilities").update(payload).eq("id", match["id"]).execute()
                    cands.remove(match)
                    counts["status_changes"] += 1
                else:
                    self.db.table("manufacturing_facilities").insert(payload).execute()
                    counts["upserted"] += 1
            except Exception as exc:
                counts["errors"] += 1
                self.log.warning("MHRA GMDP upsert error", extra={"error": str(exc), "facility": ev.get("facility_name")})

        return counts


    # ── run (custom: binary xlsx, not shortage events; bypass raw_scrapes) ───
    def run(self) -> dict:
        started = datetime.now(timezone.utc).isoformat()
        try:
            raw = self.fetch()
            if not getattr(self, "_xlsx_bytes", None):
                raise RuntimeError(f"MHRA GMDP export unavailable (HTTP {raw.get('status')})")
            events = self.normalize(raw)
            if not events:
                raise RuntimeError("MHRA GMDP export parsed to 0 sites — layout changed?")
            counts = self.upsert(events)
            finished_at = datetime.now(timezone.utc)
            self._touch_data_source(finished_at)
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "success",
                "records_found": len(events),
                "records_processed": counts["upserted"] + counts["status_changes"],
                **counts,
                "finished_at": finished_at.isoformat(),
            }
        except Exception as exc:
            self.log.error("MHRA GMDP run failed", extra={"error": str(exc)})
            return {
                "source": self.SOURCE_NAME,
                "started_at": started,
                "status": "failed",
                "error": str(exc),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }


if __name__ == "__main__":
    import collections
    import json
    import os
    import sys
    from dotenv import load_dotenv

    load_dotenv()
    if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1":
        from unittest.mock import MagicMock
        scraper = EudraGMDPScraper(db_client=MagicMock())
        raw = scraper.fetch()
        events = scraper.normalize(raw)
        print("=" * 60)
        print("DRY RUN — MHRA GMDP register")
        print("=" * 60)
        print(f"  Export bytes        : {raw.get('bytes'):,}")
        print(f"  Sites               : {len(events):,}")
        print(f"  Latest = non-compl. : {sum(1 for e in events if not e['gmp_certified'])}")
        print(f"  Any NC in 5y        : {sum(1 for e in events if e['oai_count_5y'])}")
        print(f"  Unmapped country    : {collections.Counter(e['raw_data']['country_name'] for e in events if not e['country'])}")
        print(f"  Top countries       : {collections.Counter(e['country'] for e in events).most_common(8)}")
        for e in [e for e in events if not e["gmp_certified"]][:8]:
            print(f"    NC  {e['facility_name'][:44]:44s} {e['country']}  {e['last_inspection_date']}  nc5y={e['oai_count_5y']}")
        sys.exit(0)

    summary = EudraGMDPScraper().run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] == "success" else 1)
