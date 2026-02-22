"""
AEMPS Spain Medicine Shortage Scraper
──────────────────────────────────────
Source:  Agencia Española de Medicamentos y Productos Sanitarios
         via CIMA (Centro de Información Online de Medicamentos)
URL:     https://cima.aemps.es/cima/publico/listadesabastecimiento.html

Data source (confirmed 2026-02-22):
    CIMA exposes a public, unauthenticated REST JSON API at:
        https://cima.aemps.es/cima/rest/psuministro

    Paginated at 200 records/page.  Two calls cover active + resolved:
        ?activos=true&pagina=N        → currently active shortages
        ?finalizados=true&pagina=N    → recently resolved shortages

    Response JSON structure:
        {
          "totalFilas":   <int>,
          "pagina":       <int>,
          "tamanioPagina": 200,
          "resultados":   [ ... ]
        }

    Per-record fields:
        cn                      National medicine code (Código Nacional)
        nombre                  Presentation name (brand + dosage + form)
        tipoProblemaSuministro  Shortage type code (int, see below)
        fini                    Start date (Unix ms timestamp)
        ffin                    Expected end date (Unix ms, may be absent)
        activo                  True = active, False = resolved (bool)
        observ                  Observations / notes (str or null)

    tipoProblemaSuministro codes (confirmed from live data):
        3  → No alternative available
        4  → Temporary shortage (foreign import authorized)
        5  → Alternative: same active ingredient (single)
        6  → Alternative: same active ingredients (multi)
        7  → Requestable as foreign medicine
        9  → Controlled distribution (limited units)
        10 → AEMPS-authorized exceptional commercialization
        11 → OTC alternatives available

    INN (principio activo) is NOT in the list endpoint.  It can be fetched
    via GET /cima/rest/presentacion/{cn} but that requires N additional calls.
    To avoid N×RTT latency, generic_name is extracted from `nombre` by
    splitting at the first digit token (dosage info).

Data source UUID:  10000000-0000-0000-0000-000000000010  (AEMPS, ES)
Country:           Spain
Country code:      ES
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper


class AEMPSScraper(BaseScraper):
    """Scraper for AEMPS/CIMA Spain medicine shortage REST API."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000010"
    SOURCE_NAME:  str = "Agencia Española de Medicamentos — Problemas de Suministro"
    BASE_URL:     str = "https://cima.aemps.es"
    API_URL:      str = "https://cima.aemps.es/cima/rest/psuministro"
    COUNTRY:      str = "Spain"
    COUNTRY_CODE: str = "ES"

    RATE_LIMIT_DELAY: float = 1.0   # polite delay between paginated calls

    PAGE_SIZE: int = 200  # fixed server-side page size

    # tipoProblemaSuministro → reason_category
    _TIPO_MAP: dict[int, str] = {
        3:  "unknown",            # No alternative
        4:  "supply_chain",       # Temporary shortage / foreign import
        5:  "supply_chain",       # Alternative same active ingredient
        6:  "supply_chain",       # Alternative same active ingredients (multi)
        7:  "supply_chain",       # Requestable as foreign medicine
        9:  "supply_chain",       # Controlled distribution
        10: "regulatory_action",  # AEMPS exceptional commercialization
        11: "supply_chain",       # OTC alternatives available
    }

    # Observ text → reason_category overrides (substring match)
    _REASON_MAP: dict[str, str] = {
        "fabricación":          "manufacturing_issue",
        "fabricacion":          "manufacturing_issue",
        "producción":           "manufacturing_issue",
        "produccion":           "manufacturing_issue",
        "calidad":              "manufacturing_issue",
        "materia prima":        "raw_material",
        "materias primas":      "raw_material",
        "demanda":              "demand_surge",
        "distribución":         "supply_chain",
        "distribucion":         "supply_chain",
        "comercialización":     "discontinuation",
        "comercializacion":     "discontinuation",
        "retirada":             "discontinuation",
        "regulatorio":          "regulatory_action",
        "autorización":         "regulatory_action",
        "autorizacion":         "regulatory_action",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Paginate through active and resolved shortages from the CIMA REST API.
        Returns a flat list of raw record dicts.
        """
        records: list[dict] = []
        for scope in ("activos", "finalizados"):
            records.extend(self._fetch_scope(scope))
        self.log.info(
            "AEMPS fetch complete",
            extra={"total": len(records)},
        )
        return records

    def _fetch_scope(self, scope: str) -> list[dict]:
        """Fetch all pages for a given scope ('activos' or 'finalizados')."""
        params: dict[str, Any] = {scope: "true", "pagina": 1}
        resp = self._get(self.API_URL, params=params)
        data = resp.json()

        total     = data.get("totalFilas", 0)
        page_size = data.get("tamanioPagina", self.PAGE_SIZE)
        results   = data.get("resultados", [])

        num_pages = math.ceil(total / page_size) if page_size else 1

        self.log.info(
            "AEMPS API page 1",
            extra={"scope": scope, "total": total, "pages": num_pages,
                   "fetched": len(results)},
        )

        for page in range(2, num_pages + 1):
            params["pagina"] = page
            resp = self._get(self.API_URL, params=params)
            page_results = resp.json().get("resultados", [])
            results.extend(page_results)
            self.log.debug(
                "AEMPS API page N",
                extra={"scope": scope, "page": page, "fetched": len(page_results)},
            )

        # Tag records with scope so normalizer knows
        for rec in results:
            rec["_scope"] = scope

        return results

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising AEMPS records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(records)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise AEMPS record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised),
                   "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        nombre = (rec.get("nombre") or "").strip()
        if not nombre:
            return None

        # ── Generic name: extract from nombre ────────────────────────────────
        # Split at first dosage token (digit optionally preceded by space).
        # "BISOPROLOL NORMON 5 mg COMPRIMIDOS EFG" → "BISOPROLOL NORMON"
        # "ZOFRAN 4 mg SOLUCION INYECTABLE" → "ZOFRAN"
        generic_name = self._extract_inn(nombre)
        brand_names  = ([nombre] if nombre.lower() != generic_name.lower() else [])

        # ── Status ────────────────────────────────────────────────────────────
        activo = rec.get("activo", True)
        # _scope added by fetch: 'activos' overrides activo boolean if present
        scope  = rec.get("_scope", "activos")
        if scope == "finalizados" and not activo:
            status = "resolved"
        elif activo:
            status = "active"
        else:
            status = "resolved"

        # ── Dates ─────────────────────────────────────────────────────────────
        fini = rec.get("fini")
        ffin = rec.get("ffin")          # may be absent
        start_date = self._ms_to_date(fini) or datetime.now(timezone.utc).date().isoformat()
        end_parsed = self._ms_to_date(ffin)

        if status == "resolved":
            end_date = end_parsed
            estimated_resolution = None
        else:
            end_date = None
            estimated_resolution = end_parsed

        # ── Reason ────────────────────────────────────────────────────────────
        tipo = rec.get("tipoProblemaSuministro")
        observ = (rec.get("observ") or "").strip()
        reason_category = self._map_reason(tipo, observ)
        raw_reason = observ or None

        # ── Severity ──────────────────────────────────────────────────────────
        if status == "resolved":
            severity = "low"
        elif tipo == 3:   # No alternative available → high impact
            severity = "high"
        elif tipo in (9, 10):  # Controlled distribution / exceptional commercialization
            severity = "high"
        else:
            severity = "medium"

        # ── Source URL ────────────────────────────────────────────────────────
        cn = str(rec.get("cn", "")).strip()
        source_url = (
            f"https://cima.aemps.es/cima/publico/listadesabastecimiento.html"
            f"?activos={'1' if status != 'resolved' else '0'}"
        )

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        if cn:
            notes_parts.append(f"CN: {cn}")
        if tipo is not None:
            notes_parts.append(f"Tipo: {tipo}")
        if observ:
            notes_parts.append(observ)
        notes: str | None = "\n".join(notes_parts) or None

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    raw_reason,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "cn":                       cn or None,
                "nombre":                   nombre,
                "tipo_problema_suministro": tipo,
                "activo":                   activo,
                "observ":                   observ or None,
            },
        }

    def _map_reason(self, tipo: int | None, observ: str) -> str:
        # Tipo code takes priority (more reliable than free-text observ)
        if tipo is not None:
            tipo_cat = self._TIPO_MAP.get(tipo)
            if tipo_cat and tipo_cat != "unknown":
                return tipo_cat
        # Refine with observ free text when tipo doesn't give useful signal
        if observ:
            lower = observ.lower()
            for key, cat in self._REASON_MAP.items():
                norm = key.replace("ó", "o").replace("ú", "u")
                if norm in lower or key in lower:
                    return cat
        if tipo is not None:
            return self._TIPO_MAP.get(tipo, "unknown")
        return "unknown"

    @staticmethod
    def _extract_inn(nombre: str) -> str:
        """
        Extract the active ingredient name from a CIMA presentation name.
        Splits at the first dosage token (digit or comma-quantity).
        Returns the part before the dosage, title-cased.
        """
        # Match first standalone number (dosage) — split there
        m = re.search(r'\s+\d', nombre)
        if m:
            candidate = nombre[:m.start()].strip()
        else:
            # No number found — use everything before first comma
            candidate = nombre.split(",")[0].strip()
        # Limit to first 6 words to avoid multi-brand sprawl
        words = candidate.split()[:6]
        return " ".join(words).title() if words else nombre[:80]

    @staticmethod
    def _ms_to_date(ms: int | None) -> str | None:
        """Convert Unix millisecond timestamp → ISO-8601 date string.
        Returns None for far-future placeholder dates (year > 2040).
        """
        if ms is None:
            return None
        try:
            dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
            if dt.year > 2040:
                return None  # AEMPS uses distant future as "open-ended"
            return dt.date().isoformat()
        except (ValueError, OSError, OverflowError):
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock
        from collections import Counter

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = AEMPSScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")

        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            print("\n── Status breakdown:")
            for k, v in sorted(Counter(e["status"] for e in events).items()):
                print(f"   {k:25s} {v}")
            print("\n── Severity breakdown:")
            for k, v in sorted(Counter(e.get("severity") for e in events).items()):
                print(f"   {str(k):12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(Counter(e.get("reason_category") for e in events).items()):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = AEMPSScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
