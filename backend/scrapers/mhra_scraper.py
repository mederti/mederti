"""
MHRA / NHSBSA Serious Shortage Protocols (SSP) Scraper
───────────────────────────────────────────────────────
Source:  NHS Business Services Authority — Serious Shortage Protocols
         (attributed to MHRA as the UK regulatory data source in our DB)
URL:     https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors
         /serious-shortage-protocols-ssps

Background:
    A Serious Shortage Protocol (SSP) is a legal instrument, issued under the
    Human Medicines Regulations 2012, that allows a pharmacist to dispense an
    alternative medicine (or a different quantity) without a new prescription
    when a named product is in critically short supply.  SSPs represent the
    most severe tier of UK medicine supply disruption — a formal legal protocol
    must be in place before any substitution is permitted at the dispensing counter.

    Note: the original NHS England supply disruptions URL
    (https://www.england.nhs.uk/medicines/supply-disruptions/) now returns 404.
    The NHSBSA SSP table is the best-structured publicly available equivalent.

Page structure (confirmed 2026-02-22):
    Single HTML page — no auth, no pagination.
    Two <table> elements, each preceded by an <h2> heading:
        "Active SSPs"   — currently in force            (~6 rows)
        "Expired SSPs"  — resolved / withdrawn          (~81 rows)

    Columns (identical for both tables, 0-indexed):
        0  Name of SSP / ref no.  <a> linking to the signed SSP PDF
        1  Start and end date     "DD Month YYYY to DD Month YYYY" (+ amendment notes)
        2  Supporting guidance    <a> linking to pharmacist endorsement guidance PDF

Data source UUID:  10000000-0000-0000-0000-000000000006  (MHRA, GB)
Country:           United Kingdom
Country code:      GB

Severity: All SSPs are mandated by law → at minimum "high".
          Life-critical drug keywords → "critical".
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class MHRAScraper(BaseScraper):
    """
    Scraper for UK Serious Shortage Protocols published by NHSBSA.
    Attributed to MHRA as the GB regulatory data source.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000006"
    SOURCE_NAME:  str = "Medicines and Healthcare products Regulatory Agency — Drug Alerts"
    BASE_URL:     str = "https://www.nhsbsa.nhs.uk"
    SCRAPE_URL:   str = (
        "https://www.nhsbsa.nhs.uk"
        "/pharmacies-gp-practices-and-appliance-contractors"
        "/serious-shortage-protocols-ssps"
    )
    COUNTRY:      str = "United Kingdom"
    COUNTRY_CODE: str = "GB"

    RATE_LIMIT_DELAY: float = 1.0   # single-page fetch; rate limit is just courtesy

    # ─────────────────────────────────────────────────────────────────────────
    # Compiled regexes
    # ─────────────────────────────────────────────────────────────────────────

    # e.g. "SSP082", "SSP001"
    _RE_SSP_REF = re.compile(r'\bSSP\d+\b', re.IGNORECASE)

    # Strip "(PDF: 218KB)", "(PDF:119KB)", etc.
    _RE_PDF_LABEL = re.compile(r'\s*\(PDF\s*:?\s*[\d.]+\s*\w+\)\s*', re.IGNORECASE)

    # "03 April 2025 to 17 April 2026"
    _RE_DATE_RANGE = re.compile(
        r'(\d{1,2}\s+\w+\s+\d{4})\s+to\s+(\d{1,2}\s+\w+\s+\d{4})',
        re.IGNORECASE,
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Severity: SSPs require a legal protocol → all are at least "high".
    # Life-critical drugs → "critical".
    # ─────────────────────────────────────────────────────────────────────────

    _CRITICAL_KEYWORDS: list[str] = [
        "insulin", "epinephrine", "adrenalin", "adrenaline",
        "vasopressin", "norepinephrine", "atropine",
        "sodium bicarbonate", "calcium gluconate",
        "naloxone", "morphine", "fentanyl", "propofol",
        "midazolam", "nitroglycerin",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Fetch the NHSBSA SSP page and return all SSP rows as a list of raw dicts.
        Active and Expired tables are both included, tagged by 'table_status'.
        No pagination — the entire dataset is on one page.
        """
        response = self._get(self.SCRAPE_URL)
        soup = BeautifulSoup(response.text, "lxml")

        records: list[dict] = []

        # Locate each table by the <h2> heading that precedes it.
        for h2 in soup.find_all("h2"):
            heading = h2.get_text(strip=True).lower()
            if "active" in heading:
                table_status = "active"
            elif "expired" in heading:
                table_status = "expired"
            else:
                continue

            table = h2.find_next_sibling("table") or h2.find_next("table")
            if not table:
                continue

            tbody = table.find("tbody") or table
            for row in tbody.find_all("tr"):
                cells = row.find_all("td")
                if len(cells) < 2:
                    continue  # skip header rows that ended up in tbody

                records.append({
                    "table_status":      table_status,
                    "name_cell_html":    str(cells[0]),
                    "date_cell_text":    cells[1].get_text(" ", strip=True),
                    "guidance_cell_html": str(cells[2]) if len(cells) > 2 else "",
                })

        active_count   = sum(1 for r in records if r["table_status"] == "active")
        expired_count  = sum(1 for r in records if r["table_status"] == "expired")
        self.log.info(
            "NHSBSA SSP fetch complete",
            extra={
                "total":   len(records),
                "active":  active_count,
                "expired": expired_count,
            },
        )
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising NHSBSA SSP records",
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
                    "Failed to normalise NHSBSA record",
                    extra={"error": str(exc), "row": str(rec)[:300]},
                )

        self.log.info(
            "Normalisation done",
            extra={
                "total":      len(records),
                "normalised": len(normalised),
                "skipped":    skipped,
            },
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        """Map one NHSBSA SSP row dict → internal shortage dict."""
        table_status: str = rec["table_status"]   # "active" | "expired"
        date_text:    str = rec["date_cell_text"]

        # ── Parse name cell ───────────────────────────────────────────────────
        name_soup = BeautifulSoup(rec["name_cell_html"], "lxml")
        a_tag = name_soup.find("a")
        if not a_tag:
            return None

        raw_link_text: str = a_tag.get_text(" ", strip=True)

        # Extract SSP reference number ("SSP082")
        ssp_ref: str | None = None
        ref_match = self._RE_SSP_REF.search(raw_link_text)
        if ref_match:
            ssp_ref = ref_match.group(0).upper()

        # Drug name: strip SSP ref prefix, "(PDF: ...)" suffix, trailing punctuation.
        drug_name = raw_link_text
        if ssp_ref:
            drug_name = re.sub(re.escape(ssp_ref), "", drug_name, count=1, flags=re.IGNORECASE)
        drug_name = self._RE_PDF_LABEL.sub("", drug_name)
        # Collapse multiple spaces (e.g. "Estradot  ® ..." → "Estradot ® ...")
        drug_name = re.sub(r' {2,}', ' ', drug_name)
        # Move ® / ™ flush against preceding word ("Estradot ®" → "Estradot®")
        drug_name = re.sub(r'\s+([®™])', r'\1', drug_name)
        drug_name = drug_name.strip(" .,;")
        if not drug_name:
            return None

        # SSP PDF source URL
        href: str = a_tag.get("href", "")
        source_url = urljoin(self.BASE_URL, href) if href else self.SCRAPE_URL

        # ── Guidance PDF URL (column 2) ───────────────────────────────────────
        guidance_url: str | None = None
        guidance_html = rec.get("guidance_cell_html", "")
        if guidance_html:
            g_soup = BeautifulSoup(guidance_html, "lxml")
            g_tag = g_soup.find("a")
            if g_tag and g_tag.get("href"):
                guidance_url = urljoin(self.BASE_URL, g_tag["href"])

        # ── Dates ─────────────────────────────────────────────────────────────
        start_date: str | None = None
        end_date:   str | None = None
        estimated_resolution_date: str | None = None

        date_match = self._RE_DATE_RANGE.search(date_text)
        if date_match:
            start_date = self._parse_date(date_match.group(1))
            parsed_end = self._parse_date(date_match.group(2))
            # For Active SSPs the "end date" is still in the future → it's the
            # expected resolution date, not a confirmed closed date.
            if table_status == "active":
                estimated_resolution_date = parsed_end
            else:
                end_date = parsed_end
        else:
            # Fallback: try parsing the whole cell as a single date
            start_date = self._parse_date(date_text)

        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        # ── Status ────────────────────────────────────────────────────────────
        status = "active" if table_status == "active" else "resolved"

        # ── Amendment / withdrawal note ───────────────────────────────────────
        amendment_note: str | None = None
        if date_match:
            tail = date_text[date_match.end():].strip(" .,|\t\n")
            if tail:
                amendment_note = tail

        # "withdrawn early" → reason_category becomes regulatory_action
        reason_category = "supply_chain"
        if amendment_note and "withdrawn" in amendment_note.lower():
            reason_category = "regulatory_action"

        # ── Severity: SSPs are legally mandated → at least "high" ────────────
        combined_lower = drug_name.lower()
        severity = (
            "critical"
            if any(kw in combined_lower for kw in self._CRITICAL_KEYWORDS)
            else "high"
        )

        # ── Notes ─────────────────────────────────────────────────────────────
        notes_parts: list[str] = []
        if ssp_ref:
            notes_parts.append(f"SSP reference: {ssp_ref}")
        if amendment_note:
            notes_parts.append(amendment_note)
        if guidance_url:
            notes_parts.append(f"Endorsement guidance: {guidance_url}")
        notes: str | None = "\n".join(notes_parts) or None

        return {
            "generic_name":              drug_name,
            "brand_names":               [],
            "status":                    status,
            "severity":                  severity,
            "reason": (
                "Serious Shortage Protocol — legal instrument authorising "
                "pharmacist substitution without new prescription"
            ),
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated_resolution_date,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "ssp_ref":       ssp_ref,
                "drug_name_raw": raw_link_text,
                "table_status":  table_status,
                "date_text":     date_text,
                "source_pdf":    source_url,
                "guidance_pdf":  guidance_url,
            },
        }

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """Parse '03 April 2025' → '2025-04-03'.  Returns None on failure."""
        if not raw or not raw.strip():
            return None
        try:
            dt = dtparser.parse(raw.strip(), dayfirst=True)
            return dt.date().isoformat()
        except (ValueError, OverflowError):
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
#
# Usage:
#   MEDERTI_DRY_RUN=1 python -m backend.scrapers.mhra_scraper   # dry run
#   python -m backend.scrapers.mhra_scraper                      # live run
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
        print("Fetches live NHSBSA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = MHRAScraper(db_client=MagicMock())

        print("\n── Fetching from NHSBSA SSP page …")
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")

        print("── Normalising records …")
        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            print("\n── Sample events (first 3):")
            for e in events[:3]:
                sample = {k: v for k, v in e.items() if k != "raw_record"}
                print(json.dumps(sample, indent=2, default=str))

            from collections import Counter

            status_counts   = Counter(e["status"] for e in events)
            severity_counts = Counter(e.get("severity") for e in events)
            reason_counts   = Counter(e.get("reason_category") for e in events)

            print("\n── Status breakdown:")
            for k, v in sorted(status_counts.items()):
                print(f"   {k:25s} {v}")
            print("\n── Severity breakdown:")
            for k, v in sorted(severity_counts.items()):
                print(f"   {str(k):12s} {v}")
            print("\n── Reason category breakdown:")
            for k, v in sorted(reason_counts.items()):
                print(f"   {str(k):25s} {v}")

        print("\n── Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # ── Live run ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)

    scraper = MHRAScraper()
    summary = scraper.run()

    print("\n── Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
