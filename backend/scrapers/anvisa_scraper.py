"""
ANVISA Brazilian Drug Shortage Scraper
───────────────────────────────────────
Source:  ANVISA — Agência Nacional de Vigilância Sanitária (Brazil)
URL:     https://consultas.anvisa.gov.br/#/falta/

Data access
───────────
ANVISA provides a REST API for drug shortage (falta) data:

    GET https://consultas.anvisa.gov.br/api/falta/situacao
        Returns: paginated list of shortage situations
        Fields: nomeProduto, situacao, dataInicio, dataFim, motivoFalta,
                categoriaRegulatoriaDescricao, principioAtivo

    GET https://consultas.anvisa.gov.br/api/falta/situacao?page=0&pageSize=100
        Paginated results

Note: ANVISA's public API may enforce CORS or rate limits. Uses httpx with
Referer and Origin headers to mimic browser requests.

Status values (Portuguese):
    "Em falta"         → active
    "Normalizado"      → resolved
    "Parcialmente em falta" → active (partial)

Data source UUID:  10000000-0000-0000-0000-000000000035, BR)
Country:           Brazil
Country code:      BR
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class AnvisaScraper(BaseScraper):
    """Scraper for ANVISA Brazilian drug shortage data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000035"
    SOURCE_NAME:  str = "ANVISA (Brazilian Health Regulatory Agency)"
    BASE_URL:     str = "https://consultas.anvisa.gov.br/#/falta/"
    API_URL:      str = "https://consultas.anvisa.gov.br/api/falta/situacao"
    # Note: ANVISA API is Cloudflare-protected (403 without browser session).
    # Use Playwright for browser-based data extraction as fallback.
    COUNTRY:      str = "Brazil"
    COUNTRY_CODE: str = "BR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0
    PAGE_SIZE:        int   = 100

    _HEADERS: dict = {
        "User-Agent":   "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":       "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Origin":       "https://consultas.anvisa.gov.br",
        "Referer":      "https://consultas.anvisa.gov.br/",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Fetch all ANVISA shortage records across paginated API pages.

        Returns:
            {"records": list[dict], "fetched_at": str, "pages": int}
        """
        all_records: list[dict] = []
        page = 0

        self.log.info("Fetching ANVISA shortage data", extra={"url": self.API_URL})

        while True:
            params = {"page": page, "pageSize": self.PAGE_SIZE}
            try:
                time.sleep(self.RATE_LIMIT_DELAY)
                with httpx.Client(
                    headers=self._HEADERS,
                    timeout=self.REQUEST_TIMEOUT,
                    follow_redirects=True,
                ) as client:
                    resp = client.get(self.API_URL, params=params)
                    resp.raise_for_status()

                data = resp.json()

                # Handle different response structures
                if isinstance(data, list):
                    records = data
                    has_more = len(data) == self.PAGE_SIZE
                elif isinstance(data, dict):
                    records = data.get("content", data.get("items", data.get("data", [])))
                    total_pages = data.get("totalPages", data.get("total_pages", 1))
                    has_more = page < (total_pages - 1)
                else:
                    break

                all_records.extend(records)
                self.log.debug(
                    "ANVISA page fetched",
                    extra={"page": page, "count": len(records), "total_so_far": len(all_records)},
                )

                if not has_more or not records:
                    break
                page += 1

                # Safety cap
                if page >= 50:
                    self.log.warning("ANVISA: reached page cap (50)")
                    break

            except httpx.HTTPStatusError as exc:
                self.log.error(
                    "ANVISA API HTTP error",
                    extra={"status": exc.response.status_code, "page": page},
                )
                break
            except Exception as exc:
                self.log.error(
                    "ANVISA fetch error",
                    extra={"page": page, "error": str(exc)},
                )
                break

        self.log.info(
            "ANVISA fetch complete",
            extra={"total_records": len(all_records), "pages": page + 1},
        )
        return {
            "records":   all_records,
            "pages":     page + 1,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """Convert ANVISA API records to shortage event dicts."""
        records = raw.get("records", [])
        if not records:
            self.log.warning("ANVISA: no records to normalise")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        for item in records:
            try:
                # Field name variants
                generic_name = (
                    item.get("principioAtivo")
                    or item.get("principio_ativo")
                    or item.get("nomeProduto")
                    or item.get("nome_produto")
                    or ""
                ).strip()

                if not generic_name:
                    skipped += 1
                    continue

                brand = (item.get("nomeProduto") or item.get("nome_produto") or "").strip()
                status_raw = (item.get("situacao") or item.get("situacaoDescricao") or "").lower()
                status = "resolved" if any(w in status_raw for w in ["normaliz", "resolvid"]) else "active"

                start_raw = item.get("dataInicio") or item.get("data_inicio") or ""
                end_raw   = item.get("dataFim")    or item.get("data_fim")    or ""
                start_date = self._parse_br_date(start_raw) or today
                end_date   = self._parse_br_date(end_raw)

                reason = item.get("motivoFalta") or item.get("motivo_falta") or ""
                category = item.get("categoriaRegulatoriaDescricao") or ""

                normalised.append({
                    "generic_name":              generic_name,
                    "brand_names":               [brand] if brand and brand != generic_name else [],
                    "status":                    status,
                    "severity":                  "medium",
                    "reason":                    reason or None,
                    "reason_category":           self._map_reason(reason),
                    "start_date":                start_date,
                    "end_date":                  end_date if status == "resolved" else None,
                    "estimated_resolution_date": end_date if status == "active" else None,
                    "source_url":                self.BASE_URL,
                    "notes": (
                        f"Brazilian drug shortage from ANVISA. "
                        f"Category: {category}. Situation: {status_raw}."
                    ).strip(". "),
                    "raw_record": item,
                })
            except Exception as exc:
                skipped += 1
                self.log.warning("ANVISA: normalise error", extra={"error": str(exc)})

        self.log.info(
            "ANVISA normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    @staticmethod
    def _parse_br_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(str(raw)[:10], fmt[:len(fmt)]).date().isoformat()
            except Exception:
                pass
        return None

    @staticmethod
    def _map_reason(reason: str) -> str:
        low = reason.lower()
        if any(w in low for w in ["produção", "fabricação", "manufactur", "production"]):
            return "manufacturing_issue"
        if any(w in low for w in ["matéria", "insumo", "raw material"]):
            return "raw_material"
        if any(w in low for w in ["distribuição", "logística", "distribution"]):
            return "supply_chain"
        if any(w in low for w in ["demand", "demanda"]):
            return "demand_surge"
        return "supply_chain"


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — ANVISA Brazil"); print("=" * 60)
        scraper = AnvisaScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  records: {len(raw.get('records', []))}")
        events = scraper.normalize(raw)
        print(f"  events : {len(events)}")
        if events:
            print(f"  sample : {json.dumps({k:v for k,v in events[0].items() if k!='raw_record'}, ensure_ascii=False)}")
        sys.exit(0)
    scraper = AnvisaScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
