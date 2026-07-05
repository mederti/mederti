"""
DIGEMID Peru — Discontinuidad de Medicamentos Scraper
--------------------------------------------------------------------------
Source:  DIGEMID (Dirección General de Medicamentos, Insumos y Drogas) —
         "Discontinuación de la fabricación, importación o comercialización
         de medicamentos o productos biológicos"
URL:     https://serviciosweb-digemid.minsa.gob.pe/DiscontinuidadMedicamentos/Discontinuados

DIGEMID is Peru's national medicines regulatory authority (under MINSA, the
Ministry of Health). This page publishes a live register of pharmaceutical
products whose manufacturing, importation, or commercialisation has been
discontinued by the registration holder (laboratorio / droguería).

Page structure (verified live 2026-07-02)
------------------------------------------
This is a server-rendered JSF/Wildfly page, NOT a JSON API. A plain GET on
BASE_URL returns the FULL unfiltered register inline in one HTML table
(id="tabla_lproductos") — ~2,676 rows observed, no pagination, no JS
rendering required. The search form (POST to "Reporte") lets a user filter
by product/form/date, but is not needed: the unfiltered GET already returns
everything, which is simpler and avoids replicating JSF ViewState handling.

Table columns (15 <td> per row, consistent across all rows):
    0  Item                        Row number (1-indexed, cosmetic)
    1  Código                      Product registration code (e.g. EE01691)
    2  Tipo                        Registration type — "R.S." (Registro
                                    Sanitario) or "C.R.S." (Certificado de
                                    Registro Sanitario)
    3  Nombre Producto              Brand/product name
    4  IFA                         Active pharmaceutical ingredient(s) +
                                    strength, e.g. "GEMFIBROZILO(600.000000 mg)"
    5  Concentración                Human-readable strength, e.g. "600mg"
    6  Forma Farmacéutica           Dosage form, e.g. "TABLETA RECUBIERTA"
    7  Razón Social del establec.   Manufacturer / registration holder
    8  Categoría del establec.     "DRG" (droguería/distributor) or
                                    "LAB" (laboratorio/manufacturer)
    9  Tipo de discontinuación      "Temporal" or "Definitiva" (see below)
    10 Situación del último reporte "Discontinuado" or "Ampliado(N)"
                                    (extended for the Nth time — still ongoing)
    11 Motivos de la discontinuación Free-text Spanish reason(s), comma-joined
    12 Fecha estimada de inicio     Discontinuation start date (dd/mm/yyyy)
    13 Fecha estimada de fin         Estimated end date (dd/mm/yyyy) — BLANK
                                    for "Definitiva" rows (no return expected)
    14 Fecha de reporte             Date DIGEMID last recorded/updated the
                                    report (dd/mm/yyyy) — always populated,
                                    used as a start_date fallback.

Spanish terms relied on (documented for future maintainers)
-------------------------------------------------------------------------
    discontinuado / discontinuación  = discontinued / discontinuation
    fabricación                      = manufacturing
    importación                      = importation
    comercialización                 = commercialisation / marketing
    Temporal                         = temporary — product is expected to
                                        return; treated as an ACTIVE shortage
    Definitiva                       = definitive/permanent — registration
                                        holder does not intend to resume;
                                        treated as RESOLVED (withdrawn from
                                        market, not a "come-back" shortage)
    Ampliado(N)                      = "extended (Nth time)" — the temporary
                                        discontinuation window has been
                                        pushed back N times; still ongoing,
                                        still ACTIVE
    Motivos                          = reasons
    Droguería                        = distributor/wholesaler establishment
    Laboratorio                      = manufacturer establishment
    Razón Social                     = legal/company name

Status mapping rationale
-------------------------------------------------------------------------
DIGEMID's "discontinuación" register is fundamentally different from most
shortage registers: EVERY row is, by definition, a product the holder has
stopped supplying. There is no separate "active shortage" vs "discontinued"
axis in the source — instead the axis is temporary-vs-permanent:

    Tipo de discontinuación = "Temporal"   -> status = "active"
        (still within its discontinuation window; a resolution/return is
        anticipated per Fecha estimada de fin, so this is functionally an
        active shortage from the market's perspective)
    Tipo de discontinuación = "Definitiva" -> status = "resolved"
        (no return is coming; treating this as an ongoing "active" shortage
        would be misleading — it is a permanent market withdrawal, closer in
        spirit to a resolved/closed record than a live gap expected to fill)

This mirrors how discontinuation-type sources are unavoidably an imperfect
fit for the active/resolved/anticipated vocabulary — mapped as best as the
data allows; a future pass could add a distinct "withdrawn" status if the
schema grows one.

Data source UUID:  10000000-0000-0000-0000-000000000114 (migration 064)
Country:           Peru
Country code:      PE
Confidence:        75/100 (official government regulator register)

Cron: not wired here — someone else adds this to run_all_scrapers.py /
crontab_fixed.txt. This file only implements the scraper class.
"""

from __future__ import annotations

import re
from datetime import date

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class PeruDIGEMIDScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000114"
    SOURCE_NAME: str  = "DIGEMID — Discontinuidad de Medicamentos (Peru)"
    BASE_URL: str     = "https://serviciosweb-digemid.minsa.gob.pe/DiscontinuidadMedicamentos/Discontinuados"
    COUNTRY: str      = "Peru"
    COUNTRY_CODE: str = "PE"

    RATE_LIMIT_DELAY: float = 3.0   # Be polite to a Peruvian gov server
    REQUEST_TIMEOUT: float  = 75.0  # Single GET returns ~2,700 rows inline — can be slow
    SCRAPER_VERSION: str    = "1.0.0"

    # "Nombre(strength unit)" e.g. "GEMFIBROZILO(600.000000 mg)" or combos
    # joined with " + ". We only need the leading ingredient name(s).
    _IFA_STRENGTH_PATTERN = re.compile(r"\s*\([^)]*\)")

    # dd/mm/yyyy as published by DIGEMID
    _DATE_PATTERN = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch the DIGEMID discontinuation register.

        The unfiltered GET on BASE_URL already returns every record inline
        in a single server-rendered HTML table (no pagination, no JS
        execution needed) — confirmed live 2026-07-02 (~2,676 rows).
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        resp = self._get(self.BASE_URL)
        soup = BeautifulSoup(resp.text, "html.parser")

        table = soup.find("table", id="tabla_lproductos")
        if table is None:
            raise ScraperError(
                "DIGEMID page structure changed — could not find "
                "table#tabla_lproductos. Site may have been redesigned."
            )

        tbody = table.find("tbody")
        if tbody is None:
            # Found the table but no body: a structural anomaly, not a genuine
            # empty result. Raise so it can't hash as a duplicate and refresh
            # last_verified_at on stale PE events.
            raise ScraperError(
                "DIGEMID table#tabla_lproductos has no <tbody> — structure changed."
            )

        rows = tbody.find_all("tr", recursive=False)
        self.log.info("Found DIGEMID table rows", extra={"count": len(rows)})

        records: list[dict] = []
        for row in rows:
            cells = [c.get_text(strip=True) for c in row.find_all("td", recursive=False)]
            if len(cells) != 15:
                # Defensive: skip malformed/header/footer rows rather than crash.
                self.log.debug(
                    "Skipping row with unexpected cell count",
                    extra={"cell_count": len(cells)},
                )
                continue

            records.append({
                "item":                    cells[0],
                "codigo":                  cells[1],
                "tipo_registro":           cells[2],
                "nombre_producto":         cells[3],
                "ifa":                     cells[4],
                "concentracion":           cells[5],
                "forma_farmaceutica":      cells[6],
                "razon_social":            cells[7],
                "categoria_establecimiento": cells[8],
                "tipo_discontinuacion":    cells[9],
                "situacion_ultimo_reporte": cells[10],
                "motivos":                 cells[11],
                "fecha_inicio":            cells[12],
                "fecha_fin":               cells[13],
                "fecha_reporte":           cells[14],
            })

        self.log.info("DIGEMID fetch complete", extra={"records": len(records)})
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize DIGEMID discontinuation records into shortage event dicts."""
        self.log.info(
            "Normalising DIGEMID records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise DIGEMID record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        """Convert a single DIGEMID record to a normalised shortage event dict."""
        # Prefer the active ingredient (IFA) for drug matching — brand names
        # (Nombre Producto) go into brand_names for drug creation instead.
        generic_name = self._clean_ifa_name(rec.get("ifa") or "")
        brand_name = str(rec.get("nombre_producto") or "").strip()

        if not generic_name:
            # Fall back to the brand/product name if IFA is unparseable —
            # too valuable a record to drop entirely.
            generic_name = brand_name

        if not generic_name:
            return None

        # ── Status mapping ────────────────────────────────────────────────
        # "Temporal"   -> active (a return is anticipated)
        # "Definitiva" -> resolved (permanent market withdrawal)
        # See module docstring "Status mapping rationale" for justification.
        tipo_discontinuacion = str(rec.get("tipo_discontinuacion") or "").strip().lower()
        if tipo_discontinuacion == "definitiva":
            status = "resolved"
        else:
            # "temporal" (default) — including all "Ampliado(N)" extensions,
            # which are still temporary discontinuations under active review.
            status = "active"

        # ── Dates ─────────────────────────────────────────────────────────
        start_date = (
            self._parse_date(rec.get("fecha_inicio"))
            or self._parse_date(rec.get("fecha_reporte"))
            or date.today().isoformat()
        )
        end_date = self._parse_date(rec.get("fecha_fin"))
        estimated_resolution_date = end_date if status == "active" else None
        if status == "resolved" and not end_date:
            # Definitiva rows publish no "fecha fin" (no return expected) —
            # use the report date as the effective resolution/closure date.
            end_date = self._parse_date(rec.get("fecha_reporte"))

        # ── Reason ────────────────────────────────────────────────────────
        raw_reason = str(rec.get("motivos") or "").strip().strip(",")
        reason_category = map_reason_category(raw_reason)
        if reason_category == "unknown" and tipo_discontinuacion == "definitiva":
            # A permanent withdrawal with an unmapped free-text reason is
            # still, structurally, a discontinuation.
            reason_category = "discontinuation"

        # ── Notes ─────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        codigo = str(rec.get("codigo") or "").strip()
        if codigo:
            notes_parts.append(f"Código de registro: {codigo}")
        manufacturer = str(rec.get("razon_social") or "").strip()
        if manufacturer:
            notes_parts.append(f"Titular/razón social: {manufacturer}")
        forma = str(rec.get("forma_farmaceutica") or "").strip()
        if forma:
            notes_parts.append(f"Forma farmacéutica: {forma}")
        concentracion = str(rec.get("concentracion") or "").strip()
        if concentracion:
            notes_parts.append(f"Concentración: {concentracion}")
        situacion = str(rec.get("situacion_ultimo_reporte") or "").strip()
        if situacion:
            notes_parts.append(f"Situación del último reporte: {situacion}")
        categoria = str(rec.get("categoria_establecimiento") or "").strip()
        if categoria:
            categoria_label = {"DRG": "Droguería", "LAB": "Laboratorio"}.get(categoria, categoria)
            notes_parts.append(f"Categoría del establecimiento: {categoria_label}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               [brand_name] if brand_name else [],
            "status":                    status,
            "severity":                  "medium",
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                self.BASE_URL,
            "notes":                     notes,
            "source_confidence_score":   75,
            "raw_record":                rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @classmethod
    def _clean_ifa_name(cls, ifa: str) -> str:
        """
        Strip strength/unit annotations from the IFA field.

        Examples:
            "GEMFIBROZILO(600.000000 mg)" -> "Gemfibrozilo"
            "CLORHIDRATO DE TRAMADOL(37.500000 mg) + PARACETAMOL(325.000000 mg)"
                -> "Clorhidrato De Tramadol + Paracetamol"
        """
        if not ifa:
            return ""
        cleaned = cls._IFA_STRENGTH_PATTERN.sub("", ifa).strip()
        # Normalise " +" spacing left by the strip
        cleaned = re.sub(r"\s*\+\s*", " + ", cleaned)
        return cleaned.strip()

    @classmethod
    def _parse_date(cls, raw: str | None) -> str | None:
        """Parse a DIGEMID dd/mm/yyyy date string to ISO-8601."""
        if not raw:
            return None
        raw = raw.strip()
        if not raw:
            return None
        match = cls._DATE_PATTERN.match(raw)
        if match:
            day, month, year = match.groups()
            try:
                return date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                return None
        # Defensive fallback for unexpected formats
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw, dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            return None


# -------------------------------------------------------------------------
# Standalone entrypoint
# -------------------------------------------------------------------------

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
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live DIGEMID data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = PeruDIGEMIDScraper(db_client=MagicMock())

        print("\n-- Fetching from DIGEMID ...")
        raw = scraper.fetch()
        print(f"-- Raw records received : {len(raw)}")

        print("-- Normalising records ...")
        events = scraper.normalize(raw)
        print(f"-- Normalised events    : {len(events)}")

        if events:
            print("\n-- Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            from collections import Counter

            status_counts   = Counter(e["status"] for e in events)
            severity_counts = Counter(e.get("severity") for e in events)
            reason_counts   = Counter(e.get("reason_category") for e in events)

            print("\n-- Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:25s} {v}")
            print("\n-- Severity breakdown:")
            for k, v in sorted(severity_counts.items()):
                print(f"   {str(k):12s} {v}")
            print("\n-- Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):30s} {v}")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = PeruDIGEMIDScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
