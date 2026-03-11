"""
Portugal INFARMED Drug Shortage / Discontinuation Scraper
─────────────────────────────────────────────────────────
Source:  INFARMED — Gestão de Descontinuações e Rupturas
URL:     https://www.infarmed.pt/web/infarmed/entidades/medicamentos-de-uso-humano/monitorizacao-do-mercado/gestao-de-descontinuacoes-e-rupturas

INFARMED (National Authority of Medicines and Health Products) publishes
information on drug supply disruptions and discontinuations in Portugal.
The page is in Portuguese. Data may appear as an HTML table, as a
downloadable Excel/CSV file, or as structured list items.

Portuguese key terms:
    descontinuação temporária   = temporary discontinuation → active
    descontinuação definitiva   = permanent discontinuation → active (discontinued)
    reativação                  = reactivation              → resolved
    ruptura / rutura            = shortage / rupture         → active
    indisponível                = unavailable                → active
    disponível                  = available                  → resolved
    suspensão                   = suspension                 → active

Data source UUID:  10000000-0000-0000-0000-000000000048
Country:           Portugal
Country code:      PT
Confidence:        86/100 (official regulator, may require translation)

Cron:  Every 24 hours
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class PortugalInfarmedScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000048"
    SOURCE_NAME: str  = "INFARMED — Gestão de Descontinuações e Rupturas"
    BASE_URL: str     = (
        "https://www.infarmed.pt/web/infarmed/entidades/"
        "medicamentos-de-uso-humano/monitorizacao-do-mercado/"
        "gestao-de-descontinuacoes-e-rupturas"
    )
    COUNTRY: str      = "Portugal"
    COUNTRY_CODE: str = "PT"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # Portuguese status keywords -> standard status
    _STATUS_MAP: dict[str, str] = {
        "descontinuação temporária":    "active",
        "descontinuacao temporaria":    "active",
        "temporária":                   "active",
        "temporaria":                   "active",
        "descontinuação definitiva":    "active",
        "descontinuacao definitiva":    "active",
        "definitiva":                   "active",
        "ruptura":                      "active",
        "rutura":                       "active",
        "shortage":                     "active",
        "indisponível":                 "active",
        "indisponivel":                 "active",
        "unavailable":                  "active",
        "suspensão":                    "active",
        "suspensao":                    "active",
        "reativação":                   "resolved",
        "reativacao":                   "resolved",
        "reactivation":                 "resolved",
        "disponível":                   "resolved",
        "disponivel":                   "resolved",
        "available":                    "resolved",
        "resolved":                     "resolved",
        "resolvido":                    "resolved",
        "resolvida":                    "resolved",
    }

    # Portuguese reason keywords -> reason_category
    _REASON_MAP: dict[str, str] = {
        "fabricação":           "manufacturing_issue",
        "fabricacao":           "manufacturing_issue",
        "fabrico":             "manufacturing_issue",
        "produção":             "manufacturing_issue",
        "producao":             "manufacturing_issue",
        "manufacturing":        "manufacturing_issue",
        "qualidade":            "manufacturing_issue",
        "quality":              "manufacturing_issue",
        "matéria-prima":        "raw_material",
        "materia-prima":        "raw_material",
        "matéria prima":        "raw_material",
        "materia prima":        "raw_material",
        "raw material":         "raw_material",
        "substância ativa":     "raw_material",
        "substancia ativa":     "raw_material",
        "procura":              "demand_surge",
        "demanda":              "demand_surge",
        "demand":               "demand_surge",
        "cadeia de abastecimento": "supply_chain",
        "abastecimento":        "supply_chain",
        "supply":               "supply_chain",
        "logística":            "supply_chain",
        "logistica":            "supply_chain",
        "distribuição":         "distribution",
        "distribuicao":         "distribution",
        "distribution":         "distribution",
        "importação":           "distribution",
        "importacao":           "distribution",
        "descontinuação":       "discontinuation",
        "descontinuacao":       "discontinuation",
        "discontinu":           "discontinuation",
        "retirada":             "discontinuation",
        "withdrawal":           "discontinuation",
        "regulamentar":         "regulatory_action",
        "regulatory":           "regulatory_action",
        "autorização":          "regulatory_action",
        "autorizacao":          "regulatory_action",
        "comercial":            "supply_chain",
        "commercial":           "supply_chain",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch INFARMED shortage/discontinuation data.

        Strategy:
        1. GET the main page, look for downloadable files (Excel/CSV links).
        2. If a download link is found, fetch and parse the file.
        3. Otherwise, parse HTML tables on the page.
        4. Fall back to structured list/div parsing.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        resp = self._get(self.BASE_URL)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: look for Excel/CSV download links
        records = self._try_download_files(soup)
        if records:
            self.log.info(
                "INFARMED file download parse complete",
                extra={"records": len(records)},
            )
            return records

        # Strategy 2: parse HTML tables
        records = self._parse_tables(soup)
        if records:
            self.log.info(
                "INFARMED table parse complete",
                extra={"records": len(records)},
            )
            return records

        # Strategy 3: parse structured list/div elements
        records = self._parse_list_items(soup)
        self.log.info(
            "INFARMED list parse complete",
            extra={"records": len(records)},
        )
        return records

    def _try_download_files(self, soup: BeautifulSoup) -> list[dict]:
        """
        Look for links to Excel (.xlsx, .xls) or CSV files on the page.
        If found, download and parse the first suitable file.
        """
        file_links: list[str] = []

        for link in soup.find_all("a", href=True):
            href = link["href"].lower()
            text = link.get_text(strip=True).lower()

            # Match file download links by extension or keyword
            if any(ext in href for ext in (".xlsx", ".xls", ".csv")):
                file_links.append(link["href"])
            elif any(
                kw in text
                for kw in ("download", "descarregar", "ficheiro", "excel",
                           "lista", "tabela")
            ):
                if any(ext in href for ext in (".xlsx", ".xls", ".csv")):
                    file_links.append(link["href"])

        if not file_links:
            self.log.info("No downloadable files found on INFARMED page")
            return []

        # Try to download and parse each file link
        for file_url in file_links:
            full_url = urljoin(self.BASE_URL, file_url)
            try:
                if file_url.lower().endswith(".csv"):
                    return self._parse_csv_download(full_url)
                else:
                    return self._parse_excel_download(full_url)
            except Exception as exc:
                self.log.warning(
                    "Failed to parse INFARMED download",
                    extra={"url": full_url, "error": str(exc)},
                )

        return []

    def _parse_excel_download(self, url: str) -> list[dict]:
        """Download and parse an Excel file from INFARMED."""
        import openpyxl

        self.log.info("Fetching INFARMED Excel file", extra={"url": url})
        resp = self._get(url)

        wb = openpyxl.load_workbook(
            io.BytesIO(resp.content),
            read_only=True,
            data_only=True,
        )
        ws = wb.active

        # Read headers from row 1
        headers: list[str] = []
        for cell in ws[1]:
            headers.append(str(cell.value or "").strip().lower())

        self.log.info(
            "INFARMED Excel headers",
            extra={"headers": headers, "rows": ws.max_row},
        )

        # Read data rows
        records: list[dict] = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            rec = {}
            for h, v in zip(headers, row):
                if h:
                    rec[h] = v
            if any(v for v in rec.values() if v is not None and str(v).strip()):
                records.append(rec)

        wb.close()

        self.log.info(
            "INFARMED Excel fetch complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_csv_download(self, url: str) -> list[dict]:
        """Download and parse a CSV file from INFARMED."""
        import csv

        self.log.info("Fetching INFARMED CSV file", extra={"url": url})
        resp = self._get(url)

        # Try common delimiters
        text = resp.text
        for delimiter in [";", ",", "\t"]:
            try:
                reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
                records = [row for row in reader if any(v.strip() for v in row.values())]
                if records and len(records[0]) > 1:
                    self.log.info(
                        "INFARMED CSV parsed",
                        extra={"records": len(records), "delimiter": repr(delimiter)},
                    )
                    # Lowercase all keys for consistency
                    return [{k.lower().strip(): v for k, v in rec.items()} for rec in records]
            except Exception:
                continue

        return []

    def _parse_tables(self, soup: BeautifulSoup) -> list[dict]:
        """Extract records from HTML <table> elements on the INFARMED page."""
        records: list[dict] = []

        tables = soup.find_all("table")
        for table in tables:
            # Read headers
            headers: list[str] = []
            header_row = table.find("thead")
            if header_row:
                for th in header_row.find_all(["th", "td"]):
                    headers.append(th.get_text(strip=True).lower())
            else:
                first_row = table.find("tr")
                if first_row:
                    for cell in first_row.find_all(["th", "td"]):
                        headers.append(cell.get_text(strip=True).lower())

            if not headers:
                continue

            # Check if this table looks like shortage/discontinuation data
            has_drug_col = any(
                kw in h
                for h in headers
                for kw in ("nome", "name", "dci", "inn", "medicamento",
                           "denominação", "denominacao", "substância",
                           "substancia", "produto", "product")
            )
            if not has_drug_col:
                continue

            # Parse data rows
            tbody = table.find("tbody") or table
            for tr in tbody.find_all("tr"):
                cells = tr.find_all(["td", "th"])
                if len(cells) < 2:
                    continue

                row: dict[str, str] = {}
                for i, cell in enumerate(cells):
                    key = headers[i] if i < len(headers) else f"col_{i}"
                    row[key] = cell.get_text(strip=True)

                # Skip header-like rows
                if any(
                    row.get(h, "").lower() == h
                    for h in headers
                    if h
                ):
                    continue

                if any(v.strip() for v in row.values()):
                    records.append(row)

        return records

    def _parse_list_items(self, soup: BeautifulSoup) -> list[dict]:
        """
        Extract records from structured elements on the page (CMS patterns,
        Liferay portlet structures commonly used by Portuguese government sites).
        """
        records: list[dict] = []

        # Liferay / INFARMED patterns
        selectors = [
            ".journal-content-article table tr",
            ".portlet-body table tr",
            ".asset-content table tr",
            ".web-content-article table tr",
            ".taglib-text table tr",
            "article table tr",
            ".entry-content table tr",
        ]

        for selector in selectors:
            rows = soup.select(selector)
            if rows:
                # Try to use the first row as headers
                header_cells = rows[0].find_all(["th", "td"])
                headers = [c.get_text(strip=True).lower() for c in header_cells]

                for tr in rows[1:]:
                    cells = tr.find_all(["td", "th"])
                    if len(cells) < 2:
                        continue
                    row: dict[str, str] = {}
                    for i, cell in enumerate(cells):
                        key = headers[i] if i < len(headers) else f"col_{i}"
                        row[key] = cell.get_text(strip=True)

                    if any(v.strip() for v in row.values()):
                        records.append(row)

                if records:
                    return records

        # Fallback: look for any structured text blocks
        content_area = (
            soup.select_one(
                ".journal-content-article, .portlet-body, "
                ".asset-content, #content, main, article"
            )
            or soup
        )

        for el in content_area.find_all(["li", "p", "div"]):
            text = el.get_text(" ", strip=True)
            # Look for entries that contain drug-like patterns (INN names)
            if len(text) >= 10 and re.search(
                r'(?:descontinua|ruptura|rutura|indisponível|indisponivel)',
                text,
                re.IGNORECASE,
            ):
                records.append({"raw_text": text})

        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize INFARMED records into standard shortage event dicts."""
        self.log.info(
            "Normalising INFARMED records",
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
                    "Failed to normalise INFARMED record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single INFARMED record to a normalised shortage event dict."""
        # -- Drug name extraction --
        # Try Portuguese column names first, then English fallbacks
        generic_name = (
            rec.get("dci")
            or rec.get("inn")
            or rec.get("denominação comum internacional")
            or rec.get("denominacao comum internacional")
            or rec.get("substância ativa")
            or rec.get("substancia ativa")
            or rec.get("nome")
            or rec.get("name")
            or rec.get("medicamento")
            or rec.get("denominação")
            or rec.get("denominacao")
            or rec.get("produto")
            or rec.get("product")
            or ""
        )
        if isinstance(generic_name, str):
            generic_name = generic_name.strip()
        else:
            generic_name = str(generic_name).strip()

        # If no structured name, try raw_text extraction
        if not generic_name and rec.get("raw_text"):
            raw_text = rec["raw_text"]
            # Try to get the first segment before a known Portuguese keyword
            parts = re.split(
                r'\s*[-–|:]\s*(?=descontinua|ruptura|rutura|indisponível|indisponivel)',
                raw_text,
                maxsplit=1,
                flags=re.IGNORECASE,
            )
            generic_name = parts[0].strip()[:100]

        if not generic_name:
            return None

        # -- Brand / trade name --
        brand_name = (
            rec.get("nome comercial")
            or rec.get("trade name")
            or rec.get("marca")
            or rec.get("brand")
            or rec.get("nome do medicamento")
            or ""
        )
        if isinstance(brand_name, str):
            brand_name = brand_name.strip()
        else:
            brand_name = str(brand_name).strip()

        brand_names = [brand_name] if brand_name and brand_name != generic_name else []

        # -- Status --
        raw_status = str(
            rec.get("estado")
            or rec.get("status")
            or rec.get("situação")
            or rec.get("situacao")
            or rec.get("tipo")
            or rec.get("type")
            or ""
        ).strip().lower()

        # Also check raw_text for status clues
        if not raw_status and rec.get("raw_text"):
            raw_status = rec["raw_text"].lower()

        status = "active"
        for key, mapped_status in self._STATUS_MAP.items():
            if key in raw_status:
                status = mapped_status
                break

        # -- Reason --
        raw_reason = str(
            rec.get("motivo")
            or rec.get("reason")
            or rec.get("causa")
            or rec.get("justificação")
            or rec.get("justificacao")
            or ""
        ).strip()

        reason_category = self._map_reason(raw_reason)

        # If the status text itself indicates discontinuation, set the category
        if reason_category == "unknown" and any(
            kw in raw_status
            for kw in ("descontinua", "definitiva", "withdrawal", "retirada")
        ):
            reason_category = "discontinuation"

        # -- Dates --
        raw_start = (
            rec.get("data início")
            or rec.get("data inicio")
            or rec.get("data de início")
            or rec.get("data de inicio")
            or rec.get("start date")
            or rec.get("data")
            or rec.get("date")
            or rec.get("data de notificação")
            or rec.get("data de notificacao")
            or ""
        )
        start_date = self._parse_date(raw_start) or today

        raw_end = (
            rec.get("data fim")
            or rec.get("data de fim")
            or rec.get("data prevista")
            or rec.get("data de resolução")
            or rec.get("data de resolucao")
            or rec.get("data reativação")
            or rec.get("data reativacao")
            or rec.get("end date")
            or rec.get("estimated end")
            or ""
        )
        end_date = self._parse_date(raw_end) if status == "resolved" else None
        estimated_resolution = self._parse_date(raw_end) if status == "active" else None

        # -- Dosage / presentation --
        dosage = str(
            rec.get("dosagem")
            or rec.get("dose")
            or rec.get("apresentação")
            or rec.get("apresentacao")
            or rec.get("forma farmacêutica")
            or rec.get("forma farmaceutica")
            or ""
        ).strip()

        # -- Holder / manufacturer --
        holder = str(
            rec.get("titular de aim")
            or rec.get("titular")
            or rec.get("fabricante")
            or rec.get("manufacturer")
            or rec.get("empresa")
            or rec.get("company")
            or ""
        ).strip()

        # -- Notes --
        notes_parts: list[str] = []
        if holder:
            notes_parts.append(f"Holder: {holder}")
        if dosage:
            notes_parts.append(f"Presentation: {dosage}")

        # Registration / AIM number
        aim_num = str(
            rec.get("nº aim")
            or rec.get("n aim")
            or rec.get("aim")
            or rec.get("registration")
            or ""
        ).strip()
        if aim_num:
            notes_parts.append(f"AIM: {aim_num}")

        if raw_status and raw_status not in ("", "active", "resolved"):
            notes_parts.append(f"Type: {raw_status.title()}")

        if rec.get("raw_text") and not rec.get("dci") and not rec.get("nome"):
            notes_parts.append(f"Source text: {rec['raw_text'][:150]}")

        notes = "; ".join(notes_parts) or None

        return {
            "generic_name":              generic_name.title(),
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "medium",
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution,
            "source_url":                self.BASE_URL,
            "notes":                     notes,
            "source_confidence_score":   86,
            "raw_record":                rec,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _map_reason(self, raw: str) -> str:
        """Map INFARMED Portuguese reason string to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()
        for key, cat in self._REASON_MAP.items():
            if key in lower:
                return cat
        # Fallback to centralized mapper (handles English/French/etc.)
        return map_reason_category(raw)

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various INFARMED date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None", "", "n/a"):
            return None

        # Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
        if "T" in raw_str:
            raw_str = raw_str[:10]
        iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', raw_str)
        if iso_match:
            return raw_str

        # Portuguese date format: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
        eu_match = re.match(
            r'^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$', raw_str
        )
        if eu_match:
            day, month, year = eu_match.groups()
            if len(year) == 2:
                year = f"20{year}"
            try:
                dt = datetime(int(year), int(month), int(day))
                return dt.date().isoformat()
            except ValueError:
                pass

        # Portuguese month names (e.g., "15 de março de 2026")
        pt_months: dict[str, int] = {
            "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3,
            "abril": 4, "maio": 5, "junho": 6, "julho": 7,
            "agosto": 8, "setembro": 9, "outubro": 10,
            "novembro": 11, "dezembro": 12,
        }
        pt_match = re.match(
            r'(\d{1,2})\s+(?:de\s+)?(\w+)\s+(?:de\s+)?(\d{4})',
            raw_str.lower(),
        )
        if pt_match:
            day_str, month_str, year_str = pt_match.groups()
            month_num = pt_months.get(month_str)
            if month_num:
                try:
                    dt = datetime(int(year_str), month_num, int(day_str))
                    return dt.date().isoformat()
                except ValueError:
                    pass

        # Fallback: dateutil parser
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str, dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass

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

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live INFARMED data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = PortugalInfarmedScraper(db_client=MagicMock())

        print("\n-- Fetching from INFARMED ...")
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

    scraper = PortugalInfarmedScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
