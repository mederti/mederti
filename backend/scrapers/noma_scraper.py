"""
NoMA / DMP Norwegian Drug Shortage Scraper
───────────────────────────────────────────
Source:  DMP — Direktoratet for medisinske produkter
         (formerly Statens legemiddelverk / Norwegian Medicines Agency)
URL:     https://www.dmp.no/forsyningssikkerhet/legemiddelmangel/
         oversikt-over-legemiddelmangel---for-apotek

Data access
───────────
The shortage list is rendered by JavaScript from a hidden <input> element
with id="excelData". Its value is a JSON column-array:

    {
      "Legemiddelnavn":    ["Drug A 100mg ...", ...],   # brand name + form
      "Virkestoff(er)":   ["amoxicillin", ...],          # active ingredient(s)
      "ATC-kode":         ["J01CA04", ...],
      "Meldingsdato":     ["01.01.2026 00:00:00", ...],  # notification date
      "Mangelperiode fra":["01.01.2026 00:00:00", ...],  # shortage start
      "Mangelperiode til":["31.03.2026 00:00:00", ...],  # shortage end (may be blank)
      "Årsak":            ["Produksjonsproblemer", ...], # reason
      "Status pr. DATE":  ["Mangel", ...],               # current status
      ...
    }

The hidden input is populated server-side only after JavaScript executes —
it is NOT present in the raw static HTML. We use Playwright (headless
Chromium) to render the page and extract the value from the DOM.

Typical data: ~800 active shortage records.

Data source UUID:  10000000-0000-0000-0000-000000000019  (NoMA/DMP, NO)
Country:           Norway
Country code:      NO
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper


class NoMAScraper(BaseScraper):
    """Scraper for DMP/NoMA Norwegian drug shortage list."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000019"
    SOURCE_NAME:  str = "NoMA (Norwegian Medicines Agency / DMP)"
    BASE_URL:     str = (
        "https://www.dmp.no/forsyningssikkerhet/legemiddelmangel/"
        "oversikt-over-legemiddelmangel---for-apotek"
    )
    COUNTRY:      str = "Norway"
    COUNTRY_CODE: str = "NO"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 45.0

    # Playwright wait time after page load (ms) — data loads after DOMContentLoaded
    _JS_WAIT_MS: int = 6000

    # Date format used in the data: "DD.MM.YYYY HH:MM:SS"
    _DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Render the DMP shortage page with headless Chromium (Playwright)
        and extract the excelData JSON from the hidden input element.

        Returns:
            {
                "columns":    dict[str, list]   # column-array payload
                "raw_inputs": dict[str, str]    # all hidden input values
                "fetched_at": str
            }
        """
        self.log.info(
            "Fetching NoMA shortage page via Playwright",
            extra={"url": self.BASE_URL},
        )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.log.error(
                "Playwright not installed. "
                "Run: pip install playwright && playwright install chromium"
            )
            return {"columns": {}, "raw_inputs": {}, "fetched_at": datetime.now(timezone.utc).isoformat()}

        columns: dict = {}
        raw_inputs: dict = {}

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_extra_http_headers({
                    "Accept-Language": "no,nb;q=0.9,en;q=0.8",
                    "User-Agent": (
                        "Mederti-Scraper/1.0 (+https://mederti.com/bot; "
                        "monitoring pharmaceutical shortages globally)"
                    ),
                })
                page.goto(self.BASE_URL, timeout=int(self.REQUEST_TIMEOUT * 1000), wait_until="domcontentloaded")
                page.wait_for_timeout(self._JS_WAIT_MS)

                # Extract all hidden input values from the DOM
                raw_inputs = page.evaluate("""
                    (() => {
                        const inputs = document.querySelectorAll('input[type=hidden]');
                        const result = {};
                        for (const inp of inputs) {
                            if (inp.value && inp.value.length > 10) {
                                result[inp.id] = inp.value;
                            }
                        }
                        return result;
                    })()
                """)

                self.log.info(
                    "NoMA: extracted hidden inputs",
                    extra={"keys": list(raw_inputs.keys())},
                )

                # Parse excelData column-array
                if "excelData" in raw_inputs:
                    try:
                        columns = json.loads(raw_inputs["excelData"])
                        self.log.info(
                            "NoMA: excelData parsed",
                            extra={
                                "columns":     list(columns.keys()),
                                "record_count": max(
                                    len(v) for v in columns.values() if isinstance(v, list)
                                ) if columns else 0,
                            },
                        )
                    except json.JSONDecodeError as exc:
                        self.log.error(
                            "NoMA: failed to parse excelData JSON",
                            extra={"error": str(exc)},
                        )
                else:
                    self.log.warning(
                        "NoMA: excelData input not found in DOM",
                        extra={"inputs_found": list(raw_inputs.keys())},
                    )
            finally:
                browser.close()

        return {
            "columns":    columns,
            "raw_inputs": {k: v[:200] for k, v in raw_inputs.items()},  # truncate for storage
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """
        Convert the excelData column-array into shortage event dicts.

        Column mapping:
            Virkestoff(er)   → generic_name  (active ingredient)
            Legemiddelnavn   → brand_names[0]
            ATC-kode         → notes (ATC code)
            Mangelperiode fra → start_date
            Mangelperiode til → estimated_resolution_date
            Årsak            → reason + reason_category
            Status pr. DATE  → status
        """
        columns: dict = raw.get("columns", {})

        if not columns:
            self.log.warning(
                "NoMA: no columns data — returning empty list",
                extra={"fetched_at": raw.get("fetched_at")},
            )
            return []

        # Find the length of the dataset
        lengths = [len(v) for v in columns.values() if isinstance(v, list)]
        if not lengths:
            return []
        row_count = max(lengths)

        self.log.info("NoMA: normalising rows", extra={"row_count": row_count})

        # Find the dynamic status column (e.g. "Status pr. 23.02.2026")
        status_col = next(
            (k for k in columns if k.lower().startswith("status pr.")), None
        )

        normalised: list[dict] = []
        skipped = 0
        today = datetime.now(timezone.utc).date().isoformat()

        for i in range(row_count):
            try:
                def col(name: str, default: str = "") -> str:
                    vals = columns.get(name, [])
                    return str(vals[i]).strip() if i < len(vals) and vals[i] else default

                # Generic name — prefer active ingredient, fall back to brand name
                active_ingredient = col("Virkestoff(er)")
                brand_name = col("Legemiddelnavn")
                generic_name = active_ingredient or brand_name.split()[0] if brand_name else ""
                if not generic_name:
                    skipped += 1
                    continue

                # Dates
                start_date = self._parse_date(col("Mangelperiode fra")) or today
                end_date   = self._parse_date(col("Mangelperiode til"))

                # Status
                status_raw = col(status_col) if status_col else ""
                status = self._map_status(status_raw)

                # Reason
                aarsak = col("Årsak")  # Norwegian: reason
                reason_cat = self._map_reason_category(aarsak)

                # ATC code
                atc = col("ATC-kode")

                notes_parts = []
                if atc:          notes_parts.append(f"ATC: {atc}.")
                if aarsak:       notes_parts.append(f"Årsak: {aarsak}.")
                if status_raw:   notes_parts.append(f"Status: {status_raw}.")
                notes_parts.append("Norwegian drug shortage data from DMP/NoMA.")
                notes = " ".join(notes_parts)

                normalised.append({
                    "generic_name":              generic_name,
                    "brand_names":               [brand_name] if brand_name else [],
                    "status":                    status,
                    "severity":                  "medium",
                    "reason":                    aarsak or None,
                    "reason_category":           reason_cat,
                    "start_date":                start_date,
                    "end_date":                  end_date if status == "resolved" else None,
                    "estimated_resolution_date": end_date if status == "active" else None,
                    "source_url":                self.BASE_URL,
                    "notes":                     notes,
                    "raw_record": {
                        "legemiddelnavn":    brand_name,
                        "virkestoff":        active_ingredient,
                        "atc_kode":          atc,
                        "mangel_fra":        col("Mangelperiode fra"),
                        "mangel_til":        col("Mangelperiode til"),
                        "aarsak":            aarsak,
                        "status":            status_raw,
                        "firma":             col("Firma"),
                        "varenummer":        col("Varenummer"),
                    },
                })
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "NoMA: failed to normalise row",
                    extra={"row": i, "error": str(exc)},
                )

        self.log.info(
            "NoMA normalisation done",
            extra={"total": row_count, "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _parse_date(self, raw: str) -> str | None:
        """Parse 'DD.MM.YYYY HH:MM:SS' or 'DD.MM.YYYY' to ISO-8601 date."""
        if not raw or not raw.strip():
            return None
        match = self._DATE_RE.search(raw)
        if match:
            day, month, year = match.groups()
            try:
                return f"{year}-{month}-{day}"
            except Exception:
                pass
        return None

    @staticmethod
    def _map_status(status_raw: str) -> str:
        """Map Norwegian status text to internal status enum."""
        low = status_raw.lower()
        if any(w in low for w in ["mangel", "shortage", "utilgjengelig", "ikke"]):
            return "active"
        if any(w in low for w in ["forventet", "planlagt", "expect"]):
            return "anticipated"
        if any(w in low for w in ["tilgjengelig", "opphevet", "resolved", "avsluttet"]):
            return "resolved"
        return "active"  # default for Norwegian shortage list

    @staticmethod
    def _map_reason_category(aarsak: str) -> str:
        """Map Norwegian 'Årsak' (reason) to internal reason_category."""
        low = aarsak.lower()
        if any(w in low for w in ["produksjon", "production", "manufactur"]):
            return "manufacturing_issue"
        if any(w in low for w in ["råvare", "raw material", "ingredients"]):
            return "raw_material_shortage"
        if any(w in low for w in ["distribusjon", "distribution", "transport", "logistics"]):
            return "distribution_issue"
        if any(w in low for w in ["regulatorisk", "godkjenning", "regulatory"]):
            return "regulatory"
        if any(w in low for w in ["etterspørsel", "demand"]):
            return "demand_surge"
        return "supply_chain"


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os
    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = NoMAScraper(db_client=MagicMock())
        raw = scraper.fetch()
        columns = raw.get("columns", {})
        count = max(len(v) for v in columns.values() if isinstance(v, list)) if columns else 0
        print(f"  rows in excelData: {count}")
        print(f"  columns: {list(columns.keys())}")

        events = scraper.normalize(raw)
        print(f"  events: {len(events)}")
        if events:
            import json as _json
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(f"  sample: {_json.dumps(sample, ensure_ascii=False, indent=2)}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = NoMAScraper()
    import json as _json
    summary = scraper.run()
    print(_json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
