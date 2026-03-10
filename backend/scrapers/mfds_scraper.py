"""
MFDS Korean Drug Shortage Scraper
───────────────────────────────────
Source:  MFDS — Ministry of Food and Drug Safety (South Korea)
URL:     https://nedrug.mfds.go.kr/pbp/CCBGA01

Data access
───────────
MFDS provides a web portal for drug supply disruption info at:
    https://nedrug.mfds.go.kr/pbp/CCBGA01

The underlying API endpoints:
    POST https://nedrug.mfds.go.kr/pbp/CCBGA01/getItemList
    Params: itemName, startDt, endDt, page, limit

Response JSON structure:
    {
      "result": [
        {
          "ITEM_SEQ": "...",
          "ITEM_NAME": "...품명...",
          "ENTP_NAME": "...회사...",
          "SHORT_REASON": "...사유...",
          "SHORT_START_DE": "20241201",
          "SHORT_END_DE": "20250301"
        }, ...
      ],
      "totalCount": 150
    }

Status: All records from the shortage list are treated as active unless
SHORT_END_DE < today.

Data source UUID:  10000000-0000-0000-0000-000000000033  (MFDS, KR)
Country:           South Korea
Country code:      KR
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class MfdsScraper(BaseScraper):
    """Scraper for MFDS Korean drug supply disruption data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000038"
    SOURCE_NAME:  str = "MFDS (Ministry of Food and Drug Safety, South Korea)"
    BASE_URL:     str = "https://nedrug.mfds.go.kr/pbp/CCBGA01"
    API_URL:      str = "https://nedrug.mfds.go.kr/pbp/CCBGA01/getItemList"
    COUNTRY:      str = "South Korea"
    COUNTRY_CODE: str = "KR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0
    PAGE_SIZE:        int   = 100

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "application/json",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer":         "https://nedrug.mfds.go.kr/pbp/CCBGA01",
        "Content-Type":    "application/x-www-form-urlencoded",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Fetch all MFDS shortage records via POST API.

        Returns:
            {"records": list[dict], "fetched_at": str, "total": int}
        """
        all_records: list[dict] = []
        page = 1
        total = None

        self.log.info("Fetching MFDS shortage data", extra={"url": self.API_URL})

        while True:
            payload = {
                "itemName": "",
                "startDt":  "20200101",
                "endDt":    datetime.now(timezone.utc).strftime("%Y%m%d"),
                "page":     str(page),
                "limit":    str(self.PAGE_SIZE),
            }
            try:
                time.sleep(self.RATE_LIMIT_DELAY)
                with httpx.Client(
                    headers=self._HEADERS,
                    timeout=self.REQUEST_TIMEOUT,
                    follow_redirects=True,
                ) as client:
                    resp = client.post(self.API_URL, data=payload)
                    resp.raise_for_status()

                data = resp.json()

                records = data.get("result", data.get("data", data.get("items", [])))
                if isinstance(records, list) and records:
                    all_records.extend(records)
                else:
                    break

                if total is None:
                    total = data.get("totalCount", data.get("total", len(records)))

                self.log.debug(
                    "MFDS page fetched",
                    extra={"page": page, "count": len(records), "total": total},
                )

                if len(all_records) >= (total or len(all_records)) or len(records) < self.PAGE_SIZE:
                    break
                page += 1

                if page > 50:
                    self.log.warning("MFDS: reached page cap (50)")
                    break

            except httpx.HTTPStatusError as exc:
                self.log.error(
                    "MFDS API error",
                    extra={"status": exc.response.status_code, "page": page},
                )
                # Try GET fallback
                try:
                    resp2 = httpx.get(
                        self.BASE_URL,
                        headers={**self._HEADERS, "Accept": "text/html"},
                        timeout=self.REQUEST_TIMEOUT,
                        follow_redirects=True,
                    )
                    self.log.info("MFDS: GET fallback", extra={"status": resp2.status_code, "bytes": len(resp2.content)})
                except Exception:
                    pass
                break
            except Exception as exc:
                self.log.error("MFDS fetch error", extra={"error": str(exc)})
                break

        self.log.info(
            "MFDS fetch complete",
            extra={"total_records": len(all_records), "pages": page},
        )
        return {
            "records":   all_records,
            "total":     total,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """Convert MFDS records to shortage event dicts."""
        records = raw.get("records", [])
        if not records:
            self.log.warning("MFDS: no records to normalise")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        today_compact = datetime.now(timezone.utc).strftime("%Y%m%d")
        normalised: list[dict] = []
        skipped = 0

        for item in records:
            try:
                # Field names may vary — try common variants
                brand_name = (
                    item.get("ITEM_NAME") or item.get("itemName") or item.get("품명") or ""
                ).strip()

                if not brand_name:
                    skipped += 1
                    continue

                # Korean names are usually brand names; use first word as generic approximation
                generic_name = brand_name.split()[0] if brand_name else ""

                manufacturer = (
                    item.get("ENTP_NAME") or item.get("entpName") or item.get("업체명") or ""
                ).strip()

                reason = (
                    item.get("SHORT_REASON") or item.get("shortReason") or item.get("사유") or ""
                ).strip()

                start_raw = (
                    item.get("SHORT_START_DE") or item.get("startDt") or item.get("시작일") or ""
                ).strip()

                end_raw = (
                    item.get("SHORT_END_DE") or item.get("endDt") or item.get("종료일") or ""
                ).strip()

                start_date = self._parse_yyyymmdd(start_raw) or today
                end_date   = self._parse_yyyymmdd(end_raw)
                status = "resolved" if end_raw and end_raw < today_compact else "active"

                normalised.append({
                    "generic_name":              generic_name,
                    "brand_names":               [brand_name] if brand_name != generic_name else [],
                    "status":                    status,
                    "severity":                  "medium",
                    "reason":                    reason or None,
                    "reason_category":           self._map_reason(reason),
                    "start_date":                start_date,
                    "end_date":                  end_date if status == "resolved" else None,
                    "estimated_resolution_date": end_date if status == "active" else None,
                    "source_url":                self.BASE_URL,
                    "notes": (
                        f"Korean drug supply disruption from MFDS. "
                        f"Product: {brand_name}. "
                        + (f"Manufacturer: {manufacturer}. " if manufacturer else "")
                        + (f"Reason: {reason}." if reason else "")
                    ).strip(),
                    "raw_record": item,
                })
            except Exception as exc:
                skipped += 1
                self.log.warning("MFDS: row error", extra={"error": str(exc)})

        self.log.info(
            "MFDS normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    @staticmethod
    def _parse_yyyymmdd(raw: str) -> str | None:
        """Parse YYYYMMDD or YYYY-MM-DD to ISO-8601."""
        if not raw:
            return None
        compact = raw.replace("-", "").replace("/", "")[:8]
        if len(compact) == 8 and compact.isdigit():
            return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"
        return None

    @staticmethod
    def _map_reason(reason: str) -> str:
        low = reason.lower()
        if any(w in low for w in ["제조", "생산", "manufactur", "production"]):
            return "manufacturing_issue"
        if any(w in low for w in ["원료", "raw material"]):
            return "raw_material_shortage"
        if any(w in low for w in ["수입", "import", "supply", "공급"]):
            return "supply_chain"
        if any(w in low for w in ["수요", "demand"]):
            return "demand_surge"
        return "supply_chain"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — MFDS South Korea"); print("=" * 60)
        scraper = MfdsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  records: {len(raw.get('records', []))}")
        events = scraper.normalize(raw)
        print(f"  events : {len(events)}")
        if events:
            print(f"  sample : {json.dumps({k:v for k,v in events[0].items() if k!='raw_record'}, ensure_ascii=False)}")
        sys.exit(0)
    scraper = MfdsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
