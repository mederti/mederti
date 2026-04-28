"""
ANMAT Argentina Drug Alert Scraper
-----------------------------------
Source:  ANMAT — Alertas de Medicamentos
URL:     https://www.argentina.gob.ar/anmat/alertas

ANMAT (Administracion Nacional de Medicamentos, Alimentos y Tecnologia Medica)
publishes drug alerts on their website, including shortage notifications
(desabastecimiento), market withdrawals (retiro del mercado), and
suspensions (suspension). The alerts page is in Spanish.

Data source UUID:  10000000-0000-0000-0000-000000000051
Country:           Argentina
Country code:      AR
Confidence:        72/100 (official regulatory body, but alerts may lag)

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class ArgentinaANMATScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000051"
    SOURCE_NAME: str  = "ANMAT — Alertas de Medicamentos"
    BASE_URL: str     = "https://www.argentina.gob.ar/anmat/alertas/medicamentos"
    NOTICIAS_URL: str = "https://www.argentina.gob.ar/anmat/alertas/medicamentos/noticias"
    COUNTRY: str      = "Argentina"
    COUNTRY_CODE: str = "AR"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "2.0.0"

    # Spanish reason keywords -> reason_category
    _REASON_MAP: dict[str, str] = {
        "desabastecimiento":       "supply_chain",
        "falta de abastecimiento": "supply_chain",
        "falta de stock":          "supply_chain",
        "retiro del mercado":      "discontinuation",
        "retiro preventivo":       "discontinuation",
        "retiro voluntario":       "discontinuation",
        "suspension":              "regulatory_action",
        "suspensión":              "regulatory_action",
        "prohibicion":             "regulatory_action",
        "prohibición":             "regulatory_action",
        "falsificado":             "regulatory_action",
        "falsificacion":           "regulatory_action",
        "calidad":                 "manufacturing_issue",
        "defecto de calidad":      "manufacturing_issue",
        "problema de fabricacion":  "manufacturing_issue",
        "problema de fabricación":  "manufacturing_issue",
        "produccion":              "manufacturing_issue",
        "producción":              "manufacturing_issue",
        "contaminacion":           "manufacturing_issue",
        "contaminación":           "manufacturing_issue",
        "demanda":                 "demand_surge",
        "materia prima":           "raw_material",
        "materias primas":         "raw_material",
        "distribucion":            "distribution",
        "distribución":            "distribution",
        "importacion":             "distribution",
        "importación":             "distribution",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch ANMAT drug alert data.

        Strategy:
        1. GET the paginated noticias listing (all medicine alerts).
        2. Parse panel cards with <time> and <h3> children.
        3. Fall back to main page if noticias fails.
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.NOTICIAS_URL,
        })

        records: list[dict] = []
        seen_urls: set[str] = set()

        # Paginate through the noticias listing
        for page_num in range(20):  # Cap at 20 pages
            url = f"{self.NOTICIAS_URL}?page={page_num}" if page_num > 0 else self.NOTICIAS_URL
            try:
                resp = self._get(url)
                soup = BeautifulSoup(resp.text, "html.parser")
                page_records = self._parse_panel_cards(soup, seen_urls)

                if not page_records:
                    self.log.info(
                        "No more records on page",
                        extra={"page": page_num},
                    )
                    break

                records.extend(page_records)
                self.log.info(
                    "Parsed ANMAT noticias page",
                    extra={"page": page_num, "records_on_page": len(page_records)},
                )
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch ANMAT noticias page",
                    extra={"page": page_num, "error": str(exc)},
                )
                break

        # Fallback: try the main page if noticias produced nothing
        if not records:
            self.log.info("Noticias empty, trying main page")
            try:
                resp = self._get(self.BASE_URL)
                soup = BeautifulSoup(resp.text, "html.parser")
                records = self._parse_panel_cards(soup, seen_urls)
            except Exception as exc:
                self.log.warning(
                    "Main page fallback also failed",
                    extra={"error": str(exc)},
                )

        self.log.info(
            "ANMAT fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_panel_cards(self, soup, seen_urls: set[str]) -> list[dict]:
        """Parse panel card elements into raw record dicts."""
        records: list[dict] = []

        # ANMAT uses <a class="panel panel-default"> cards with <time> and <h3>
        panels = soup.select("a.panel.panel-default")
        if not panels:
            # Fallback: try other common card patterns
            panels = (
                soup.select(".views-row a[href]")
                or soup.select("article a[href]")
                or soup.select(".item-list li a[href]")
            )

        for panel in panels:
            href = panel.get("href", "")
            if not href:
                continue
            if href and not href.startswith("http"):
                href = f"https://www.argentina.gob.ar{href}"
            if href in seen_urls:
                continue
            seen_urls.add(href)

            # Extract title from <h3> or text
            title_el = panel.select_one("h3") or panel.select_one("h2")
            title = title_el.get_text(strip=True) if title_el else panel.get_text(strip=True)
            if not title or len(title) < 5:
                continue

            # Extract date from <time datetime="...">
            date_text = ""
            time_el = panel.select_one("time")
            if time_el:
                date_text = time_el.get("datetime", "") or time_el.get_text(strip=True)

            # Extract summary from <p> if present
            summary_el = panel.select_one("p")
            summary = summary_el.get_text(strip=True) if summary_el else ""

            records.append({
                "title": title,
                "url": href,
                "date": date_text,
                "summary": summary,
            })

        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ANMAT records into standard shortage event dicts."""
        self.log.info(
            "Normalising ANMAT records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0
        today = date.today().isoformat()

        for rec in raw:
            try:
                result = self._normalise_record(rec, today)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise ANMAT record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single ANMAT record to a normalised shortage event dict."""
        title = str(rec.get("title") or "").strip()
        if not title:
            return None

        # Extract drug name from alert title
        generic_name = self._extract_drug_name(title)
        if not generic_name:
            # Use the full title as a fallback name
            generic_name = title[:100]

        # Determine reason and status from title and summary
        combined_text = f"{title} {rec.get('summary', '')}".lower()
        reason, status = self._classify_alert(combined_text)
        reason_category = self._map_reason(combined_text)

        # Parse date
        start_date = self._parse_date(rec.get("date")) or today

        # Determine severity
        severity = self._determine_severity(combined_text, status)

        # Build source URL
        source_url = rec.get("url") or self.BASE_URL

        # Build notes
        notes_parts: list[str] = []
        if rec.get("summary"):
            notes_parts.append(f"Summary: {rec['summary'][:300]}")
        notes_parts.append(f"Alert title: {title[:200]}")
        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             [],
            "status":                  status,
            "severity":                severity,
            "reason":                  reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 72,
            "raw_record":              rec,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _extract_drug_name(self, title: str) -> str:
        """
        Extract a drug or product name from an ANMAT alert title.

        ANMAT titles often follow patterns like:
            "Alerta sobre [drug name] ..."
            "Retiro del mercado de [drug name]"
            "Suspensión de [drug name]"
            "[Drug name] - disposición XXXX"
        """
        # Remove common prefixes
        cleaned = re.sub(
            r'^(?:alerta\s+(?:sobre|de|por)\s+|'
            r'retiro\s+(?:del\s+mercado\s+)?(?:de|del)\s+|'
            r'suspensi[oó]n\s+(?:de|del)\s+|'
            r'prohibici[oó]n\s+(?:de|del)\s+|'
            r'comunicado\s+(?:sobre|de)\s+)',
            '',
            title,
            flags=re.IGNORECASE,
        ).strip()

        # Remove trailing disposition/reference numbers
        cleaned = re.sub(
            r'\s*[-–]\s*(?:disposici[oó]n|resoluci[oó]n|nota)\s+.*$',
            '',
            cleaned,
            flags=re.IGNORECASE,
        ).strip()

        # Remove trailing date patterns
        cleaned = re.sub(
            r'\s*[-–]\s*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\s*$',
            '',
            cleaned,
        ).strip()

        # Take the first meaningful segment (before common delimiters)
        parts = re.split(r'\s*[–—|]\s*', cleaned)
        if parts:
            cleaned = parts[0].strip()

        # Limit length
        if len(cleaned) > 120:
            cleaned = cleaned[:120].rsplit(" ", 1)[0]

        return cleaned if len(cleaned) >= 3 else ""

    def _classify_alert(self, text: str) -> tuple[str, str]:
        """
        Classify an alert's reason and status from its text content.

        Returns:
            (reason_text, status)
        """
        text_lower = text.lower()

        # Shortage / supply
        if any(kw in text_lower for kw in
               ("desabastecimiento", "falta de abastecimiento", "falta de stock",
                "escasez", "faltante")):
            return ("Desabastecimiento (shortage)", "active")

        # Withdrawal
        if any(kw in text_lower for kw in
               ("retiro del mercado", "retiro preventivo", "retiro voluntario",
                "retirada")):
            return ("Retiro del mercado (market withdrawal)", "active")

        # Suspension
        if any(kw in text_lower for kw in ("suspension", "suspensión")):
            return ("Suspension", "active")

        # Prohibition / ban
        if any(kw in text_lower for kw in ("prohibicion", "prohibición")):
            return ("Prohibicion (prohibition)", "active")

        # Counterfeit / falsified
        if any(kw in text_lower for kw in ("falsificado", "falsificacion", "falsificación")):
            return ("Producto falsificado (counterfeit)", "active")

        # Quality issue
        if any(kw in text_lower for kw in ("calidad", "defecto")):
            return ("Defecto de calidad (quality defect)", "active")

        # Recovery / seizure
        if any(kw in text_lower for kw in ("recupero", "decomiso")):
            return ("Recupero de producto (product recovery)", "active")

        # Ban / prohibition
        if any(kw in text_lower for kw in ("prohibe", "prohibio", "prohibió")):
            return ("Prohibicion (prohibition)", "active")

        # Licence revocation
        if any(kw in text_lower for kw in ("baja de habilitacion", "baja de habilitación")):
            return ("Baja de habilitacion (licence revocation)", "active")

        # Lifted / resolved
        if any(kw in text_lower for kw in ("resuelto", "normalizado", "restablecido", "levanto", "levantó")):
            return ("Resuelto (resolved)", "resolved")

        return ("Alerta de medicamento", "active")

    def _determine_severity(self, text: str, status: str) -> str:
        """Determine severity based on alert content."""
        text_lower = text.lower()

        # High severity triggers
        if any(kw in text_lower for kw in
               ("falsificado", "falsificacion", "contaminacion", "contaminación",
                "prohibicion", "prohibición", "peligro", "riesgo grave",
                "riesgo para la salud")):
            return "high"

        # Low severity triggers
        if any(kw in text_lower for kw in
               ("resuelto", "normalizado", "informativo")):
            return "low"

        return "medium"

    def _map_reason(self, raw: str) -> str:
        """Map ANMAT reason text to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper
        return map_reason_category(raw)

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None

        # Fast-path for YYYY-MM-DD HH:MM:SS from <time datetime>
        match = re.match(r'^(\d{4}-\d{2}-\d{2})', raw_str)
        if match:
            return match.group(1)

        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str, dayfirst=True)  # Argentine dates are DD/MM/YYYY
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass
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
        print("Fetches live ANMAT data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = ArgentinaANMATScraper(db_client=MagicMock())

        print("\n-- Fetching from ANMAT ...")
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

    scraper = ArgentinaANMATScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
