"""
ANVISA Brazilian Drug Shortage Scraper
───────────────────────────────────────
Source:  ANVISA — Agência Nacional de Vigilância Sanitária (Brazil)
URL:     https://consultas.anvisa.gov.br/#/falta/  (ROUTE NO LONGER EXISTS — see below)

HARD BLOCKER — confirmed 2026-07-02
────────────────────────────────────
This scraper was built against a JSON endpoint (`/api/falta/situacao`) that
no longer exists. Investigation (raw_scrapes showed status='processed' with
records_found=0 on every run since at least 2026-06-10 — a silent failure,
not a real "zero shortages in Brazil" result):

1. Direct HTTP (curl/httpx, several realistic desktop browser User-Agent
   strings) is consistently rejected on ALL of:
       consultas.anvisa.gov.br/                    -> 403 (Cloudflare JS challenge)
       consultas.anvisa.gov.br/api/falta/situacao   -> 403 via curl, or a
                                                        genuine 404 Not Found
                                                        via httpx depending on
                                                        request fingerprinting
       api.anvisa.gov.br/                          -> 403 (Cloudflare JS challenge)
   The 404 on the API path (once past Cloudflare) is the real signal: the
   endpoint itself is gone, not merely bot-gated.

2. However, a REAL headless Chromium session (Playwright — which does
   execute Cloudflare's JS challenge and obtain a clearance cookie, unlike
   curl/httpx) DOES successfully load consultas.anvisa.gov.br. That rules
   out "just a UA sniff" and exposes the real problem: the rendered SPA's
   top-level "Consultas" menu (Bulário, Pareceres, Documentos, Alertas
   Sanitários, Certificados de Boas Práticas, Medicamentos, etc.) has NO
   "Falta"/"Desabastecimento" entry anymore, and navigating straight to
   #/falta/ triggers zero XHR calls to any falta/situacao/desabastecimento
   endpoint — the Angular route (and its backing API) has been removed
   from the live app, not just restyled.

3. ANVISA's current public surfaces for this topic are NOT a REST API:
     - "Descontinuação de medicamentos"
       (gov.br/anvisa/pt-br/assuntos/fiscalizacao-e-monitoramento/mercado/
        descontinuacao-de-medicamentos) links out to a MicroStrategy BI
       document at sad.anvisa.gov.br/MicroStrategy/servlet/mstrWeb. That
       specific servlet path returns a Cloudflare WAF block ("Sorry, you
       have been blocked" — a rule-based block, not a JS challenge) even
       via headless Chromium, while sad.anvisa.gov.br's bare root loads
       fine — the WAF is specifically guarding the legacy (2018-era)
       MicroStrategy servlet path, not the domain as a whole. Attempting to
       route around a targeted WAF rule guarding a legacy Java servlet is
       out of scope for this scraper.
     - "Medicamentos com risco de desabastecimento" (CMED pricing page,
       gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/risco-de-desabastecimento)
       only publishes historical committee-meeting-minutes PDFs (Atas),
       with no structured/current shortage list and no dates suitable for
       shortage_events.

Conclusion: this is ANVISA discontinuing a public API, not page-structure
drift a selector fix can repair. fetch() therefore raises ScraperError with
a clear diagnostic (so raw_scrapes correctly shows status='failed' with an
error_message, instead of a misleading status='processed', records_found=0)
rather than silently returning empty data. normalize() is left implemented
against the last-known field names so this scraper is fetch-ready the
moment ANVISA republishes a structured endpoint, or a legitimate
browser-engine fetch layer is extended to reach the MicroStrategy panel.

Status values (Portuguese, from the old API — kept for when it returns):
    "Em falta"         → active
    "Normalizado"      → resolved
    "Parcialmente em falta" → active (partial)

Data source UUID:  10000000-0000-0000-0000-000000000035, BR)
Country:           Brazil
Country code:      BR
"""

from __future__ import annotations

from datetime import datetime, timezone

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class AnvisaScraper(BaseScraper):
    """Scraper for ANVISA Brazilian drug shortage data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000035"
    SOURCE_NAME:  str = "ANVISA (Brazilian Health Regulatory Agency)"
    BASE_URL:     str = "https://consultas.anvisa.gov.br/#/falta/"
    API_URL:      str = "https://consultas.anvisa.gov.br/api/falta/situacao"
    # HARD BLOCKER (confirmed 2026-07-02, see module docstring): this route
    # no longer exists on the live SPA. Kept as documentation of the last
    # known endpoint, tried once per run in case ANVISA republishes it.
    COUNTRY:      str = "Brazil"
    COUNTRY_CODE: str = "BR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0
    PAGE_SIZE:        int   = 100

    DEFAULT_HEADERS: dict = {
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

        Raises ScraperError if the first page fails (confirmed hard blocker
        as of 2026-07-02 — see module docstring) so the run is recorded as
        a genuine failure rather than a silent zero-record "success".

        Returns:
            {"records": list[dict], "fetched_at": str, "pages": int}
        """
        all_records: list[dict] = []
        page = 0

        self.log.info("Fetching ANVISA shortage data", extra={"url": self.API_URL})

        while True:
            params = {"page": page, "pageSize": self.PAGE_SIZE}
            try:
                data = self._get_json(self.API_URL, params=params)
            except Exception as exc:
                if page == 0:
                    raise ScraperError(
                        "ANVISA fetch blocked: consultas.anvisa.gov.br/api/falta/"
                        "situacao is unreachable. Confirmed 2026-07-02 that this "
                        "is NOT a transient outage or UA-sniffing bot check — "
                        "the underlying '#/falta/' SPA route and its backing API "
                        "have been removed from the live ANVISA consultas app "
                        "entirely (verified with a real headless-Chromium "
                        "session that otherwise loads the site fine). ANVISA's "
                        "current replacements (a MicroStrategy BI panel at "
                        "sad.anvisa.gov.br, and a PDF-only CMED committee-minutes "
                        "archive) are either WAF-blocked or unstructured — see "
                        "module docstring for the full investigation. Underlying "
                        f"error: {exc}"
                    ) from exc
                self.log.error(
                    "ANVISA API error mid-pagination — returning partial results",
                    extra={"page": page, "error": str(exc)},
                )
                break

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
                    "reason_category":           map_reason_category(reason),
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


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — ANVISA Brazil"); print("=" * 60)
        scraper = AnvisaScraper(db_client=MagicMock())
        try:
            raw = scraper.fetch()
        except ScraperError as exc:
            print(f"\n!! Fetch failed (expected if the ANVISA block is still up): {exc}")
            print(
                "\nThis is a documented HARD BLOCKER: the 'falta de medicamentos' "
                "API this scraper targets no longer exists on ANVISA's live site. "
                "See the module docstring for the full investigation."
            )
            sys.exit(1)
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
