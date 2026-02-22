"""
BfArM / PharmNet Medicine Shortage Scraper
───────────────────────────────────────────
Source:  Bundesinstitut für Arzneimittel und Medizinprodukte (BfArM)
         via PharmNet.Bund public CSV endpoint
URL:     https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv

Data source (confirmed 2026-02-22):
    PharmNet.Bund exposes a single public CSV endpoint containing ALL shortage
    notifications submitted under §52b AMG (Arzneimittelgesetz).  No auth
    required.  Entire dataset returned in one GET request.

CSV format (confirmed):
    Encoding:   Latin-1 (ISO-8859-1 / Windows-1252 superset)
    Delimiter:  semicolon (;)
    Header row: row 0 (first row)
    ~941 active notifications as of late 2025; full dataset (incl. closed) larger

Key columns (22 total; field names have known typos from the source):
    PZN                     Pharmazentralnummer (pharmacy product code)
    ENR                     Erlaubnisnummer (authorization number)
    Meldungsart             Notification type:
                              Erstmeldung     = initial report  → active
                              Änderungsmeldung = update         → active
                              Abschlussmeldung = closure        → resolved
    Beginn                  Shortage start date (DD.MM.YYYY)
    Ende                    Expected end date  (DD.MM.YYYY, may be blank)
    Art des Grundes         Shortage reason category (German)
    Arzneimittlbezeichnung  Drug name (note: typo in source — missing 'e')
    Atc Code                ATC classification code (space, not underscore)
    Wirkstoffe              Active ingredient(s) / INN  ← use as generic_name
    Krankenhausrelevant     Hospital-relevant flag: Ja / Nein
    Zulassungsinhaber       Marketing Authorization Holder
    Grund                   Detailed reason text (free text)
    Darreichungsform        Dosage form

Data source UUID:  10000000-0000-0000-0000-000000000008  (BfArM, DE)
Country:           Germany
Country code:      DE
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class BfArMScraper(BaseScraper):
    """Scraper for BfArM medicine shortage notifications via PharmNet.Bund CSV."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000008"
    SOURCE_NAME:  str = "Bundesinstitut für Arzneimittel und Medizinprodukte — Lieferengpässe"
    BASE_URL:     str = "https://www.bfarm.de"
    SCRAPE_URL:   str = "https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv"
    COUNTRY:      str = "Germany"
    COUNTRY_CODE: str = "DE"

    RATE_LIMIT_DELAY: float = 2.0   # single bulk download

    # Meldungsart → status
    _STATUS_MAP: dict[str, str] = {
        "erstmeldung":       "active",
        "änderungsmeldung":  "active",
        "abschlussmeldung":  "resolved",
    }

    # Art des Grundes (German) → reason_category
    _REASON_MAP: dict[str, str] = {
        "produktionsproblem":        "manufacturing_issue",
        "qualitätsproblem":          "manufacturing_issue",
        "qualitaetsproblem":         "manufacturing_issue",
        "qualitätsmangel":           "manufacturing_issue",
        "nachfragesteigerung":       "demand_surge",
        "erhöhte nachfrage":         "demand_surge",
        "erhoehte nachfrage":        "demand_surge",
        "rohstoffmangel":            "raw_material",
        "rohstoff":                  "raw_material",
        "lieferproblem":             "supply_chain",
        "lieferengpass":             "supply_chain",
        "auslandslieferengpass":     "supply_chain",
        "vertriebseinstellung":      "discontinuation",
        "marktrücknahme":            "discontinuation",
        "marktruecknahme":           "discontinuation",
        "zulassungsablauf":          "regulatory_action",
        "regulatorisch":             "regulatory_action",
        "sonstiges":                 "unknown",
        "sonstige":                  "unknown",
        "unbekannt":                 "unknown",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """Download the PharmNet.Bund public CSV and return all rows as dicts."""
        response = self._get(self.SCRAPE_URL)
        # Latin-1 handles all German umlauts (ä/ö/ü/ß) in this source
        text = response.content.decode("latin-1", errors="replace")

        # Strip BOM if present
        text = text.lstrip("\ufeff")

        reader = csv.DictReader(io.StringIO(text), delimiter=";")
        records = list(reader)

        # Normalise field names: strip leading/trailing whitespace from keys
        cleaned: list[dict] = []
        for rec in records:
            cleaned.append({k.strip(): v.strip() if isinstance(v, str) else v
                             for k, v in rec.items()})

        self.log.info(
            "BfArM CSV fetch complete",
            extra={
                "total":   len(cleaned),
                "columns": list(cleaned[0].keys()) if cleaned else [],
            },
        )
        return cleaned

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising BfArM records",
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
                    "Failed to normalise BfArM record",
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

    def _normalise_record(self, rec: dict) -> dict | None:
        # ── Generic name: prefer Wirkstoffe (INN) over drug trade name ────────
        # Note the typo in field name: "Arzneimittlbezeichnung" (source has this)
        wirkstoffe = (rec.get("Wirkstoffe") or "").strip()
        drug_name  = (
            rec.get("Arzneimittlbezeichnung") or          # source typo
            rec.get("Arzneimittelbezeichnung") or          # corrected spelling
            rec.get("Arzneimittlbezeichung") or            # alternate typo
            ""
        ).strip()

        generic_name = wirkstoffe or drug_name
        if not generic_name:
            return None

        brand_name = drug_name if drug_name and drug_name.lower() != generic_name.lower() else None
        brand_names = [brand_name] if brand_name else []

        # ── Status ────────────────────────────────────────────────────────────
        meldungsart = (rec.get("Meldungsart") or "").strip().lower()
        status = self._STATUS_MAP.get(meldungsart, "active")

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date = self._parse_date(rec.get("Beginn"))
        if not start_date:
            start_date = self._parse_date(rec.get("Datum der Erstmeldung"))
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        raw_end = rec.get("Ende") or ""
        end_date = None
        estimated_resolution_date = None
        if raw_end.strip():
            parsed_end = self._parse_date(raw_end)
            if status == "resolved":
                end_date = parsed_end
            else:
                estimated_resolution_date = parsed_end

        # ── Reason ────────────────────────────────────────────────────────────
        art_des_grundes = (rec.get("Art des Grundes") or "").strip()
        reason_category = self._map_reason(art_des_grundes)
        grund_detail    = (rec.get("Grund") or "").strip() or None

        # ── Severity ──────────────────────────────────────────────────────────
        krankenhaus = (rec.get("Krankenhausrelevant") or "").strip().lower()
        severity = "high" if krankenhaus == "ja" else "medium"
        if status == "resolved":
            severity = "low"

        # ── Notes ─────────────────────────────────────────────────────────────
        mah      = (rec.get("Zulassungsinhaber") or "").strip()
        atc      = (rec.get("Atc Code") or rec.get("ATC Code") or "").strip()
        dform    = (rec.get("Darreichungsform") or "").strip()
        alt      = (rec.get("Alternativprparat") or rec.get("Alternativpräparat") or "").strip()
        info     = (rec.get("Info an Fachkreise") or "").strip()

        notes_parts: list[str] = []
        if mah:     notes_parts.append(f"MAH: {mah}")
        if atc:     notes_parts.append(f"ATC: {atc}")
        if dform:   notes_parts.append(f"Dosage form: {dform}")
        if grund_detail: notes_parts.append(grund_detail)
        if alt:     notes_parts.append(f"Alternative: {alt}")
        if info:    notes_parts.append(f"Info: {info}")
        notes: str | None = "\n".join(notes_parts) or None

        pzn = (rec.get("PZN") or "").strip()
        enr = (rec.get("ENR") or "").strip()
        source_url = (
            f"https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/"
            f"faces/public/meldungen.xhtml"
        )

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    grund_detail or (art_des_grundes or None),
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "pzn":            pzn or None,
                "enr":            enr or None,
                "meldungsart":    meldungsart or None,
                "art_des_grundes": art_des_grundes or None,
                "atc_code":       atc or None,
                "mah":            mah or None,
                "darreichungsform": dform or None,
                "krankenhausrelevant": krankenhaus or None,
            },
        }

    def _map_reason(self, raw: str) -> str:
        if not raw:
            return "unknown"
        lower = raw.lower()
        # Normalise ä/ö/ü for matching
        lower = lower.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
        for key, cat in self._REASON_MAP.items():
            norm_key = key.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
            if norm_key in lower:
                return cat
        return "unknown"

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """Parse DD.MM.YYYY (German format) → ISO-8601."""
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

        scraper = BfArMScraper(db_client=MagicMock())
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
                print(f"   {str(k):25s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = BfArMScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
