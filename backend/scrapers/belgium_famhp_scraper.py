"""
Belgium FAMHP Drug Supply Problem Scraper
─────────────────────────────────────────
Source:  Federal Agency for Medicines and Health Products (FAMHP)
URL:     https://www.famhp.be/en/human_use/medicines/medicines/supply_problems

The FAMHP publishes supply problem notifications for medicines marketed in
Belgium. The English-language page lists current supply problems as HTML
table rows or structured list items. This scraper fetches the page, parses
the tabular/list data with BeautifulSoup, and normalises each entry into
the standard Mederti shortage event format.

Data source UUID:  10000000-0000-0000-0000-000000000047
Country:           Belgium
Country code:      BE
Confidence:        87/100 (official regulator, structured data)

Cron:  Every 24 hours
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class BelgiumFamhpScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000047"
    SOURCE_NAME: str  = "Federal Agency for Medicines and Health Products — Supply Problems"
    BASE_URL: str     = "https://www.famhp.be/en/human_use/medicines/medicines/supply_problems"
    COUNTRY: str      = "Belgium"
    COUNTRY_CODE: str = "BE"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # FAMHP status keywords (English page)
    _STATUS_MAP: dict[str, str] = {
        "available":        "resolved",
        "resolved":         "resolved",
        "unavailable":      "active",
        "supply problem":   "active",
        "shortage":         "active",
        "limited":          "active",
        "anticipated":      "anticipated",
    }

    # FAMHP reason keywords -> reason_category
    _REASON_MAP: dict[str, str] = {
        "manufacturing":        "manufacturing_issue",
        "production":           "manufacturing_issue",
        "quality":              "manufacturing_issue",
        "gmp":                  "manufacturing_issue",
        "raw material":         "raw_material",
        "active substance":     "raw_material",
        "demand":               "demand_surge",
        "supply chain":         "supply_chain",
        "logistics":            "supply_chain",
        "distribution":         "distribution",
        "discontinu":           "discontinuation",
        "withdrawal":           "discontinuation",
        "regulatory":           "regulatory_action",
        "commercial":           "supply_chain",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch the FAMHP supply problems page and parse tabular/list data.

        Strategy:
        1. GET the English supply problems page.
        2. Parse with BeautifulSoup, looking for HTML tables first.
        3. Fall back to structured list/div elements if no table is found.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        resp = self._get(self.BASE_URL)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: look for HTML tables with shortage data
        records = self._parse_tables(soup)
        if records:
            self.log.info(
                "FAMHP table parse complete",
                extra={"records": len(records)},
            )
            return records

        # Strategy 2: look for structured list/div elements
        records = self._parse_list_items(soup)
        if records:
            self.log.info(
                "FAMHP list parse complete",
                extra={"records": len(records)},
            )
            return records

        # Strategy 3: look for links to detail pages and scrape those
        records = self._parse_detail_links(soup)
        self.log.info(
            "FAMHP detail-link parse complete",
            extra={"records": len(records)},
        )
        return records

    def _parse_tables(self, soup: BeautifulSoup) -> list[dict]:
        """Extract records from HTML <table> elements on the FAMHP page."""
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

            # Check if this table looks like shortage data
            has_drug_col = any(
                kw in h
                for h in headers
                for kw in ("name", "medicine", "drug", "product", "inn",
                           "substance", "active", "denomination")
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
        Extract records from structured <div> or <li> elements that contain
        supply problem notices (e.g., a list of medicine names with dates).
        """
        records: list[dict] = []

        # Look for common CMS patterns: views-row, field-content, etc.
        view_rows = soup.select(
            ".view-content .views-row, "
            ".view-content .views-table tbody tr, "
            "article.node, "
            ".field-content"
        )

        for row in view_rows:
            text = row.get_text(" ", strip=True)
            if len(text) < 5:
                continue

            rec: dict[str, str] = {"raw_text": text}

            # Try to extract structured fields from child elements
            title_el = row.select_one(
                ".views-field-title, .field-name-title, h3, h4, strong"
            )
            if title_el:
                rec["medicine_name"] = title_el.get_text(strip=True)

            date_el = row.select_one(
                ".views-field-field-date, .date-display-single, time"
            )
            if date_el:
                rec["date"] = date_el.get_text(strip=True)
                if date_el.get("datetime"):
                    rec["date_iso"] = date_el["datetime"]

            status_el = row.select_one(
                ".views-field-field-status, .field-name-field-status"
            )
            if status_el:
                rec["status"] = status_el.get_text(strip=True)

            reason_el = row.select_one(
                ".views-field-field-reason, .field-name-field-reason"
            )
            if reason_el:
                rec["reason"] = reason_el.get_text(strip=True)

            if rec.get("medicine_name") or rec.get("raw_text"):
                records.append(rec)

        return records

    def _parse_detail_links(self, soup: BeautifulSoup) -> list[dict]:
        """
        Discover links to individual supply problem detail pages and
        extract basic info from the link text and surrounding context.
        """
        records: list[dict] = []

        # Look for links within the main content area
        content_area = (
            soup.select_one("#content, .region-content, main, article")
            or soup
        )

        for link in content_area.find_all("a", href=True):
            href = link["href"]
            text = link.get_text(strip=True)

            # Filter for links that look like medicine/supply-problem detail pages
            if not text or len(text) < 3:
                continue
            if any(
                kw in href.lower()
                for kw in ("supply", "shortage", "medicine", "product", "unavailab")
            ):
                rec: dict[str, str] = {
                    "medicine_name": text,
                    "detail_url": href if href.startswith("http") else f"https://www.famhp.be{href}",
                }

                # Check surrounding text for date patterns
                parent = link.parent
                if parent:
                    parent_text = parent.get_text(" ", strip=True)
                    date_match = re.search(
                        r'(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})', parent_text
                    )
                    if date_match:
                        rec["date"] = date_match.group(1)

                records.append(rec)

        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize FAMHP records into standard shortage event dicts."""
        self.log.info(
            "Normalising FAMHP records",
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
                    "Failed to normalise FAMHP record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single FAMHP record to a normalised shortage event dict."""
        # -- Drug name extraction --
        generic_name = (
            rec.get("medicine_name")
            or rec.get("name")
            or rec.get("inn")
            or rec.get("substance")
            or rec.get("active substance")
            or rec.get("product")
            or rec.get("denomination")
            or rec.get("medicine")
            or rec.get("drug")
            or ""
        )
        if isinstance(generic_name, str):
            generic_name = generic_name.strip()
        else:
            generic_name = str(generic_name).strip()

        # If no structured name, try to extract from raw_text
        if not generic_name and rec.get("raw_text"):
            # Take the first meaningful segment (before date/status info)
            raw_text = rec["raw_text"]
            parts = re.split(r'\s*[-|:]\s*', raw_text, maxsplit=1)
            generic_name = parts[0].strip()[:100]

        if not generic_name:
            return None

        # -- Brand / trade name --
        brand_name = (
            rec.get("trade name")
            or rec.get("brand")
            or rec.get("product name")
            or ""
        )
        if isinstance(brand_name, str):
            brand_name = brand_name.strip()
        else:
            brand_name = str(brand_name).strip()

        brand_names = [brand_name] if brand_name and brand_name != generic_name else []

        # -- Status --
        raw_status = str(
            rec.get("status")
            or rec.get("availability")
            or ""
        ).strip().lower()

        status = "active"
        for key, mapped_status in self._STATUS_MAP.items():
            if key in raw_status:
                status = mapped_status
                break

        # -- Reason --
        raw_reason = str(
            rec.get("reason")
            or rec.get("cause")
            or rec.get("motif")
            or ""
        ).strip()

        reason_category = self._map_reason(raw_reason)

        # -- Dates --
        raw_date = (
            rec.get("date_iso")
            or rec.get("date")
            or rec.get("start date")
            or rec.get("notification date")
            or rec.get("start")
            or ""
        )
        start_date = self._parse_date(raw_date) or today

        raw_end = (
            rec.get("end date")
            or rec.get("resolution date")
            or rec.get("estimated end")
            or ""
        )
        end_date = self._parse_date(raw_end) if status == "resolved" else None
        estimated_resolution = self._parse_date(raw_end) if status == "active" else None

        # -- Source URL --
        source_url = rec.get("detail_url") or self.BASE_URL

        # -- Notes --
        notes_parts: list[str] = []
        for key in ("manufacturer", "company", "agent", "holder", "registration"):
            val = rec.get(key)
            if val and str(val).strip():
                notes_parts.append(f"{key.title()}: {str(val).strip()}")
        if rec.get("raw_text") and not rec.get("medicine_name"):
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
            "source_url":                source_url,
            "notes":                     notes,
            "source_confidence_score":   87,
            "raw_record":                rec,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _map_reason(self, raw: str) -> str:
        """Map FAMHP reason string to canonical reason_category."""
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
        """Parse various FAMHP date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None", ""):
            return None

        # Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
        if "T" in raw_str:
            raw_str = raw_str[:10]
        iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', raw_str)
        if iso_match:
            return raw_str

        # Try European format DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
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
        print("Fetches live FAMHP data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = BelgiumFamhpScraper(db_client=MagicMock())

        print("\n-- Fetching from FAMHP ...")
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

    scraper = BelgiumFamhpScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
