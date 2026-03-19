"""
AIFA — Quality Defects / Drug Recalls Scraper (Italy)
─────────────────────────────────────────────────────
Source:  Agenzia Italiana del Farmaco — Difetti di qualità
Page:   https://www.aifa.gov.it/en/difetti-di-qualit%C3%A01

AIFA publishes quarterly CSV files per year (2016–present). Each CSV
contains quality defect actions (Ritiro = withdrawal, Divieto = ban, etc.)
with product name, manufacturer, lot numbers, dates, and PDF links.

Strategy: scrape the landing page for CSV links, download the latest CSV
per year, parse and normalise all records.

Source UUID:  10000000-0000-0000-0000-000000000032
Country code: IT
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class AIFARecallsScraper(BaseRecallScraper):
    """Scraper for AIFA quality defect / recall data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000032"
    SOURCE_NAME:  str = "AIFA — Difetti di qualità (Italy)"
    BASE_URL:     str = "https://www.aifa.gov.it/en/difetti-di-qualit%C3%A01"
    COUNTRY:      str = "Italy"
    COUNTRY_CODE: str = "IT"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 20.0

    _HEADERS: dict = {
        "User-Agent": "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":     "text/html, text/csv, */*",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        1. Scrape the quality defects page for CSV download links.
        2. Pick the latest CSV per year.
        3. Download and parse each CSV.
        """
        all_records: list[dict] = []

        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            # Get the landing page
            self.log.info("Fetching AIFA quality defects page", extra={"url": self.BASE_URL})
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()

            # Extract CSV links
            csv_links = re.findall(r'href="(/documents/[^"]+\.csv)"', resp.text)
            if not csv_links:
                self.log.warning("No CSV links found on AIFA page")
                return []

            self.log.info("AIFA CSV links found", extra={"count": len(csv_links)})

            # Group by year, keep only the latest per year (first on page = latest)
            seen_years: set[str] = set()
            latest_per_year: list[str] = []

            for link in csv_links:
                year_match = re.search(r'(?:AIFA[_-])(\d{4})', link)
                if not year_match:
                    continue
                year = year_match.group(1)
                if year not in seen_years:
                    seen_years.add(year)
                    latest_per_year.append(link)

            self.log.info("AIFA: downloading latest CSV per year", extra={
                "years": sorted(seen_years),
                "files": len(latest_per_year),
            })

            # Download each CSV
            for csv_path in latest_per_year:
                url = f"https://www.aifa.gov.it{csv_path}"
                try:
                    csv_resp = client.get(url)
                    csv_resp.raise_for_status()
                    records = self._parse_csv(csv_resp.text, url)
                    all_records.extend(records)
                    self.log.info("AIFA CSV parsed", extra={
                        "url": csv_path.split("/")[-1],
                        "records": len(records),
                    })
                except Exception as exc:
                    self.log.warning("AIFA CSV download failed", extra={
                        "url": csv_path, "error": str(exc),
                    })

        self.log.info("AIFA fetch complete", extra={"total": len(all_records)})
        return all_records

    def _parse_csv(self, text: str, source_url: str) -> list[dict]:
        """Parse an AIFA quality defects CSV."""
        records = []
        reader = csv.DictReader(io.StringIO(text), delimiter=";")
        for row in reader:
            if not row.get("Medicinale"):
                continue
            records.append({**row, "_source_url": source_url})
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result:
                    normalised.append(result)
                else:
                    skipped += 1
            except Exception as exc:
                skipped += 1
                self.log.debug("AIFA normalise error", extra={"error": str(exc)})

        self.log.info("AIFA normalisation done", extra={
            "normalised": len(normalised), "skipped": skipped,
        })
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        name = (rec.get("Medicinale") or "").strip()
        if not name:
            return None

        form = (rec.get("Forma Farmaceutica") or "").strip()
        full_name = f"{name} {form}".strip() if form else name

        mah = (rec.get("Titolare AIC") or "").strip() or None

        lot_raw = rec.get("Numero Lotto") or ""
        lot_numbers = [l.strip() for l in re.split(r"[,;\-]", lot_raw) if l.strip()] if lot_raw else []

        date_raw = (rec.get("Data Provvedimento") or "").strip()
        announced_date = self._parse_date(date_raw)
        if not announced_date:
            announced_date = datetime.now(timezone.utc).date().isoformat()

        action = (rec.get("Provvedimento") or "").strip()
        recall_type = self._map_action(action)

        aic = (rec.get("AIC") or "").strip()
        recall_ref = f"AIFA-{aic}-{lot_raw.strip()}-{date_raw}" if aic else f"AIFA-{name[:40]}-{date_raw}"

        pdf_link = (rec.get("Link Provvedimento") or "").strip()
        press_url = pdf_link if pdf_link.startswith("http") else self.BASE_URL

        return {
            "generic_name":     full_name[:100],
            "brand_name":       name[:100] if form else None,
            "manufacturer":     mah[:200] if mah else None,
            "recall_class":     None,
            "recall_type":      recall_type,
            "reason":           f"{action} — AIC {aic}" if aic else action or None,
            "reason_category":  "other",
            "lot_numbers":      lot_numbers,
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 90,
            "recall_ref":       recall_ref[:100],
            "raw_record":       {k: str(v)[:200] for k, v in rec.items() if v},
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None

        it_months = {
            "gen": "01", "feb": "02", "mar": "03", "apr": "04",
            "mag": "05", "giu": "06", "lug": "07", "ago": "08",
            "set": "09", "ott": "10", "nov": "11", "dic": "12",
        }

        m = re.match(r"(\d{1,2})-(\w{3})-(\d{2,4})", raw)
        if m:
            day, mon, year = m.groups()
            month = it_months.get(mon.lower())
            if month:
                yr = int(year)
                if yr < 100:
                    yr += 2000
                try:
                    return f"{yr}-{month}-{int(day):02d}"
                except Exception:
                    pass

        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(raw.strip(), fmt).date().isoformat()
            except Exception:
                pass

        iso = re.search(r"\d{4}-\d{2}-\d{2}", raw)
        return iso.group(0) if iso else None

    @staticmethod
    def _map_action(action: str) -> str | None:
        """Map Italian action type to DB enum (batch, market_withdrawal, or NULL)."""
        lower = (action or "").lower()
        if "ritiro" in lower:
            return "batch"  # Ritiro = batch withdrawal
        if "divieto" in lower or "revoca" in lower:
            return "market_withdrawal"
        # sequestro (seizure), other → NULL
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — AIFA Recalls"); print("=" * 60)
        scraper = AIFARecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  raw records: {len(raw)}")
        recalls = scraper.normalize(raw)
        print(f"  normalised : {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = AIFARecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
