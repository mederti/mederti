"""
AIFA Italy Medicine Shortage Scraper
──────────────────────────────────────
Source:  Agenzia Italiana del Farmaco — Carenze di Medicinali
URL:     https://www.aifa.gov.it/carenze

Data source (confirmed 2026-02-22):
    AIFA publishes a live CSV file updated in-place (last checked 2026-02-20).
    No authentication or cookies required.

    CSV URL (stable, permanent):
        https://www.aifa.gov.it/documents/20142/847339/elenco_medicinali_carenti.csv

    Format details:
        Encoding:    Windows-1252 (cp1252) — use errors="replace" for safety
        Delimiter:   semicolon (;)
        Row 0-1:     Preamble / disclaimer text (skip)
        Row 2:       Column headers
        Row 3+:      Data records
        Records:     ~4,123 as of 2026-02-20

Column definitions (Italian → English):
    Nome medicinale             Trade/brand name
    Codice AIC                  Marketing authorisation code (9-digit)
    Principio attivo            Active ingredient / INN  ← use as generic_name
    Forma farmaceutica e dosaggio  Pharmaceutical form + dosage
    Titolare AIC                Marketing Authorisation Holder (MAH)
    Data inizio                 Shortage start date (DD/MM/YYYY)
    Fine presunta               Estimated end date (DD/MM/YYYY; may be blank)
    Equivalente                 Equivalent available: Sì / No
    Motivazioni                 Shortage reason (Italian text)
    Suggerimenti/Indicazioni AIFA  AIFA guidance (free text)
    Nota AIFA                   AIFA note (free text; often blank)
    Classe di rimborsabilità    Reimbursement class
    Codice ATC                  ATC classification code

Status logic:
    All records are in the "currently in shortage" list.  However:
    • "Cessata commercializzazione definitiva" in Motivazioni → discontinued → resolved
    • Fine presunta in the past (< today) → estimated to be resolved
    • Otherwise → active

Data source UUID:  10000000-0000-0000-0000-000000000009  (AIFA, IT)
Country:           Italy
Country code:      IT
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone

from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class AIFAScraper(BaseScraper):
    """Scraper for AIFA Italy medicine shortages via direct CSV download."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000009"
    SOURCE_NAME:  str = "Agenzia Italiana del Farmaco — Carenze"
    BASE_URL:     str = "https://www.aifa.gov.it"
    CSV_URL:      str = (
        "https://www.aifa.gov.it/documents/20142/847339/elenco_medicinali_carenti.csv"
    )
    COUNTRY:      str = "Italy"
    COUNTRY_CODE: str = "IT"

    RATE_LIMIT_DELAY: float = 2.0   # single bulk download

    # Italian reason vocabulary → reason_category
    _REASON_MAP: dict[str, str] = {
        "problemi produttivi":                   "manufacturing_issue",
        "problema produttivo":                   "manufacturing_issue",
        "problemi di produzione":                "manufacturing_issue",
        "difetto qualità":                       "manufacturing_issue",
        "difetto di qualita":                    "manufacturing_issue",
        "carenza materie prime":                 "raw_material",
        "materie prime":                         "raw_material",
        "elevata richiesta":                     "demand_surge",
        "aumento della domanda":                 "demand_surge",
        "cessata commercializzazione definitiva": "discontinuation",
        "cessata commercializzazione":           "discontinuation",
        "ritiro dal commercio":                  "discontinuation",
        "problemi di distribuzione":             "supply_chain",
        "catena di distribuzione":               "supply_chain",
        "provvedimento autorizzativo":           "regulatory_action",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """Download the AIFA shortage CSV and return records as list of dicts."""
        response = self._get(self.CSV_URL)
        # cp1252 handles Italian characters (accents, curly quotes)
        text = response.content.decode("cp1252", errors="replace")

        # The CSV has 2 preamble rows before the column header row.
        # Row 0: "Shortage reports","DISCLAIMER: ..."
        # Row 1: continuation of disclaimer
        # Row 2: column headers
        # Row 3+: data
        all_rows = list(csv.reader(io.StringIO(text), delimiter=";"))

        if len(all_rows) < 3:
            self.log.warning("AIFA CSV too short; unexpected format", extra={"rows": len(all_rows)})
            return []

        # Locate the header row: first row whose first cell matches a known
        # AIFA column name.  Preamble rows start with "NB:" or "Elenco dei…".
        _HEADER_MARKERS = {"nome medicinale", "nome", "principio attivo", "codice aic"}
        header_idx = 2  # safe default (confirmed row index as of 2026-02-22)
        for i, row in enumerate(all_rows[:6]):
            first = row[0].strip().lower() if row else ""
            if first in _HEADER_MARKERS or first.startswith("nome med"):
                header_idx = i
                break

        raw_headers = [h.strip() for h in all_rows[header_idx]]

        records: list[dict] = []
        for row in all_rows[header_idx + 1:]:
            if not any(cell.strip() for cell in row):
                continue  # skip blank lines at EOF
            # Pad short rows (trailing empty fields sometimes omitted)
            padded = row + [""] * max(0, len(raw_headers) - len(row))
            rec = {raw_headers[i]: padded[i].strip()
                   for i in range(len(raw_headers))}
            records.append(rec)

        self.log.info(
            "AIFA CSV fetch complete",
            extra={
                "total":   len(records),
                "columns": raw_headers[:5],
            },
        )
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising AIFA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(records)},
        )

        normalised: list[dict] = []
        skipped = 0
        today = date.today()

        for rec in records:
            try:
                result = self._normalise_record(rec, today)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise AIFA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict, today: date) -> dict | None:
        # ── Generic name: INN / active ingredient ─────────────────────────────
        principio = (rec.get("Principio attivo") or "").strip()
        nome      = (rec.get("Nome medicinale") or "").strip()

        generic_name = principio or nome
        if not generic_name:
            return None

        brand_names = [nome] if nome and nome.lower() != generic_name.lower() else []

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_date(rec.get("Data inizio"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        fine_presunta_raw = rec.get("Fine presunta", "").strip()
        fine_presunta = self._parse_date(fine_presunta_raw)

        # ── Status ────────────────────────────────────────────────────────────
        motivazioni = (rec.get("Motivazioni") or "").strip()
        motiv_lower = motivazioni.lower()

        if "cessata commercializzazione" in motiv_lower or "ritiro dal commercio" in motiv_lower:
            status = "resolved"
            end_date = fine_presunta or start_date
            estimated_resolution = None
        elif fine_presunta:
            end_dt = date.fromisoformat(fine_presunta)
            if end_dt < today:
                status = "resolved"
                end_date = fine_presunta
                estimated_resolution = None
            else:
                status = "active"
                end_date = None
                estimated_resolution = fine_presunta
        else:
            status = "active"
            end_date = None
            estimated_resolution = None

        # ── Reason ────────────────────────────────────────────────────────────
        reason_category = self._map_reason(motivazioni)

        # ── Severity ──────────────────────────────────────────────────────────
        reimbursement = (rec.get("Classe di rimborsabilità") or "").strip()
        atc = (rec.get("Codice ATC") or "").strip()

        if "OSPED" in reimbursement.upper():
            severity = "critical" if status == "active" else "low"
        elif status == "active":
            severity = "medium"
        else:
            severity = "low"

        # ── Notes ─────────────────────────────────────────────────────────────
        mah        = (rec.get("Titolare AIC") or "").strip()
        forma      = (rec.get("Forma farmaceutica e dosaggio") or "").strip()
        equivalente = (rec.get("Equivalente") or "").strip()
        suggerimenti = (rec.get("Suggerimenti/Indicazioni AIFA") or "").strip()
        nota_aifa   = (rec.get("Nota AIFA") or "").strip()

        notes_parts: list[str] = []
        if mah:         notes_parts.append(f"MAH: {mah}")
        if forma:       notes_parts.append(f"Form: {forma}")
        if atc:         notes_parts.append(f"ATC: {atc}")
        if equivalente: notes_parts.append(f"Equivalent available: {equivalente}")
        if motivazioni: notes_parts.append(f"Reason: {motivazioni}")
        if suggerimenti: notes_parts.append(suggerimenti)
        if nota_aifa:   notes_parts.append(nota_aifa)
        notes: str | None = "\n".join(notes_parts) or None

        aic = (rec.get("Codice AIC") or "").strip()
        source_url = (
            f"https://www.aifa.gov.it/carenze"
        )

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    motivazioni or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "aic_code":          aic or None,
                "nome_medicinale":   nome or None,
                "atc_code":          atc or None,
                "mah":               mah or None,
                "motivazioni":       motivazioni or None,
                "equivalente":       equivalente or None,
                "reimbursement":     reimbursement or None,
            },
        }

    def _map_reason(self, raw: str) -> str:
        if not raw:
            return "unknown"
        lower = raw.lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        return "unknown"

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """Parse DD/MM/YYYY (Italian format) → ISO-8601."""
        if not raw or not str(raw).strip():
            return None
        try:
            dt = dtparser.parse(str(raw).strip(), dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, OverflowError):
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

        scraper = AIFAScraper(db_client=MagicMock())
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
    scraper = AIFAScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
