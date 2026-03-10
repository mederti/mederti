"""
Pharmac New Zealand Medicine Notices Scraper
─────────────────────────────────────────────
Source:  Pharmac — New Zealand Pharmaceutical Management Agency
URL:     https://www.pharmac.govt.nz/medicine-funding-and-supply/medicine-notices/
API:     https://www.pharmac.govt.nz/api/medicineindex/data/{root_id}

Data source (confirmed 2026-02-22):
    Pharmac publishes a Medicine Notices page backed by a public JSON API:

    Step 1 — Extract root ID:
        Fetch the medicine notices HTML page; parse the
        <div id="medicineIndexApp" data-appdata='{"Root": 7967, ...}'> element.
        Root ID may change if Pharmac rebuilds their CMS; we read it dynamically.

    Step 2 — Fetch all notices:
        GET /api/medicineindex/data/{root_id}
        Returns all 91 notices in one response (no pagination).

    Step 3 — Filter to shortage-relevant types:
        "Supply issue"    → status from detail page (Active / Resolved)
        "Discontinuation" → always resolved
        "Recall"          → status from detail page (Active / Resolved)

    Step 4 — Fetch detail page per item (Supply issue / Recall only):
        GET https://www.pharmac.govt.nz{item.Link}
        Parse:
          <span class="tag">Active|Resolved</span>
          <time datetime="YYYY-MM-DD">
          <p class="typography-intro-text">  (short summary)

Notice title format:
    "Teriparatide (Teva): Supply issue"
    "Methylphenidate: Supply issue"
    "Dexamethasone phosphate (Medsurge) Inj 4 mg per ml, 2 ml ampoule: Supply issue"
    → generic_name extracted before first '(' or ':'
    → brand_name extracted from first parenthetical group

Data source UUID:  10000000-0000-0000-0000-000000000021  (Pharmac, NZ)
Country:           New Zealand
Country code:      NZ
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class PharmacScraper(BaseScraper):
    """
    Scraper for Pharmac NZ medicine supply notices (Supply issues,
    Discontinuations, Recalls).
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000021"
    SOURCE_NAME:  str = "Pharmac — New Zealand Medicine Supply Disruptions"
    BASE_URL:     str = "https://www.pharmac.govt.nz"
    LIST_URL:     str = "https://www.pharmac.govt.nz/medicine-funding-and-supply/medicine-notices/"
    COUNTRY:      str = "New Zealand"
    COUNTRY_CODE: str = "NZ"

    RATE_LIMIT_DELAY: float = 1.5   # polite crawling; detail pages fetched per item

    # Notice types to include
    INCLUDE_TYPES: frozenset[str] = frozenset({"Supply issue", "Discontinuation", "Recall"})

    # These types never need a detail-page fetch — status is always "resolved"
    SKIP_DETAIL_TYPES: frozenset[str] = frozenset({"Discontinuation"})

    _TYPE_REASON: dict[str, tuple[str, str | None]] = {
        "Supply issue":   ("supply_chain",   None),
        "Discontinuation": ("discontinuation", "Product discontinued"),
        "Recall":         ("manufacturing_issue", "Product recall"),
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        1. Extract Umbraco root ID from medicine notices HTML.
        2. Fetch all notices from JSON API.
        3. Filter to shortage-relevant types.
        4. Enrich each item with detail-page status / date.
        """
        # Step 1 — dynamic root ID
        root_id = self._get_root_id()
        self.log.info("Pharmac root ID resolved", extra={"root_id": root_id})

        # Step 2 — JSON API (single page, no pagination)
        api_url = f"{self.BASE_URL}/api/medicineindex/data/{root_id}"
        api_data = self._get_json(api_url)
        all_items: list[dict] = api_data.get("Data", {}).get("Items", [])
        self.log.info("Pharmac API items", extra={"total": len(all_items)})

        # Step 3 — filter
        relevant = [
            item for item in all_items
            if any(t.get("Title", "") in self.INCLUDE_TYPES
                   for t in item.get("Type", []))
        ]
        self.log.info(
            "Pharmac relevant items after type filter",
            extra={"count": len(relevant),
                   "total":  len(all_items)},
        )

        # Step 4 — enrich with detail page data
        records: list[dict] = []
        for item in relevant:
            try:
                records.append(self._enrich_item(item))
            except Exception as exc:
                self.log.warning(
                    "Failed to enrich Pharmac item",
                    extra={"title": item.get("Title", "?")[:80],
                           "error": str(exc)},
                )

        self.log.info("Pharmac fetch complete", extra={"records": len(records)})
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising Pharmac records",
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
                    "Failed to normalise Pharmac record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised),
                   "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _get_root_id(self) -> str:
        """
        Parse the Umbraco CMS root node ID from the medicine notices HTML page.
        Falls back to hardcoded '7967' if the element is not found.
        """
        resp = self._get(self.LIST_URL)
        soup = BeautifulSoup(resp.text, "lxml")
        app_div = soup.find(id="medicineIndexApp")
        if not app_div:
            self.log.warning(
                "medicineIndexApp div not found — using hardcoded root ID 7967"
            )
            return "7967"
        data_str = app_div.get("data-appdata", "{}")
        try:
            data = json.loads(data_str)
            return str(data.get("Root", "7967"))
        except (json.JSONDecodeError, KeyError):
            return "7967"

    def _enrich_item(self, item: dict) -> dict:
        """
        Fetch the detail page for Supply issue / Recall items and extract:
          - status tag: "Active" or "Resolved"
          - <time datetime=""> for ISO date
          - summary paragraph
        Discontinuation items skip the detail fetch (always resolved).
        """
        types = [t.get("Title", "") for t in item.get("Type", [])]

        # Skip detail fetch if only Discontinuation type
        if all(t in self.SKIP_DETAIL_TYPES for t in types):
            return {
                **item,
                "_types":        types,
                "_page_status":  "Resolved",
                "_page_summary": None,
                "_detail_date":  None,
            }

        link = item.get("Link", "")
        detail_url = f"{self.BASE_URL}{link}"
        resp = self._get(detail_url)
        soup = BeautifulSoup(resp.text, "lxml")

        # ── Status tag ────────────────────────────────────────────────────────
        page_status: str | None = None
        for span in soup.find_all("span", class_="tag"):
            text = span.get_text(strip=True)
            if text in ("Active", "Resolved"):
                page_status = text
                break

        # Fallback: search any element with exactly "Active" / "Resolved"
        if not page_status:
            for el in soup.find_all(string=re.compile(r"^(Active|Resolved)$")):
                page_status = el.strip()
                break

        # ── Date from <time datetime=""> ──────────────────────────────────────
        detail_date: str | None = None
        time_el = soup.find("time", attrs={"datetime": True})
        if time_el:
            dt_val = time_el.get("datetime", "")
            # Validate it looks like a date
            if re.match(r"^\d{4}-\d{2}-\d{2}", dt_val):
                detail_date = dt_val[:10]

        # ── Summary paragraph ─────────────────────────────────────────────────
        summary_el = soup.find("p", class_="typography-intro-text")
        page_summary: str | None = (
            summary_el.get_text(separator=" ", strip=True) if summary_el else None
        )

        return {
            **item,
            "_types":        types,
            "_page_status":  page_status,
            "_page_summary": page_summary,
            "_detail_date":  detail_date,
        }

    def _normalise_record(self, rec: dict) -> dict | None:
        title  = (rec.get("Title") or "").strip()
        types  = rec.get("_types", [])
        if not title or not types:
            return None

        # Primary type (priority: Supply issue > Recall > Discontinuation)
        primary_type = next(
            (t for t in ("Supply issue", "Recall", "Discontinuation") if t in types),
            types[0],
        )

        # ── Drug name ─────────────────────────────────────────────────────────
        generic_name, brand_name = self._parse_title(title)
        if not generic_name:
            return None
        brand_names = [brand_name] if brand_name else []

        # ── Status ────────────────────────────────────────────────────────────
        page_status = rec.get("_page_status")
        if primary_type == "Discontinuation":
            status = "resolved"
        elif page_status == "Resolved":
            status = "resolved"
        elif page_status == "Active":
            status = "active"
        else:
            status = "active"   # conservative default

        # ── Severity ──────────────────────────────────────────────────────────
        severity = "high" if primary_type == "Supply issue" else "medium"

        # ── Reason ───────────────────────────────────────────────────────────
        reason_cat, default_reason = self._TYPE_REASON.get(
            primary_type, ("supply_chain", None)
        )
        page_summary = rec.get("_page_summary")
        reason = (page_summary[:500] if page_summary else None) or default_reason

        # ── Dates ─────────────────────────────────────────────────────────────
        detail_date  = rec.get("_detail_date")
        opened_raw   = (rec.get("OpenedDate") or
                        rec.get("LastUpdatedDate") or
                        rec.get("PublishDate"))
        start_date   = detail_date or self._parse_pharmac_date(opened_raw)
        if not start_date:
            start_date = datetime.now(timezone.utc).date().isoformat()

        end_date = start_date if status == "resolved" else None

        # ── Source URL ────────────────────────────────────────────────────────
        link = rec.get("Link", "")
        source_url = f"{self.BASE_URL}{link}" if link else self.LIST_URL

        # ── Notes ─────────────────────────────────────────────────────────────
        notes = f"Types: {', '.join(types)}"
        if page_status:
            notes += f" | Status: {page_status}"

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    reason,
            "reason_category":           reason_cat,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": None,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "id":           rec.get("ID"),
                "title":        title,
                "types":        types,
                "opened_date":  rec.get("OpenedDate"),
                "last_updated": rec.get("LastUpdatedDate"),
                "page_status":  page_status,
            },
        }

    @staticmethod
    def _parse_title(title: str) -> tuple[str, str | None]:
        """
        Parse Pharmac notice title into (generic_name, brand_name).

        Formats:
            "Teriparatide (Teva): Supply issue"
                → ("Teriparatide", "Teva")
            "Methylphenidate: Supply issue"
                → ("Methylphenidate", None)
            "Dexamethasone phosphate (Medsurge) Inj 4 mg per ml: Supply issue"
                → ("Dexamethasone Phosphate", "Medsurge")
        """
        # Remove notice type suffix after last ':'
        name_part = title.rsplit(":", 1)[0].strip()

        # First parenthetical group = brand name
        m = re.match(r"^([^(]+?)\s*\(([^)]+)\)", name_part)
        if m:
            generic = m.group(1).strip().title()
            brand   = m.group(2).strip()
            return generic, brand

        return name_part.strip().title(), None

    @staticmethod
    def _parse_pharmac_date(raw: str | None) -> str | None:
        """Parse '18 Feb 2026' → '2026-02-18'."""
        if not raw:
            return None
        try:
            return dtparser.parse(raw).date().isoformat()
        except (ValueError, OverflowError):
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json as _json
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
        print("=" * 60)

        scraper = PharmacScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records received  : {len(raw)}")

        events = scraper.normalize(raw)
        print(f"── Normalised events     : {len(events)}")

        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(_json.dumps(sample, indent=2, default=str))

            print("\n── Status breakdown:")
            for k, v in sorted(Counter(e["status"] for e in events).items()):
                print(f"   {k:25s} {v}")
            print("\n── Type breakdown:")
            from itertools import chain
            all_types = Counter(
                t for e in events for t in e["raw_record"].get("types", [])
            )
            for k, v in sorted(all_types.items()):
                print(f"   {k:30s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = PharmacScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
