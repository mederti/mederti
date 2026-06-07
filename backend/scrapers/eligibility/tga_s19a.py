"""TGA Section 19A approvals scraper.

Source: https://www.tga.gov.au/resources/section-19a-approvals

The TGA publishes the Section 19A approvals as a paginated Drupal "database":
the landing page is a list of summary cards (one ``node--s19aa`` card per
approval), each linking to a detail page. There is NO HTML <table> any more —
the previous table-scraping implementation found zero rows after the TGA
re-platformed. Each summary card carries:
  • the overseas product title — brand + active ingredient + strength + form,
    with the country of origin in trailing parentheses
    e.g. "NATRILIX SR indapamide 1.5mg sustained release tablets (Germany)"
  • the published (approval) date — "25 May 2026"
  • a summary line carrying the expiry — "... approved for import and supply in
    Australia until 28/02/2027 due to a shortage ..."
  • a stable detail-page slug we use as the scheme_reference

This scraper walks every results page, extracts one row per card, and lets the
EligibilityScraper base resolve each title to a canonical drugs.id (so the row
surfaces in /search, not just on the drug page).

Run:
    source .env  # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.eligibility.tga_s19a   # dry run
    python3 -m backend.scrapers.eligibility.tga_s19a                     # write
"""

from __future__ import annotations

import html as _html
import re
import sys
import time
from datetime import date, datetime
from typing import Iterable

from .base import EligibilityRow, EligibilityScraper

# One summary card per approval. Cards are delimited by the repeated
# "node--s19aa node--summary" class; capture up to the next card / end of main.
_CARD_RE = re.compile(
    r"node--s19aa node--summary.*?(?=node--s19aa node--summary|</main|\Z)", re.S
)
# Detail-page link inside a card — the slug is our stable scheme_reference.
_LINK_RE = re.compile(
    r'href="(/resources/section-19a-approvals/[^"#?]+)"[^>]*>(.*?)</a>', re.S
)
_PUBLISHED_RE = re.compile(r"published-date.*?(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.S)
_EXPIRY_RE = re.compile(r"until\s+(\d{1,2}/\d{1,2}/\d{4})")
_PAGE_PARAM_RE = re.compile(r"[?&]page=(\d+)")
_TAGS_RE = re.compile(r"<[^>]+>")
_COUNTRY_RE = re.compile(r"\(([^()]+)\)\s*$")


class TgaSection19A(EligibilityScraper):
    SCHEME = "tga_s19a"
    COUNTRY_CODE = "AU"
    SOURCE_NAME = "TGA Section 19A approvals"
    SOURCE_URL = "https://www.tga.gov.au/resources/section-19a-approvals"
    # Browser-like UA — the TGA edge rejects/empties the default bot UA.
    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
    MAX_PAGES = 80  # safety cap; the register is ~34 pages today

    def fetch(self) -> list[str]:
        """Walk every results page; return the list of page HTML blobs.

        Aborts (raises) on an incomplete pagination rather than returning a
        partial set: with last_verified_at-based lapsing, a truncated scrape
        would wrongly mark every un-fetched approval as lapsed. Skipping the day
        is the safe failure mode.
        """
        first = self._get_with_retry(self.SOURCE_URL)
        pages = [first]
        # The pager exposes the highest page index; fall back to "until empty".
        page_nums = [int(n) for n in _PAGE_PARAM_RE.findall(first)]
        last = min(max(page_nums), self.MAX_PAGES) if page_nums else 0
        for p in range(1, last + 1):
            try:
                html = self._get_with_retry(f"{self.SOURCE_URL}?page={p}")
            except Exception as e:
                raise RuntimeError(
                    f"incomplete pagination: page {p}/{last} failed after retries ({e}); "
                    f"aborting to avoid false-lapsing the rest of the register"
                ) from e
            if "node--s19aa node--summary" not in html:
                break  # natural end (pager over-counted) — not an error
            pages.append(html)
        self.log(f"fetched {len(pages)} result page(s) (pager reported last={last})")
        return pages

    def _get_with_retry(self, url: str, attempts: int = 3) -> str:
        last_err: Exception | None = None
        for i in range(attempts):
            try:
                return self._http_get(url, timeout=60).decode("utf-8", "replace")
            except Exception as e:  # noqa: BLE001 — retry any transient failure
                last_err = e
                if i + 1 < attempts:
                    time.sleep(2 * (i + 1))
        raise last_err  # type: ignore[misc]

    def parse(self, payload: list[str]) -> Iterable[EligibilityRow]:
        if isinstance(payload, str):  # tolerate a single-page payload
            payload = [payload]

        rows: list[EligibilityRow] = []
        seen: set[str] = set()
        today = date.today()
        for html in payload:
            for card in _CARD_RE.findall(html):
                link = _LINK_RE.search(card)
                if not link:
                    continue
                slug = link.group(1).rstrip("/")
                ref = slug.rsplit("/", 1)[-1]
                if ref in seen:
                    continue
                seen.add(ref)

                title = self._text(link.group(2))
                if not title:
                    continue

                # Country sits in trailing parentheses on the title.
                country_name = None
                m_country = _COUNTRY_RE.search(title)
                product = title
                if m_country:
                    country_name = m_country.group(1).strip()
                    product = title[: m_country.start()].strip()

                listed = self._parse_date(self._first(_PUBLISHED_RE, card))
                expires = self._parse_date(self._first(_EXPIRY_RE, card))

                # status from the published expiry: still in force == active.
                if expires:
                    try:
                        status = "active" if datetime.fromisoformat(expires).date() >= today else "historical"
                    except ValueError:
                        status = "active"
                else:
                    status = "active"

                origin = f" Origin: {country_name}." if country_name else ""
                rows.append(EligibilityRow(
                    # generic_name is a best-effort here; the base resolver
                    # canonicalises it to the matched INN and sets drug_id.
                    generic_name=product or title,
                    brand_name=product or title,
                    country_code=self.COUNTRY_CODE,
                    scheme=self.SCHEME,
                    status=status,
                    scheme_reference=ref,
                    description=(
                        f"TGA Section 19A: overseas-registered '{title}' approved for "
                        f"import and supply in Australia during a shortage.{origin}"
                    ),
                    listed_at=listed,
                    expires_at=expires,
                    source_url=f"https://www.tga.gov.au{slug}",
                    source_name=self.SOURCE_NAME,
                    raw_data={"title": title, "slug": slug, "country_origin": country_name},
                ))
        return rows

    # ── helpers ──
    @staticmethod
    def _text(s: str) -> str:
        return re.sub(r"\s+", " ", _html.unescape(_TAGS_RE.sub(" ", s or ""))).strip()

    @staticmethod
    def _first(rx: re.Pattern[str], s: str) -> str:
        m = rx.search(s)
        return m.group(1) if m else ""

    @staticmethod
    def _parse_date(s: str) -> str | None:
        s = (s or "").strip()
        if not s:
            return None
        for fmt in ("%d %B %Y", "%d %b %Y", "%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return None


if __name__ == "__main__":
    summary = TgaSection19A().run()
    print(summary)
    sys.exit(0 if summary["errors"] == 0 else 1)
