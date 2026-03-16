"""
Netherlands Drug Shortages Scraper (Farmanco / KNMP)
────────────────────────────────────────────────────
Source:  Farmanco — KNMP (Royal Dutch Pharmacists Association)
URL:     https://www.farmanco.knmp.nl

Replaces the previous CBG-MEB scraper which targeted a Next.js SPA page
(cbg-meb.nl) that returned no data server-side. Farmanco serves 280+
shortage entries as server-rendered HTML with structured CSS classes.

Data source UUID:  10000000-0000-0000-0000-000000000011  (CBG-MEB, NL)
Country:           Netherlands
Country code:      NL
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone

import httpx

from backend.scrapers.base_scraper import BaseScraper


class CbgMebScraper(BaseScraper):
    """
    Scraper for Netherlands drug shortage data from Farmanco (KNMP).

    Each shortage entry is an <a class="shortage-flex-table"> element
    containing <ul><li> items with CSS classes:
      - sort-type             (e.g. "nieuw" = new)
      - sort-active-ingredient (drug name)
      - sort-description       (formulation details)
      - sort-form              (dosage form)
      - sort-preferential      (insurance preference)
      - sort-date              (revision date)
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000011"
    SOURCE_NAME:  str = "CBG-MEB (Netherlands)"
    BASE_URL:     str = "https://www.farmanco.knmp.nl"
    COUNTRY:      str = "Netherlands"
    COUNTRY_CODE: str = "NL"

    RATE_LIMIT_DELAY: float = 2.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language":  "nl-NL,nl;q=0.9,en;q=0.8",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        self.log.info("Fetching Farmanco NL shortage page", extra={"url": self.BASE_URL})
        try:
            resp = self._get(self.BASE_URL, headers=self._HEADERS)
            html = resp.text
            self.log.info(
                "Farmanco response received",
                extra={"status": resp.status_code, "bytes": len(html)},
            )
            return {
                "html":        html,
                "byte_length": len(html.encode("utf-8")),
                "status_code": resp.status_code,
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            }
        except httpx.HTTPStatusError as exc:
            self.log.warning(
                "Farmanco HTTP error",
                extra={"status": exc.response.status_code, "url": self.BASE_URL},
            )
            return {"html": "", "byte_length": 0, "status_code": exc.response.status_code,
                    "fetched_at": datetime.now(timezone.utc).isoformat(), "error": str(exc)}
        except Exception as exc:
            self.log.warning(
                "Farmanco fetch failed",
                extra={"error": str(exc), "url": self.BASE_URL},
            )
            return {"html": "", "byte_length": 0, "status_code": None,
                    "fetched_at": datetime.now(timezone.utc).isoformat(), "error": str(exc)}

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        html: str = raw.get("html", "")
        if not html or raw.get("byte_length", 0) < 10_000:
            self.log.warning("Farmanco: response too small or empty")
            return []

        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed")
            return []

        soup = BeautifulSoup(html, "html.parser")
        entries = soup.find_all("a", class_="shortage-flex-table")

        if not entries:
            self.log.warning("Farmanco: no shortage-flex-table entries found")
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        for entry in entries:
            try:
                record = self._parse_entry(entry, today)
                if record:
                    normalised.append(record)
                else:
                    skipped += 1
            except Exception as exc:
                skipped += 1
                self.log.debug("Farmanco entry parse error", extra={"error": str(exc)})

        self.log.info(
            "Farmanco normalisation done",
            extra={"total": len(entries), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _parse_entry(self, entry, today: str) -> dict | None:
        """Parse a single <a class="shortage-flex-table"> entry."""
        lis = entry.find_all("li")
        if len(lis) < 4:
            return None

        def _get_li(class_name: str) -> str:
            for li in lis:
                classes = li.get("class", [])
                if class_name in classes:
                    return li.get_text(strip=True)
            return ""

        entry_type = _get_li("sort-type")              # "nieuw" or ""
        active_ingredient = _get_li("sort-active-ingredient")
        description = _get_li("sort-description")
        dosage_form = _get_li("sort-form")
        preferential = _get_li("sort-preferential")
        revision_date_raw = _get_li("sort-date")

        if not active_ingredient or len(active_ingredient) < 2:
            return None

        # Parse revision date (format: DD-MM-YYYY)
        revision_date = self._parse_date(revision_date_raw) or today

        # Detail page link
        href = entry.get("href", "")
        detail_url = f"{self.BASE_URL}{href}" if href else self.BASE_URL

        # Map to standard fields
        severity = "high" if entry_type.lower() == "nieuw" else "medium"

        return {
            "generic_name":  active_ingredient[:200],
            "status":        "active",
            "severity":      severity,
            "start_date":    revision_date,
            "source_url":    detail_url,
            "notes":         f"{description}. Form: {dosage_form}".strip(". ") if description else dosage_form,
            "raw_record": {
                "type":              entry_type,
                "active_ingredient": active_ingredient,
                "description":       description,
                "dosage_form":       dosage_form,
                "preferential":      preferential,
                "revision_date":     revision_date_raw,
                "detail_href":       href,
            },
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        # DD-MM-YYYY
        m = re.match(r"(\d{1,2})-(\d{1,2})-(\d{4})", raw.strip())
        if m:
            day, month, year = m.groups()
            try:
                return f"{year}-{int(month):02d}-{int(day):02d}"
            except ValueError:
                pass
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json as _json
    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = CbgMebScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  byte_length : {raw.get('byte_length', 0)}")
        print(f"  status_code : {raw.get('status_code')}")
        print(f"  error       : {raw.get('error', 'none')}")

        events = scraper.normalize(raw)
        print(f"  events      : {len(events)}")
        if events:
            print(f"\nFirst 5 records:")
            for i, e in enumerate(events[:5]):
                print(f"\n  [{i+1}] {e['generic_name']}")
                print(f"      severity: {e['severity']}  start: {e['start_date']}")
                print(f"      notes: {(e.get('notes') or '')[:80]}")
                print(f"      url: {e['source_url']}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = CbgMebScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
