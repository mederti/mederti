"""
Fimea (Finland) Medicine Shortage Scraper (Railway)
Fetches the Fimea open-data shortage CSV.

Source: https://data.pilvi.fimea.fi/avoin-data/Saatavuushairiot.txt
Format: semicolon-delimited CSV with double-quoted fields

Columns:
    VNR                        Nordic Article Number (6-digit product ID)
    Voimassa                   "K" = active, "E" = resolved
    SaatavuushairioAlkupaiva   Shortage start date (YYYY-MM-DD)
    SaatavuushairioLoppupaiva  Shortage end date (YYYY-MM-DD)
    Ilmoituspaiva              Notification date (YYYY-MM-DD)
    Muokkauspaiva              Last modified date (YYYY-MM-DD)
    Yritys                     Manufacturer / company name

Note: The source data does NOT contain drug names — only VNR numbers.
We attempt ingredient lookup using the manufacturer name as a hint,
but match rates will be low until a VNR→INN mapping table is imported.
"""
from __future__ import annotations

import csv
import io
import logging
import requests
from datetime import datetime, date
from base_scraper import BaseScraper

log = logging.getLogger(__name__)

FIMEA_URL = "https://data.pilvi.fimea.fi/avoin-data/Saatavuushairiot.txt"
FIMEA_SOURCE_URL = "https://fimea.fi/laakehaut_ja_luettelot/laakehaku"


class FimeaShortageScraper(BaseScraper):
    scraper_name = "fimea_shortage"
    country      = "FI"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching Fimea shortages...")

        r = requests.get(FIMEA_URL, timeout=30, headers={
            "User-Agent": "Mederti-Scraper/1.0",
        })
        r.raise_for_status()

        reader = csv.reader(
            io.StringIO(r.text),
            delimiter=";",
            quotechar='"',
        )

        header_seen = False
        records = []
        skipped = 0
        total = 0

        for row in reader:
            if not any(cell.strip() for cell in row):
                continue

            # Skip header row
            if not header_seen:
                header_seen = True
                log.info(f"  Fimea CSV header: {row}")
                continue

            total += 1
            rec = self._process_row(row)
            if rec:
                records.append(rec)
            else:
                skipped += 1

        log.info(f"  Fimea: {total} rows, matched {len(records)}, skipped {skipped}")
        return records

    def _process_row(self, row: list[str]) -> dict | None:
        """Convert a single Fimea CSV row to a drug_availability record."""
        if len(row) < 7:
            return None

        vnr      = row[0].strip()
        voimassa = row[1].strip().upper()
        end_raw  = row[3].strip()
        yritys   = row[6].strip()

        if not vnr:
            return None

        # Only include active shortages (K = Kyllä = Yes)
        if voimassa != "K":
            return None

        # ── Product/ingredient lookup ────────────────────────────────────
        # Fimea data has no drug name, only VNR.
        # We can't do a meaningful lookup without a VNR→INN mapping.
        # For now, try a broad ingredient search using the VNR as a
        # registry_id (unlikely to match, but forward-compatible).
        product_id = self.lookup_product_id(vnr, "FIMEA_VNR")

        ingredient_id = None
        if not product_id:
            # No ingredient name available — skip this record
            # (Future: import a VNR→INN mapping table)
            return None

        # ── Expected resolution ──────────────────────────────────────────
        expected = self._parse_iso_date(end_raw)

        return {
            "product_id":         product_id,
            "ingredient_id":      ingredient_id,
            "country":            "FI",
            "status":             "shortage",
            "severity":           "medium",  # No severity data in source
            "shortage_reason":    None,
            "expected_resolution": expected,
            "source_agency":      "Fimea",
            "source_url":         FIMEA_SOURCE_URL,
            "last_verified_at":   self.now_iso(),
        }

    @staticmethod
    def _parse_iso_date(raw: str) -> str | None:
        """Parse YYYY-MM-DD → ISO-8601 (validate)."""
        if not raw or not raw.strip():
            return None
        val = raw.strip()
        if len(val) == 10 and val[4] == "-" and val[7] == "-":
            try:
                date.fromisoformat(val)
                return val
            except ValueError:
                return None
        return None
