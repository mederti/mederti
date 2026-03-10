"""
AGES / BASG Austrian Drug Shortage Scraper
───────────────────────────────────────────
Source:  AGES — Österreichische Agentur für Gesundheit und Ernährungssicherheit
         (Austrian Agency for Health and Food Safety) / BASG
URL:     https://medikamente.basg.gv.at/#/de/vertriebseinschraenkungen

Data access
───────────
The AGES medicine portal is an Angular SPA. Drug shortage data is available at:

    https://medikamente.basg.gv.at/#/de/vertriebseinschraenkungen

The underlying REST API:
    https://medikamente.basg.gv.at/api/api/v1/medication/ctl-filter
returns HTTP 401 Unauthorized (requires session token).

Strategy: Use Playwright (headless Chromium) to:
  1. Navigate to the SPA URL with the fragment (#/de/vertriebseinschraenkungen)
  2. Wait for the Angular data table to render
  3. Extract table rows from the rendered DOM

Table columns (German):
    Wirkstoff/Handelsname  → generic/brand name
    ATC-Code               → ATC code
    Zulassungsinhaber      → marketing authorisation holder
    Packungsgröße          → pack size
    Engpassstatus          → shortage status

Typical data: 20–100 active supply restriction records.

Data source UUID:  10000000-0000-0000-0000-000000000020  (AGES, AT)
Country:           Austria
Country code:      AT
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper


class AgesScraper(BaseScraper):
    """Scraper for AGES Austria drug shortage / supply restriction data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000020"
    SOURCE_NAME:  str = "AGES (Austrian Agency for Health and Food Safety)"
    BASE_URL:     str = "https://medikamente.basg.gv.at/#/de/vertriebseinschraenkungen"
    COUNTRY:      str = "Austria"
    COUNTRY_CODE: str = "AT"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 60.0

    # How long to wait for Angular to render (ms)
    _JS_WAIT_MS: int = 8000

    # Possible Angular route URLs to try
    _URLS_TO_TRY: list[str] = [
        "https://medikamente.basg.gv.at/#/de/vertriebseinschraenkungen",
        "https://medikamente.basg.gv.at/de/vertriebseinschraenkungen",
        "https://medikamente.basg.gv.at/#/en/supply-restriction-register",
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Render the AGES Angular SPA with headless Chromium and extract
        drug shortage table data from the rendered DOM.

        Returns:
            {
                "rows":       list[dict]    # extracted table rows
                "url_used":   str
                "fetched_at": str
            }
        """
        self.log.info(
            "Fetching AGES shortage data via Playwright",
            extra={"url": self.BASE_URL},
        )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.log.error(
                "Playwright not installed. "
                "Run: pip install playwright && playwright install chromium"
            )
            return {"rows": [], "url_used": self.BASE_URL, "fetched_at": datetime.now(timezone.utc).isoformat()}

        rows: list[dict] = []
        url_used = self.BASE_URL

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_extra_http_headers({
                    "Accept-Language": "de-AT,de;q=0.9,en;q=0.8",
                    "User-Agent": (
                        "Mederti-Scraper/1.0 (+https://mederti.com/bot; "
                        "monitoring pharmaceutical shortages globally)"
                    ),
                })

                for url in self._URLS_TO_TRY:
                    self.log.debug("AGES: trying URL", extra={"url": url})
                    try:
                        page.goto(url, timeout=int(self.REQUEST_TIMEOUT * 1000), wait_until="domcontentloaded")
                        page.wait_for_timeout(self._JS_WAIT_MS)

                        # Try to find table rows
                        rows = page.evaluate(self._EXTRACT_JS)
                        if rows:
                            url_used = url
                            self.log.info(
                                "AGES: table rows found",
                                extra={"url": url, "rows": len(rows)},
                            )
                            break
                        else:
                            self.log.debug(
                                "AGES: no rows at URL, trying next",
                                extra={"url": url},
                            )
                    except Exception as exc:
                        self.log.warning(
                            "AGES: error loading URL",
                            extra={"url": url, "error": str(exc)[:200]},
                        )

                if not rows:
                    self.log.warning(
                        "AGES: no shortage data found across all tried URLs — Angular SPA may require auth",
                        extra={"urls_tried": self._URLS_TO_TRY},
                    )
            finally:
                browser.close()

        self.log.info(
            "AGES fetch complete",
            extra={"rows": len(rows), "url_used": url_used},
        )
        return {
            "rows":       rows,
            "url_used":   url_used,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # JavaScript to extract table data from Angular DOM
    _EXTRACT_JS: str = """
    (() => {
        const rows = [];

        // Strategy 1: Find mat-table (Angular Material table) rows
        const matRows = document.querySelectorAll('mat-row, tr.mat-row, .cdk-row');
        if (matRows.length > 0) {
            for (const row of matRows) {
                const cells = row.querySelectorAll('mat-cell, td.mat-cell, .cdk-cell');
                if (cells.length >= 2) {
                    const obj = {};
                    for (let i = 0; i < cells.length; i++) {
                        obj['col_' + i] = cells[i].innerText.trim();
                    }
                    if (Object.values(obj).some(v => v.length > 2)) rows.push(obj);
                }
            }
        }

        // Strategy 2: Find regular table rows (skip header)
        if (rows.length === 0) {
            const trs = document.querySelectorAll('table tr');
            let headerSkipped = false;
            for (const tr of trs) {
                if (!headerSkipped) { headerSkipped = true; continue; }
                const cells = tr.querySelectorAll('td');
                if (cells.length >= 2) {
                    const obj = {};
                    for (let i = 0; i < cells.length; i++) {
                        obj['col_' + i] = cells[i].innerText.trim();
                    }
                    if (Object.values(obj).some(v => v.length > 2)) rows.push(obj);
                }
            }
        }

        // Strategy 3: Find card/list items that might represent drug records
        if (rows.length === 0) {
            const cards = document.querySelectorAll(
                '.vertriebseinschraenkung, .shortage-item, [class*=shortage], [class*=engpass]'
            );
            for (const card of cards) {
                rows.push({ col_0: card.innerText.trim().substring(0, 300) });
            }
        }

        return rows;
    })()
    """

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """
        Convert extracted DOM rows to shortage event dicts.
        Column positions are heuristic — adapt as the SPA layout changes.
        """
        dom_rows: list[dict] = raw.get("rows", [])

        if not dom_rows:
            self.log.warning(
                "AGES: no rows to normalise — SPA may require auth or URL changed",
                extra={"url_used": raw.get("url_used")},
            )
            return []

        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        for row in dom_rows:
            try:
                # Column mapping is positional; first non-empty col is drug name
                cols = [v for v in row.values() if v]
                if not cols:
                    skipped += 1
                    continue

                generic_name = cols[0].strip()
                if not generic_name or len(generic_name) < 2:
                    skipped += 1
                    continue

                # Subsequent columns: ATC (col 1), holder (col 2), etc.
                atc_code = cols[1].strip() if len(cols) > 1 else ""
                holder   = cols[2].strip() if len(cols) > 2 else ""
                status_raw = cols[-1].strip() if len(cols) > 3 else ""

                status = "active"
                if any(w in status_raw.lower() for w in ["beendet", "aufgehoben", "resolved"]):
                    status = "resolved"

                notes_parts = ["Austrian supply restriction (Vertriebseinschränkung) from AGES/BASG."]
                if atc_code: notes_parts.append(f"ATC: {atc_code}.")
                if holder:   notes_parts.append(f"MAH: {holder}.")
                if status_raw: notes_parts.append(f"Status: {status_raw}.")

                normalised.append({
                    "generic_name":    generic_name,
                    "brand_names":     [],
                    "status":          status,
                    "severity":        "medium",
                    "reason_category": "regulatory",
                    "start_date":      today,
                    "source_url":      self.BASE_URL,
                    "notes":           " ".join(notes_parts),
                    "raw_record":      dict(row),
                })
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "AGES: failed to normalise row",
                    extra={"error": str(exc), "row": str(row)[:200]},
                )

        self.log.info(
            "AGES normalisation done",
            extra={"total": len(dom_rows), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json as _json
    import os

    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = AgesScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  rows fetched : {len(raw.get('rows', []))}")
        print(f"  url used     : {raw.get('url_used')}")

        events = scraper.normalize(raw)
        print(f"  events       : {len(events)}")
        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(f"  sample       : {_json.dumps(sample, ensure_ascii=False)}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = AgesScraper()
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
