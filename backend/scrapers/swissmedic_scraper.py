"""
Swissmedic Out-of-Stock Scraper
────────────────────────────────
Source:  Swissmedic (Swiss Agency of Therapeutic Products)
URL:     https://www.swissmedic.ch/swissmedic/en/home/humanarzneimittel/
         market-surveillance/out-of-stock/approved-applications.html

Data access
───────────
The shortage list is rendered by an Adobe Experience Manager (AEM) CMS.
The first 30 records are server-side rendered at:

    BASE/_jcr_content/par.html

Pages 2..N are loaded via AEM teaserlist AJAX:

    BASE/_jcr_content/par/teaserlist.content.paging-N.html
        ?pageIndex=N&teaserlistid=TEASER_ID&fulltext=&datefrom=01.01.2018&dateto=&tags=

Drug names are in aria-label attributes:
    aria-label="Out-of-Stock &ndash; PRODUCT_NAME"

Typical data: ~190 approved out-of-stock applications (all active).
No dates or severity data are available in the list view.

Data source UUID:  10000000-0000-0000-0000-000000000018  (Swissmedic, CH)
Country:           Switzerland
Country code:      CH
"""

from __future__ import annotations

import html as html_lib
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.scrapers.base_scraper import BaseScraper


class SwissmedicScraper(BaseScraper):
    """Scraper for Swissmedic out-of-stock approved applications list."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000018"
    SOURCE_NAME:  str = "Swissmedic"
    BASE_URL:     str = (
        "https://www.swissmedic.ch/swissmedic/en/home/humanarzneimittel/"
        "market-surveillance/out-of-stock/approved-applications.html"
    )
    COUNTRY:      str = "Switzerland"
    COUNTRY_CODE: str = "CH"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0

    # AEM content fragment for page 1
    _PAGE1_URL: str = (
        "https://www.swissmedic.ch/swissmedic/en/home/humanarzneimittel/"
        "market-surveillance/out-of-stock/approved-applications/_jcr_content/par.html"
    )

    # AEM teaserlist pagination URL (pages 2+)
    # teaserlistid is stable — it's the CMS component UUID baked into the template.
    _PAGING_URL: str = (
        "https://www.swissmedic.ch/swissmedic/en/home/humanarzneimittel/"
        "market-surveillance/out-of-stock/approved-applications/"
        "_jcr_content/par/teaserlist.content.paging-{page}.html"
    )
    _PAGING_PARAMS: dict = {
        "pageIndex":    "{page}",
        "_charset_":   "UTF-8",
        "teaserlistid": "teaserList_8f9ac1170355700cec9a2cd1a0d99c3e",
        "fulltext":    "",
        "datefrom":    "01.01.2018",
        "dateto":      "",
        "tags":        "",
    }

    # Regex to extract product name from aria-label
    _NAME_RE = re.compile(
        r'aria-label="Out-of-Stock\s*&ndash;\s*([^"]+)"',
        re.IGNORECASE,
    )

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        """
        Fetch all shortage records across all AEM pages.

        Returns:
            {
                "pages":       int,
                "raw_pages":   list[str],   # raw HTML per page
                "fetched_at":  str,
            }
        """
        raw_pages: list[str] = []
        page_num = 1

        self.log.info("Fetching Swissmedic shortage list (page 1)", extra={"url": self._PAGE1_URL})
        try:
            resp = self._get(self._PAGE1_URL)
            raw_pages.append(resp.text)
            self.log.info("Swissmedic page 1 fetched", extra={"bytes": len(resp.content)})
        except Exception as exc:
            self.log.error("Failed to fetch Swissmedic page 1", extra={"error": str(exc)})
            return {"pages": 0, "raw_pages": [], "fetched_at": datetime.now(timezone.utc).isoformat()}

        # Paginate through remaining pages
        while True:
            page_num += 1
            url = self._PAGING_URL.format(page=page_num)
            params = {k: v.format(page=page_num) if isinstance(v, str) else v
                      for k, v in self._PAGING_PARAMS.items()}

            self.log.debug("Fetching Swissmedic page", extra={"page": page_num, "url": url})
            try:
                time.sleep(self.RATE_LIMIT_DELAY)
                with httpx.Client(
                    headers=self.DEFAULT_HEADERS,
                    timeout=self.REQUEST_TIMEOUT,
                    follow_redirects=True,
                ) as client:
                    resp = client.get(url, params=params)
                    resp.raise_for_status()

                html_content = resp.text
                names = self._NAME_RE.findall(html_content)
                if not names:
                    self.log.info(
                        "Swissmedic pagination ended",
                        extra={"last_page_fetched": page_num - 1},
                    )
                    break

                raw_pages.append(html_content)
                self.log.debug(
                    "Swissmedic page fetched",
                    extra={"page": page_num, "entries": len(names)},
                )

                # Safety cap at 20 pages (~600 records)
                if page_num >= 20:
                    self.log.warning("Swissmedic: reached page cap (20)", extra={"page": page_num})
                    break

            except Exception as exc:
                self.log.warning(
                    "Swissmedic page fetch failed — stopping pagination",
                    extra={"page": page_num, "error": str(exc)},
                )
                break

        self.log.info(
            "Swissmedic fetch complete",
            extra={"total_pages": len(raw_pages)},
        )
        return {
            "pages":      len(raw_pages),
            "raw_pages":  raw_pages,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        """
        Extract product names from aria-label attributes across all pages.
        Each product becomes one shortage event (status=active, severity=medium).
        """
        raw_pages: list[str] = raw.get("raw_pages", [])
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        seen: set[str] = set()

        for page_idx, html_content in enumerate(raw_pages, start=1):
            names = self._NAME_RE.findall(html_content)
            for raw_name in names:
                product_name = html_lib.unescape(raw_name).strip()
                if not product_name or product_name in seen:
                    continue
                seen.add(product_name)

                # The first 1-2 words are typically the brand/INN name
                # e.g. "Abilify i.m. Injektionslösung 7.5mg/ml" → "Abilify"
                generic_name = self._extract_generic_name(product_name)

                normalised.append({
                    "generic_name":    generic_name,
                    "brand_names":     [product_name],
                    "status":          "active",
                    "severity":        "medium",
                    "reason_category": "regulatory_action",
                    "start_date":      today,
                    "source_url":      self.BASE_URL,
                    "notes": (
                        f"Swissmedic approved out-of-stock application. "
                        f"Product: {product_name}. "
                        f"Listed as approved shortage on Swissmedic portal."
                    ),
                    "raw_record": {
                        "product_name": product_name,
                        "page":         page_idx,
                        "source":       "swissmedic_approved_applications",
                    },
                })

        self.log.info(
            "Swissmedic normalisation complete",
            extra={"pages": len(raw_pages), "records": len(normalised)},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_generic_name(product_name: str) -> str:
        """
        Heuristically extract an INN-like generic name from a German brand name.

        Strategy:
          1. Strip trailing dosage/form tokens (digits, mg, ml, µg, etc.)
          2. Take the first 1–3 space-separated tokens as the drug name.

        Examples:
          "Abilify i.m. Injektionslösung 7.5mg/ml" → "Abilify"
          "NaCl 0.9% B. Braun Infusionslösung"     → "NaCl"
          "Glucose 5% B. Braun Infusionslösung"    → "Glucose"
          "Nemluvio Pulver und Lösungsmittel …"    → "Nemluvio"
        """
        # Remove trailing pharmaceutical form keywords (German/Latin)
        stop_words = {
            "injektionslösung", "infusionslösung", "filmtabletten", "tabletten",
            "kapseln", "granulat", "lyophilisat", "konzentrat", "lösung",
            "pulver", "suspension", "emulsion", "spray", "pflaster", "tropfen",
            "ampullen", "fertigpen", "fertigspritze", "und", "zur", "für",
            "mg", "ml", "µg", "mcg", "ug", "g/",
        }
        tokens = product_name.split()
        name_tokens: list[str] = []
        for tok in tokens:
            lower = tok.lower().rstrip(",./")
            if lower in stop_words or re.match(r"^\d+[\d.,/%]*$", tok):
                break
            name_tokens.append(tok)
            if len(name_tokens) >= 3:
                break

        return " ".join(name_tokens) if name_tokens else product_name.split()[0]


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
        print("=" * 60)

        scraper = SwissmedicScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  pages fetched : {raw.get('pages')}")

        events = scraper.normalize(raw)
        print(f"  events        : {len(events)}")
        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(f"  sample        : {json.dumps(sample, ensure_ascii=False)}")
        print("\nDry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = SwissmedicScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
