"""
BfArM / PharmNet Medicine Shortage Scraper (Railway)
Fetches the PharmNet.Bund public CSV of shortage notifications (Germany).

Source: https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv
Format: Latin-1 encoded, semicolon-delimited CSV
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

BFARM_CSV_URL = "https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv"

# Meldungsart → is this an active shortage?
ACTIVE_TYPES = {"erstmeldung", "änderungsmeldung"}
RESOLVED_TYPES = {"abschlussmeldung"}

# Art des Grundes (German reason category) → severity hint
SEVERITY_HOSPITAL = "ja"  # Krankenhausrelevant


class BfArMShortageScraper(BaseScraper):
    scraper_name = "bfarm_shortage"
    country      = "DE"

    def scrape(self) -> list[dict]:
        log.info(f"[{self.scraper_name}] Fetching BfArM shortages...")

        r = requests.get(BFARM_CSV_URL, timeout=60, headers={
            "User-Agent": "Mederti-Scraper/1.0",
        })
        r.raise_for_status()

        # Latin-1 handles German umlauts (ä/ö/ü/ß)
        text = r.content.decode("latin-1", errors="replace")
        text = text.lstrip("\ufeff")  # strip BOM if present

        reader = csv.DictReader(io.StringIO(text), delimiter=";")
        raw_rows = list(reader)

        # Clean field names (strip whitespace)
        rows = []
        for row in raw_rows:
            rows.append({k.strip(): (v.strip() if isinstance(v, str) else v)
                         for k, v in row.items()})

        log.info(f"  BfArM CSV: {len(rows)} total rows")

        records = []
        skipped_resolved = 0
        for row in rows:
            # Skip resolved shortages
            meldungsart = (row.get("Meldungsart") or "").strip().lower()
            if meldungsart in RESOLVED_TYPES:
                skipped_resolved += 1
                continue

            rec = self._process_row(row)
            if rec:
                records.append(rec)

        log.info(f"  Matched {len(records)} records (skipped {skipped_resolved} resolved)")
        return records

    def _process_row(self, row: dict) -> dict | None:
        """Convert a single BfArM CSV row to a drug_availability record."""
        # ── Drug identity: prefer Wirkstoffe (INN) ──────────────────────
        wirkstoffe = (row.get("Wirkstoffe") or "").strip()
        drug_name = (
            row.get("Arzneimittlbezeichnung") or  # source typo
            row.get("Arzneimittelbezeichnung") or  # corrected
            ""
        ).strip()

        ingredient_name = wirkstoffe or drug_name
        if not ingredient_name:
            return None

        # ── Ingredient lookup ────────────────────────────────────────────
        ingredient_id = self.lookup_ingredient_id(ingredient_name.lower().strip())
        if not ingredient_id:
            log.debug(f"  No ingredient match for: {ingredient_name}")
            return None

        # ── Severity ─────────────────────────────────────────────────────
        krankenhaus = (row.get("Krankenhausrelevant") or "").strip().lower()
        severity = "high" if krankenhaus == SEVERITY_HOSPITAL else "medium"

        # ── Expected resolution ──────────────────────────────────────────
        expected = self._parse_german_date(row.get("Ende"))

        # ── Reason ───────────────────────────────────────────────────────
        art_des_grundes = (row.get("Art des Grundes") or "").strip()
        grund_detail    = (row.get("Grund") or "").strip()
        reason = grund_detail or art_des_grundes or None

        return {
            "product_id":         None,
            "ingredient_id":      ingredient_id,
            "country":            "DE",
            "status":             "shortage",
            "severity":           severity,
            "shortage_reason":    reason,
            "expected_resolution": expected,
            "source_agency":      "BfArM",
            "source_url":         BFARM_CSV_URL,
            "last_verified_at":   self.now_iso(),
        }

    @staticmethod
    def _parse_german_date(raw: str | None) -> str | None:
        """Parse DD.MM.YYYY (German format) → ISO-8601."""
        if not raw or not str(raw).strip():
            return None
        val = str(raw).strip()
        # Try DD.MM.YYYY
        m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", val)
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
