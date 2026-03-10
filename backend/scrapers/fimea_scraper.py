"""
Fimea Medicine Shortage Scraper
────────────────────────────────
Source:  Finnish Medicines Agency (Fimea)
URL:     https://data.pilvi.fimea.fi/avoin-data/Saatavuushairiot.txt
Docs:    https://fimea.fi/laakehaut_ja_luettelot/laakehaku

Data format: semicolon-delimited CSV with double-quoted fields.

Header row:
    "VNR";"Voimassa";"SaatavuushairioAlkupaiva";"SaatavuushairioLoppupaiva";
    "Ilmoituspaiva";"Muokkauspaiva";"Yritys"

Field notes:
    VNR                        Nordic Article Number (6-digit product ID)
    Voimassa                   "K" = active (Finnish: Kyllä = Yes),
                               "E" = resolved/ended (Finnish: Ei = No)
    SaatavuushairioAlkupaiva   Shortage start date   (ISO YYYY-MM-DD)
    SaatavuushairioLoppupaiva  Shortage end date / estimated resolution (ISO YYYY-MM-DD)
    Ilmoituspaiva              Notification date     (ISO YYYY-MM-DD)
    Muokkauspaiva              Last modified date    (ISO YYYY-MM-DD)
    Yritys                     Manufacturer / company name

Drug name enrichment:
    Per-VNR HTTP lookups are intentionally skipped to keep the scraper fast.
    generic_name is set to "FI-VNR-{vnr}" and can be enriched separately.
    The Yritys (company) name is preserved in notes.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper


class FimeaScraper(BaseScraper):
    """Scraper for Fimea open-data medicine shortage list (Finland)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000013"
    SOURCE_NAME:  str = "Fimea (Finnish Medicines Agency)"
    BASE_URL:     str = "https://data.pilvi.fimea.fi/avoin-data/Saatavuushairiot.txt"
    COUNTRY:      str = "Finland"
    COUNTRY_CODE: str = "FI"

    RATE_LIMIT_DELAY: float = 1.5

    # ─────────────────────────────────────────────────────────────────────────
    # Status mapping: Finnish "Voimassa" field
    # K = Kyllä (Yes) → active shortage still in force
    # E = Ei    (No)  → shortage has ended / resolved
    # ─────────────────────────────────────────────────────────────────────────

    _STATUS_MAP: dict[str, str] = {
        "K": "active",
        "E": "resolved",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> str:
        """
        GET the Fimea open-data CSV endpoint.

        Returns the raw response text (semicolon-delimited CSV).
        """
        self.log.info(
            "Fetching Fimea shortage CSV",
            extra={"url": self.BASE_URL},
        )
        response = self._get(self.BASE_URL)
        self.log.info(
            "Fimea CSV fetched",
            extra={
                "bytes": len(response.content),
                "content_type": response.headers.get("content-type", ""),
            },
        )
        return response.text

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: str) -> list[dict]:
        """
        Parse the Fimea CSV and return a list of normalised shortage dicts.

        Each row becomes one shortage event keyed by VNR.  Drug names are set
        to "FI-VNR-{vnr}" because per-VNR lookups would be too slow at scale;
        an enrichment pass can backfill the real INN later.
        """
        self.log.info(
            "Normalising Fimea CSV records",
            extra={"source": self.SOURCE_NAME},
        )

        reader = csv.reader(
            io.StringIO(raw),
            delimiter=";",
            quotechar='"',
        )

        normalised: list[dict] = []
        skipped = 0
        header_seen = False

        for row in reader:
            # Skip blank lines
            if not any(cell.strip() for cell in row):
                continue

            # Skip the header row (first non-blank line)
            if not header_seen:
                header_seen = True
                self.log.debug(
                    "Fimea CSV header",
                    extra={"columns": row},
                )
                continue

            try:
                result = self._normalise_row(row)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise Fimea row",
                    extra={"error": str(exc), "row": row},
                )

        self.log.info(
            "Normalisation done",
            extra={
                "total":      len(normalised) + skipped,
                "normalised": len(normalised),
                "skipped":    skipped,
            },
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_row(self, row: list[str]) -> dict | None:
        """
        Map a single CSV row to the internal shortage dict format.

        Expected columns (0-indexed):
            0  VNR                        Nordic Article Number
            1  Voimassa                   K / E
            2  SaatavuushairioAlkupaiva   start date (YYYY-MM-DD)
            3  SaatavuushairioLoppupaiva  end / resolution date (YYYY-MM-DD)
            4  Ilmoituspaiva              notification date
            5  Muokkauspaiva              modification date
            6  Yritys                     manufacturer name

        Returns None if the row is malformed or VNR is missing.
        """
        if len(row) < 7:
            return None

        vnr          = row[0].strip()
        voimassa     = row[1].strip().upper()
        start_raw    = row[2].strip()
        end_raw      = row[3].strip()
        ilmoitus_raw = row[4].strip()
        muokkaus_raw = row[5].strip()
        yritys       = row[6].strip()

        if not vnr:
            return None

        # ── Status ────────────────────────────────────────────────────────────
        status = self._STATUS_MAP.get(voimassa, "active")

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_iso_date(start_raw)
        end_date_val = self._parse_iso_date(end_raw)

        if not start_date:
            # Fall back to notification date
            start_date = self._parse_iso_date(ilmoitus_raw)
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        # For active shortages, the end date is an *estimated* resolution date.
        # For resolved shortages, it is the actual end date.
        end_date:                  str | None = end_date_val if status == "resolved" else None
        estimated_resolution_date: str | None = end_date_val if status == "active"   else None

        # ── Drug identity ─────────────────────────────────────────────────────
        # Per-VNR HTTP lookups are intentionally skipped (too slow).
        # Using a deterministic placeholder that a later enrichment job can resolve.
        generic_name = f"FI-VNR-{vnr}"

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts = [
            f"Manufacturer: {yritys}." if yritys else None,
            f"VNR: {vnr}.",
            "Finnish medicine shortage data from Fimea open data.",
        ]
        notes = " ".join(p for p in notes_parts if p)

        # ── Source URL ────────────────────────────────────────────────────────
        source_url = f"https://fimea.fi/laakehaut_ja_luettelot/laakehaku?nplId={vnr}"

        return {
            # Drug resolution
            "generic_name":               generic_name,
            "brand_names":                [],
            # Shortage event fields
            "status":                     status,
            "severity":                   "medium",    # No severity data in source
            "reason":                     None,
            "reason_category":            "supply_chain",
            "start_date":                 start_date,
            "end_date":                   end_date,
            "estimated_resolution_date":  estimated_resolution_date,
            "source_url":                 source_url,
            "notes":                      notes,
            # Original record for raw_data
            "raw_record": {
                "vnr":          vnr,
                "voimassa":     voimassa,
                "start_date":   start_raw,
                "end_date":     end_raw,
                "notified":     ilmoitus_raw,
                "modified":     muokkaus_raw,
                "manufacturer": yritys,
            },
        }

    @staticmethod
    def _parse_iso_date(raw: str) -> str | None:
        """
        Parse a Fimea ISO date string (YYYY-MM-DD) to ISO-8601.
        Returns None if the value is empty or unparseable.
        """
        if not raw or not raw.strip():
            return None
        try:
            dt = datetime.strptime(raw.strip(), "%Y-%m-%d")
            return dt.date().isoformat()
        except ValueError:
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
#
# Dry-run (no DB writes):
#     MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.fimea_scraper
#
# Live run (writes to Supabase):
#     python3 -m backend.scrapers.fimea_scraper
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys
    from collections import Counter

    from dotenv import load_dotenv

    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live Fimea data but makes NO database writes.")
        print("=" * 60)

        scraper = FimeaScraper(db_client=MagicMock())

        print("\n── Fetching from Fimea CSV endpoint ...")
        raw = scraper.fetch()
        print(f"── Raw bytes received   : {len(raw.encode())}")

        print("── Normalising records ...")
        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            print("\n── Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            status_counts = Counter(e["status"] for e in events)
            reason_counts = Counter(e.get("reason_category") for e in events)
            print("\n── Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # ── Live run ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)

    scraper = FimeaScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
