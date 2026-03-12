"""
AIFA Italy Medicine Shortage Scraper (Railway)
Fetches the AIFA (Agenzia Italiana del Farmaco) shortage CSV.

Source: https://www.aifa.gov.it/documents/20142/847339/elenco_medicinali_carenti.csv
Format: cp1252 encoded, semicolon-delimited CSV with 2 preamble rows
"""
from __future__ import annotations

import csv
import io
import logging
import re
import requests
from datetime import datetime, date
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

AIFA_CSV_URL = "https://www.aifa.gov.it/documents/20142/847339/elenco_medicinali_carenti.csv"
AIFA_SOURCE_URL = "https://www.aifa.gov.it/carenze"

# Header markers to find the real header row (skip preamble)
HEADER_MARKERS = {"nome medicinale", "nome", "principio attivo", "codice aic"}


class AIFAShortageScraper(BaseScraper):
    scraper_name = "aifa_shortage"
    country      = "IT"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching AIFA shortages...")

        r = requests.get(AIFA_CSV_URL, timeout=60, headers={
            "User-Agent": "Mederti-Scraper/1.0",
        })
        r.raise_for_status()

        # cp1252 handles Italian characters (accents, curly quotes)
        text = r.content.decode("cp1252", errors="replace")

        all_rows = list(csv.reader(io.StringIO(text), delimiter=";"))
        if len(all_rows) < 3:
            log.error(f"AIFA CSV too short ({len(all_rows)} rows)")
            return []

        # Find the header row (skip preamble/disclaimer rows)
        header_idx = 2  # safe default
        for i, row in enumerate(all_rows[:6]):
            first = row[0].strip().lower() if row else ""
            if first in HEADER_MARKERS or first.startswith("nome med"):
                header_idx = i
                break

        headers = [h.strip() for h in all_rows[header_idx]]
        log.info(f"  AIFA CSV headers at row {header_idx}: {headers[:5]}...")

        today = date.today()
        records = []
        skipped = 0

        for row in all_rows[header_idx + 1:]:
            if not any(cell.strip() for cell in row):
                continue  # skip blank rows

            # Pad short rows
            padded = row + [""] * max(0, len(headers) - len(row))
            item = {headers[i]: padded[i].strip() for i in range(len(headers))}

            rec = self._process_row(item, today)
            if rec:
                records.append(rec)
            else:
                skipped += 1

        log.info(f"  Matched {len(records)} records (skipped {skipped})")
        return records

    def _process_row(self, item: dict, today: date) -> dict | None:
        """Convert a single AIFA CSV row to a drug_availability record."""
        # ── Drug identity: Principio attivo (INN) ────────────────────────
        principio = (item.get("Principio attivo") or "").strip()
        nome      = (item.get("Nome medicinale") or "").strip()

        ingredient_name = principio or nome
        if not ingredient_name:
            return None

        # ── Skip discontinued / resolved ─────────────────────────────────
        motivazioni = (item.get("Motivazioni") or "").strip().lower()
        if "cessata commercializzazione" in motivazioni or "ritiro dal commercio" in motivazioni:
            return None  # discontinued — not an active shortage

        # Check if estimated end date is in the past
        fine_presunta = self._parse_italian_date(item.get("Fine presunta"))
        if fine_presunta:
            try:
                end_dt = date.fromisoformat(fine_presunta)
                if end_dt < today:
                    return None  # resolved
            except ValueError:
                pass

        # ── Ingredient lookup ────────────────────────────────────────────
        ingredient_id = self.lookup_ingredient_id(ingredient_name.lower().strip())
        if not ingredient_id:
            log.debug(f"  No ingredient match for: {ingredient_name}")
            return None

        # ── Severity ─────────────────────────────────────────────────────
        reimbursement = (item.get("Classe di rimborsabilità") or "").strip().upper()
        severity = "critical" if "OSPED" in reimbursement else "medium"

        # ── Reason ───────────────────────────────────────────────────────
        reason = (item.get("Motivazioni") or "").strip() or None

        return {
            "product_id":         None,
            "ingredient_id":      ingredient_id,
            "country":            "IT",
            "status":             "shortage",
            "severity":           severity,
            "shortage_reason":    reason,
            "expected_resolution": fine_presunta,
            "source_agency":      "AIFA",
            "source_url":         AIFA_SOURCE_URL,
            "last_verified_at":   self.now_iso(),
        }

    @staticmethod
    def _parse_italian_date(raw: str | None) -> str | None:
        """Parse DD/MM/YYYY (Italian format) → ISO-8601."""
        if not raw or not str(raw).strip():
            return None
        val = str(raw).strip()
        # Try DD/MM/YYYY
        m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", val)
        if m:
            day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                return None
        # Try ISO YYYY-MM-DD
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", val)
        if m:
            return val[:10]
        return None
