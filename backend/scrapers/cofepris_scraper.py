"""
COFEPRIS Mexican Drug Shortage Scraper
────────────────────────────────────────
Source:  COFEPRIS — Comisión Federal para la Protección contra Riesgos Sanitarios (Mexico)
URL:     https://www.gob.mx/cofepris/acciones-y-programas/desabasto-de-medicamentos

Data access
───────────
COFEPRIS publishes drug shortage ("desabasto") alerts as HTML content.
The main page lists shortage notifications that can be scraped.

Alternative: The Mexican government data portal (datos.gob.mx) may have
structured shortage data:
    https://datos.gob.mx/busca/dataset/desabasto-de-medicamentos

Primary scrape: Parse the COFEPRIS desabasto page for drug names and dates.

Data source UUID:  10000000-0000-0000-0000-000000000030  (COFEPRIS, MX)
Country:           Mexico
Country code:      MX
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

from backend.scrapers.base_scraper import BaseScraper


class CofeprisseScraper(BaseScraper):
    """Scraper for COFEPRIS Mexican drug shortage data."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000036"
    SOURCE_NAME:  str = "COFEPRIS (Mexican Federal Commission for Protection against Sanitary Risk)"
    BASE_URL:     str = "https://www.gob.mx/cofepris/acciones-y-programas/desabasto-de-medicamentos"
    COUNTRY:      str = "Mexico"
    COUNTRY_CODE: str = "MX"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT:  float = 30.0

    _HEADERS: dict = {
        "User-Agent":      "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":          "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    }

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> str:
        """GET the COFEPRIS desabasto page."""
        self.log.info("Fetching COFEPRIS shortage page", extra={"url": self.BASE_URL})
        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            resp = client.get(self.BASE_URL)
            resp.raise_for_status()
        self.log.info(
            "COFEPRIS page fetched",
            extra={"bytes": len(resp.content), "status": resp.status_code},
        )
        return resp.text

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: str) -> list[dict]:
        """
        Parse COFEPRIS shortage HTML to extract drug records.

        Looks for:
        - List items or table rows with drug names
        - Date mentions (Spanish format DD de MMMM de YYYY)
        - Links to individual shortage pages
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.log.error("beautifulsoup4 not installed.")
            return []

        soup = BeautifulSoup(raw, "html.parser")
        today = datetime.now(timezone.utc).date().isoformat()
        normalised: list[dict] = []
        skipped = 0

        # Strategy 1: Look for articles/list items in the main content
        content_area = soup.find("div", class_=re.compile(r"content|article|main", re.I))
        if not content_area:
            content_area = soup

        items = content_area.find_all(["li", "tr", "article", "div"],
                                       class_=re.compile(r"item|row|entry|nota", re.I))

        # Strategy 2: Find any links with drug names
        if not items:
            links = content_area.find_all("a", href=True)
            items = [l for l in links if len(l.get_text(strip=True)) > 5
                     and any(w in l.get_text(strip=True).lower()
                             for w in ["desabasto", "medic", "fármac", "principio"])]

        # Strategy 3: Parse table rows
        if not items:
            tables = soup.find_all("table")
            for table in tables:
                for tr in table.find_all("tr")[1:]:  # skip header
                    cells = tr.find_all("td")
                    if len(cells) >= 2:
                        items.append(tr)

        processed = set()
        for item in items:
            try:
                text = item.get_text(" ", strip=True)
                if not text or len(text) < 5 or text in processed:
                    continue
                processed.add(text)

                # Extract drug/medicine name — look for capitalized words or specific patterns
                drug_match = re.search(
                    r"(?:desabasto de|fármaco:|medicamento:|principio activo:)\s*([^\n,;]{3,80})",
                    text, re.IGNORECASE
                )
                generic_name = drug_match.group(1).strip() if drug_match else text[:60].strip()

                if not generic_name or len(generic_name) < 3:
                    skipped += 1
                    continue

                # Extract date if present (Spanish: "01 de enero de 2026")
                date_match = re.search(
                    r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})",
                    text, re.IGNORECASE
                )
                start_date = today
                if date_match:
                    parsed = self._parse_es_date(date_match.group(0))
                    if parsed:
                        start_date = parsed

                normalised.append({
                    "generic_name":    generic_name,
                    "brand_names":     [],
                    "status":          "active",
                    "severity":        "medium",
                    "reason_category": "supply_chain",
                    "start_date":      start_date,
                    "source_url":      self.BASE_URL,
                    "notes":           f"Mexican drug shortage from COFEPRIS. {text[:200]}",
                    "raw_record":      {"text": text[:500]},
                })
            except Exception as exc:
                skipped += 1
                self.log.warning("COFEPRIS: item parse error", extra={"error": str(exc)})

        self.log.info(
            "COFEPRIS normalisation done",
            extra={"normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    _ES_MONTHS = {
        "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
        "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
        "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
    }

    def _parse_es_date(self, raw: str) -> str | None:
        """Parse Spanish date '01 de enero de 2026' → '2026-01-01'."""
        match = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", raw, re.IGNORECASE)
        if match:
            day, month_es, year = match.groups()
            month = self._ES_MONTHS.get(month_es.lower())
            if month:
                return f"{year}-{month}-{day.zfill(2)}"
        return None


if __name__ == "__main__":
    import json, os, sys
    from dotenv import load_dotenv
    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"
    if dry_run:
        from unittest.mock import MagicMock
        print("=" * 60); print("DRY RUN — COFEPRIS Mexico"); print("=" * 60)
        scraper = CofeprisseScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  HTML size: {len(raw)} chars")
        events = scraper.normalize(raw)
        print(f"  events  : {len(events)}")
        if events:
            print(f"  sample  : {json.dumps({k:v for k,v in events[0].items() if k!='raw_record'}, ensure_ascii=False)}")
        sys.exit(0)
    scraper = CofeprisseScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
