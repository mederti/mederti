"""
ANSM — Safety Information / Recalls Scraper (France)
────────────────────────────────────────────────────
Source:  ANSM — Agence nationale de sécurité du médicament
Page:   https://ansm.sante.fr/informations-de-securite/

The old /rappels-de-lots URL is 404. ANSM consolidated all safety notices
under /informations-de-securite/ with filters for product type and category.

Strategy: paginate through the medication-filtered listing (productTypes=1),
parse <article> elements, filter to RAPPEL categories only.
20 items per page, scrape back to 2020.

Source UUID:  10000000-0000-0000-0000-000000000031
Country code: FR
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

from backend.scrapers.base_recall_scraper import BaseRecallScraper


class ANSMRecallsScraper(BaseRecallScraper):
    """Scraper for ANSM medication recalls / safety notices."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000031"
    SOURCE_NAME:  str = "ANSM — Rappels de lots (France)"
    BASE_URL:     str = "https://ansm.sante.fr/informations-de-securite/"
    LIST_URL:     str = (
        "https://ansm.sante.fr/informations-de-securite/"
        "?safety_news_filter%5BproductTypes%5D%5B%5D=1&page={page}"
    )
    COUNTRY:      str = "France"
    COUNTRY_CODE: str = "FR"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 15.0
    MAX_PAGES:        int = 200  # ~4000 items max
    CUTOFF_YEAR:      int = 2020

    _HEADERS: dict = {
        "User-Agent": "Mozilla/5.0 (compatible; Mederti-Scraper/1.0)",
        "Accept":     "text/html",
    }

    # Categories that count as recalls
    _RECALL_CATEGORIES: frozenset[str] = frozenset([
        "rappel de produit",
        "rappel de lot",
        "retrait de lot",
        "retrait de produit",
    ])

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        all_records: list[dict] = []
        stop = False

        with httpx.Client(
            headers=self._HEADERS,
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
        ) as client:
            for page in range(1, self.MAX_PAGES + 1):
                url = self.LIST_URL.format(page=page)
                try:
                    resp = client.get(url)
                    resp.raise_for_status()
                except Exception as exc:
                    self.log.warning("ANSM page fetch failed", extra={
                        "page": page, "error": str(exc),
                    })
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                articles = soup.find_all("article", class_="article-item")

                if not articles:
                    self.log.info("ANSM: no more articles", extra={"page": page})
                    break

                for article in articles:
                    rec = self._parse_article(article)
                    if not rec:
                        continue

                    # Check cutoff year
                    year = self._extract_year(rec.get("date", ""))
                    if year and year < self.CUTOFF_YEAR:
                        stop = True
                        break

                    # Filter to recall categories only
                    cat = rec.get("category", "").lower()
                    if any(rc in cat for rc in self._RECALL_CATEGORIES):
                        all_records.append(rec)

                if stop:
                    self.log.info("ANSM: reached cutoff year", extra={
                        "page": page, "cutoff": self.CUTOFF_YEAR,
                    })
                    break

                if page % 20 == 0:
                    self.log.info("ANSM page progress", extra={
                        "page": page, "records": len(all_records),
                    })

                time.sleep(self.RATE_LIMIT_DELAY)

        self.log.info("ANSM fetch complete", extra={"total": len(all_records)})
        return all_records

    def _parse_article(self, article) -> dict | None:
        title_el = article.find("span", class_="article-title")
        date_el = article.find("span", class_="article-date")
        cat_el = article.find("span", class_="article-category")
        link_el = article.find("a")

        title = title_el.get_text(strip=True) if title_el else ""
        if not title:
            return None

        return {
            "title":    title,
            "date":     date_el.get_text(strip=True) if date_el else "",
            "category": cat_el.get_text(strip=True) if cat_el else "",
            "url":      link_el["href"] if link_el and link_el.get("href") else "",
        }

    @staticmethod
    def _extract_year(date_str: str) -> int | None:
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", date_str)
        if m:
            return int(m.group(3))
        return None

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
                self.log.debug("ANSM normalise error", extra={"error": str(exc)})

        self.log.info("ANSM normalisation done", extra={
            "normalised": len(normalised), "skipped": skipped,
        })
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        title = rec.get("title", "").strip()
        if not title:
            return None

        # Extract product name and manufacturer from title
        # Typical format: "Product Name – Manufacturer" or "Product Name - Manufacturer"
        parts = re.split(r"\s*[–—-]\s*", title, maxsplit=1)
        product_name = parts[0].strip()[:100]
        manufacturer = parts[1].strip()[:200] if len(parts) > 1 else None

        # Parse date from "PUBLIÉ LE DD/MM/YYYY"
        date_str = rec.get("date", "")
        announced_date = self._parse_date(date_str)
        if not announced_date:
            announced_date = datetime.now(timezone.utc).date().isoformat()

        # URL
        url_path = rec.get("url", "")
        press_url = (
            f"https://ansm.sante.fr{url_path}"
            if url_path.startswith("/")
            else url_path or self.BASE_URL
        )

        # Recall ref from URL slug
        recall_ref = url_path.split("/")[-1][:80] if url_path else product_name[:60]

        return {
            "generic_name":     product_name,
            "brand_name":       None,
            "manufacturer":     manufacturer,
            "recall_class":     None,
            "recall_type":      "batch",  # Rappel de lot = batch recall
            "reason":           rec.get("category", ""),
            "reason_category":  "other",
            "lot_numbers":      [],
            "announced_date":   announced_date,
            "status":           "active",
            "press_release_url": press_url,
            "confidence_score": 85,
            "recall_ref":       f"ANSM-{recall_ref}",
            "raw_record":       rec,
        }

    @staticmethod
    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw)
        if m:
            day, month, year = m.groups()
            return f"{year}-{month}-{day}"
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
        print("=" * 60); print("DRY RUN — ANSM Recalls"); print("=" * 60)
        scraper = ANSMRecallsScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"  raw records: {len(raw)}")
        recalls = scraper.normalize(raw)
        print(f"  normalised : {len(recalls)}")
        if recalls:
            print(json.dumps({k: v for k, v in recalls[0].items() if k != "raw_record"}, indent=2, default=str))
        sys.exit(0)
    scraper = ANSMRecallsScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
