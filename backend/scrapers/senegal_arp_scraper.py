"""
ARP Senegal — Vigilances rupture d'approvisionnement Scraper
--------------------------------------------------------------------------
Source:  Agence senegalaise de Reglementation Pharmaceutique (ARP)
URL:     https://arp.sn/publications/  (primary — dense, timestamped list)
         https://arp.sn/communiques/   (secondary — overlapping mirror, kept
                                        as a fallback source of the same feed)

Live-verified (2026-07-02, direct fetch): arp.sn does NOT run a single
tabular shortage registry. Instead, the "Publications" page renders a
WordPress "latest posts" style listing where every notice/circular/report
the agency issues gets its own dated PDF, embedded via two overlapping
HTML structures on the same page:

  1. A scrolling "Nouvelles publications" ticker:
         <p class="blink1"> Nouvelles publications:: <a href="...pdf">Title
         --- <a href="...pdf">Title --- ...
     (malformed/unclosed <a> tags — title text always precedes the next
     "---" separator or the next <a>, so we split on "---" rather than
     relying on tag nesting.)

  2. A WordPress "Latest Posts" block per publication:
         <h2 ...><a href=".../uploads/YYYY/MM/Slug.pdf">Title</a></h2>
         ...
         <div class="wp-block-file ..."><a href="...pdf">Title</a>
             <a href="...pdf" class="wp-block-file__button" download>
                 Telecharger</a></div>
     This is the more reliable structure (clean single title per PDF,
     one href) and is used as the PRIMARY extraction path. The ticker is
     used only to backfill any titles the h2 blocks miss (defensive,
     rarely triggers).

  The PDF upload path (/wp-content/uploads/YYYY/MM/...) is used as the
  best available proxy for publish date, since no visible date stamp
  sits next to each list item.

IMPORTANT — PDFs are scanned images, not text PDFs:
  Every ARP notice PDF checked during research (COLCHICINE rupture notice,
  ALDACTAZINE/ALDACTONE rupture notice, PALUVA/ARTEGEN lot-recall notice)
  is a scanned/photographed letterhead document with ZERO embedded text
  layer (pdfplumber's page.extract_text() returns "", page.chars is empty,
  only a single embedded raster image per page). There is no OCR toolchain
  (tesseract/pytesseract) available in this environment or elsewhere in
  the codebase's scraper dependencies.

  Consequently this scraper:
    - Uses pdfplumber to ATTEMPT text extraction per PDF (future-proofs
      against ARP eventually publishing text-native PDFs, and picks up
      any partial text layer that does exist on some documents).
    - Falls back to the HTML list-item TITLE as the substantive record
      when the PDF has no extractable text (the common case today). ARP
      notice titles are self-describing sentences (e.g. "RUPTURE
      TEMPORAIRE D'APPROVISIONNEMENT DE COLCHICINE 1 MG, COMPRIME SECABLE,
      BOITE DE 20 DES LABORATOIRES MAYOL Y SPINDER") that already carry
      product name + dosage form + strength + manufacturer, so the title
      alone is enough to build a usable shortage record.

French terms relied on for classification:
    "rupture d'approvisionnement" / "rupture de stock" = supply rupture /
        stock shortage — the core shortage signal this scraper targets.
    "rappel de lot(s)" / "rappel de produit(s)" = batch/product RECALL —
        a different signal type (quality/safety defect, not a shortage).
        Explicitly excluded here; recalls belong in a recalls scraper.
    "note d'information" = "information notice" — generic wrapper term
        used both for shortage notices AND unrelated administrative/safety
        notices (e.g. drug-interaction warnings). Title keyword matching
        (see _is_shortage_notice) disambiguates.
    "disponible" / "resolue" / "retour" = available / resolved / return
        (of stock) — used to detect a shortage has since been resolved,
        though ARP does not appear to publish explicit resolution notices
        for the shortages found during research; status defaults to
        'active' unless resolution language is present in the title/text.

Data source UUID:  10000000-0000-0000-0000-000000000115
Country:           Senegal
Country code:      SN
Confidence:        70/100 (seeded in data_sources; per-notice PDFs, no
                    running index, scanned-image PDFs limit text fidelity)

Cron:  Not yet wired (per task instructions — integration is out of scope
       for this file). Recommend daily, given low publication cadence.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class SenegalARPScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000115"
    SOURCE_NAME: str  = "ARP — Vigilances rupture d'approvisionnement (Senegal)"
    BASE_URL: str     = "https://arp.sn/publications/"
    COUNTRY: str      = "Senegal"
    COUNTRY_CODE: str = "SN"

    # Secondary page: overlapping mirror of the same "Nouvelles publications"
    # feed embedded site-wide. Fetched defensively in case it ever carries
    # notices not (yet) mirrored onto /publications/.
    COMMUNIQUES_URL: str = "https://arp.sn/communiques/"

    RATE_LIMIT_DELAY: float = 3.0   # Be polite — small agency server
    REQUEST_TIMEOUT: float  = 75.0  # Large scanned-image PDFs are slow
    SCRAPER_VERSION: str    = "1.0.0"

    # Keywords (accent-stripped, lowercased) that identify a genuine
    # shortage / stock-rupture notice, as opposed to recalls or unrelated
    # administrative/safety notices that also live under "Publications".
    _SHORTAGE_KEYWORDS: tuple[str, ...] = (
        "rupture d'approvisionnement",
        "rupture dapprovisionnement",
        "rupture de stock",
        "rupture temporaire",
        "situation des stocks",
        "penurie",
    )

    # Keywords that mark a PURE recall / lot-alert notice — these are a
    # different signal type and must be excluded even if they mention
    # "rupture" in passing (e.g. a recall that also notes remaining stock).
    _RECALL_KEYWORDS: tuple[str, ...] = (
        "rappel de lot",
        "rappel de lots",
        "rappel de produit",
        "rappel de deux",
        "rappel de neuf",
        "rappel sur",
    )

    # Keywords indicating the shortage has been resolved / stock restored.
    _RESOLVED_KEYWORDS: tuple[str, ...] = (
        "disponibilite retablie",
        "retour en stock",
        "stock disponible",
        "fin de la rupture",
        "reapprovisionnement effectue",
    )

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch ARP publication listings and enumerate individual notices.

        Strategy:
        1. GET /publications/ and extract every (title, pdf_url) pair from
           the WordPress "latest posts" h2/wp-block-file structure.
        2. GET /communiques/ as a defensive secondary pass, merging in any
           title/url pairs not already seen (deduped by pdf_url).
        3. Filter to genuine shortage notices (see _is_shortage_notice) —
           recalls and unrelated administrative notices are dropped here
           so normalize() only ever sees shortage-shaped candidates.
        4. For each candidate, attempt to download + extract PDF text via
           pdfplumber (best-effort; ARP notices are scanned images today
           so this will usually be empty — normalize() falls back to the
           HTML title in that case).
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        items: dict[str, dict] = {}  # pdf_url -> {title, pdf_url}

        # ── 1. Primary page ──────────────────────────────────────────────
        try:
            resp = self._get(self.BASE_URL)
            items.update(self._extract_items(resp.text, BeautifulSoup))
        except Exception as exc:
            self.log.error(
                "Failed to fetch ARP publications page",
                extra={"url": self.BASE_URL, "error": str(exc)},
            )

        # ── 2. Secondary/mirror page (defensive — same feed, may drift) ──
        try:
            resp2 = self._get(self.COMMUNIQUES_URL)
            for url, item in self._extract_items(resp2.text, BeautifulSoup).items():
                items.setdefault(url, item)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch ARP communiques page (non-fatal)",
                extra={"url": self.COMMUNIQUES_URL, "error": str(exc)},
            )

        self.log.info(
            "Found publication items",
            extra={"count": len(items)},
        )

        # ── 3. Filter to genuine shortage notices ────────────────────────
        candidates = [
            item for item in items.values()
            if self._is_shortage_notice(item["title"])
        ]
        self.log.info(
            "Filtered to shortage-shaped notices",
            extra={"total": len(items), "shortage_candidates": len(candidates)},
        )

        # ── 4. Best-effort PDF text extraction per candidate ─────────────
        records: list[dict] = []
        for item in candidates:
            record = dict(item)
            record["pdf_text"] = self._fetch_and_extract_pdf_text(item["pdf_url"])
            records.append(record)

        self.log.info("ARP fetch complete", extra={"records": len(records)})
        return records

    def _extract_items(self, html: str, soup_cls) -> dict[str, dict]:
        """
        Extract {pdf_url: {title, pdf_url}} from an ARP page.

        Primary structure: WordPress "latest posts" h2 anchor directly
        wrapping the PDF link, e.g.:
            <h2 ...><a href=".../uploads/2025/03/Slug.pdf">Title</a></h2>

        Secondary fallback: the "Nouvelles publications" ticker paragraph,
        whose anchors are unclosed — title text runs from one <a href="...">
        up to the next "---" separator.
        """
        found: dict[str, dict] = {}

        soup = soup_cls(html, "html.parser")

        # Primary: h2 > a[href$=.pdf]
        for h2 in soup.find_all("h2"):
            a = h2.find("a", href=True)
            if not a:
                continue
            href = a["href"]
            if not href.lower().endswith(".pdf"):
                continue
            title = a.get_text(strip=True)
            if not title:
                continue
            found.setdefault(href, {"title": title, "pdf_url": href})

        # Secondary: "Nouvelles publications" ticker — malformed markup, so
        # parse with a regex over the raw HTML rather than BeautifulSoup
        # (BS4 would mis-nest the unclosed <a> tags).
        ticker_match = re.search(
            r'class="blink1"[^>]*>(.*?)</p>', html, re.S | re.I
        )
        if ticker_match:
            ticker_html = ticker_match.group(1)
            # Split on the "<a href="...">" markers, keeping the href.
            pieces = re.findall(
                r'<a\s+href="([^"]+)"[^>]*>(.*?)(?=<a\s+href="|$)',
                ticker_html,
                re.S,
            )
            for href, chunk in pieces:
                # Title = text up to the "---" separator (or end of chunk).
                text = re.sub(r"<[^>]+>", " ", chunk)
                text = text.split("---")[0]
                text = re.sub(r"\s+", " ", text).strip()
                if not text or not href.lower().endswith(".pdf"):
                    continue
                found.setdefault(href, {"title": text, "pdf_url": href})

        return found

    def _fetch_and_extract_pdf_text(self, pdf_url: str) -> str:
        """
        Download a notice PDF and attempt text extraction via pdfplumber.

        Returns an empty string (not None) when the PDF has no text layer
        (the common case — ARP notices are scanned images) so callers can
        treat "no text" uniformly without a None check.
        """
        try:
            import pdfplumber
        except ImportError:
            self.log.error(
                "pdfplumber not installed — required for ARP PDF parsing. "
                "Install with: pip install pdfplumber"
            )
            return ""

        import io

        try:
            resp = self._get(pdf_url)
        except Exception as exc:
            self.log.warning(
                "Failed to download ARP notice PDF",
                extra={"url": pdf_url, "error": str(exc)},
            )
            return ""

        try:
            with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
                pages_text = []
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        pages_text.append(text)
                full_text = "\n".join(pages_text).strip()
                if not full_text:
                    self.log.debug(
                        "PDF has no extractable text (likely scanned image)",
                        extra={"url": pdf_url},
                    )
                return full_text
        except Exception as exc:
            self.log.warning(
                "Failed to parse ARP notice PDF",
                extra={"url": pdf_url, "error": str(exc)},
            )
            return ""

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize ARP shortage-notice candidates into shortage event dicts."""
        self.log.info(
            "Normalising ARP records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise ARP record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict) -> dict | None:
        """Convert a single ARP notice candidate into a normalised shortage event dict."""
        title = str(rec.get("title") or "").strip()
        if not title:
            return None

        # Double-check the shortage/recall classification here too, in case
        # normalize() is ever called directly on unfiltered raw records
        # (e.g. from a cached raw_scrapes row predating a filter change).
        if not self._is_shortage_notice(title):
            return None

        pdf_text = str(rec.get("pdf_text") or "").strip()
        # Prefer PDF body text when available (rare — most notices are
        # scanned images); otherwise fall back to the HTML title, which
        # ARP writes as a self-describing sentence.
        source_text = pdf_text if pdf_text else title

        generic_name = self._extract_generic_name(title, pdf_text)
        if not generic_name:
            return None

        pdf_url = rec.get("pdf_url") or self.BASE_URL
        start_date = self._infer_start_date(pdf_url, pdf_text) or date.today().isoformat()

        status = "resolved" if self._is_resolved(source_text) else "active"

        raw_reason = title
        reason_category = map_reason_category(raw_reason)
        if reason_category == "unknown":
            # "rupture d'approvisionnement" without other keyword hits —
            # this is squarely a supply_chain event by definition.
            reason_category = "supply_chain"

        notes_parts: list[str] = [f"ARP notice: {title}"]
        if not pdf_text:
            notes_parts.append(
                "PDF is a scanned image with no extractable text — "
                "record derived from the publication listing title only."
            )
        notes = "; ".join(notes_parts)

        return {
            "generic_name":    generic_name.title(),
            "brand_names":     [],
            "status":          status,
            "severity":        "medium",
            "reason":          raw_reason,
            "reason_category": reason_category,
            "start_date":      start_date,
            "source_url":      pdf_url,
            "notes":           notes,
            "raw_record":      rec,
        }

    # -------------------------------------------------------------------------
    # Classification helpers
    # -------------------------------------------------------------------------

    @classmethod
    def _is_shortage_notice(cls, title: str) -> bool:
        """
        True if the title text identifies a genuine shortage / stock-rupture
        notice. Pure recall notices (rappel de lot(s)/produit(s)) are
        excluded even if they mention rupture-adjacent terms, since recalls
        are a distinct signal type handled by a separate scraper.
        """
        normalised = cls._strip_accents(title.lower())

        if any(kw in normalised for kw in cls._RECALL_KEYWORDS):
            return False

        return any(kw in normalised for kw in cls._SHORTAGE_KEYWORDS)

    @classmethod
    def _is_resolved(cls, text: str) -> bool:
        normalised = cls._strip_accents(text.lower())
        return any(kw in normalised for kw in cls._RESOLVED_KEYWORDS)

    @staticmethod
    def _strip_accents(text: str) -> str:
        import unicodedata
        nfkd = unicodedata.normalize("NFKD", text)
        return "".join(c for c in nfkd if not unicodedata.combining(c))

    # -------------------------------------------------------------------------
    # Drug-name extraction
    # -------------------------------------------------------------------------

    # Matches "... DE <DRUG NAME> <strength/form ...> DES LABORATOIRES ..."
    # or "... DE <DRUG NAME> <strength ...>" — captures the product name
    # immediately following "rupture d'approvisionnement de" / "rupture de
    # stock de", up to the first comma, dosage-form word, or "DES
    # LABORATOIRES" manufacturer suffix.
    _PRODUCT_AFTER_RUPTURE = re.compile(
        r"rupture\s+(?:temporaire\s+)?d[’'e]?\s*approvisionnement\s+de\s+(.+)",
        re.IGNORECASE,
    )
    _PRODUCT_AFTER_STOCK = re.compile(
        r"rupture\s+de\s+stock\s+de\s+(.+)",
        re.IGNORECASE,
    )

    _DOSAGE_FORM_SPLIT = re.compile(
        r"\s*[,]|"
        r"\s+\d+[\.,]?\d*\s*(?:mg|g|ml|mcg|iu|%|ug|mcg/ml|mg/ml)\b|"
        r"\s+(?:comprime|comprimes|cp|gelule|gelules|injection|solution|"
        r"suspension|sirop|creme|pommade|gouttes?|inhalateur|poudre|gel|"
        r"boite|flacon|ampoule|ampoules)\b|"
        r"\s+des\s+laboratoires\b",
        re.IGNORECASE,
    )

    # Fallback for titles that name the product WITHOUT a "de <product>"
    # connector, e.g. "NOTE D'INFORMATION RUPTURE TEMPORAIRE
    # APPROVISIONNEMENT ALDACTAZINE ALDACTONE" — the product name(s) are
    # the trailing run of ALL-CAPS word(s) after the rupture/approvisionnement
    # keywords. Brand names are frequently doubled up (two trade names for
    # the same molecule combination), so we keep the whole trailing run and
    # let _find_or_create_drug's downstream matching handle it; only the
    # first token is used as generic_name to avoid over-long drug names.
    # Note: only the trailing CAPTURE group must be upper-case (this is what
    # distinguishes an ALL-CAPS brand-name run from ordinary title-case
    # filler words) — the "approvisionnement" anchor itself is matched
    # case-insensitively since ARP titles are inconsistently cased.
    _TRAILING_CAPS_RUN = re.compile(
        r"approvisionnement\s+((?:[A-Z0-9][A-Z0-9\-]{2,}\s*)+)$",
        re.IGNORECASE
        # (the IGNORECASE flag applies to the whole pattern; uppercase-only
        # capture is enforced separately in _match_product_name by checking
        # the captured text against its own .upper() form)
    )

    # Generic-category notices ("situation des stocks en solutés de
    # remplissage") name a drug CLASS, not a specific product — these
    # cannot be resolved to a single generic_name and are intentionally
    # dropped by _extract_generic_name returning "".
    _GENERIC_CATEGORY_TERMS: tuple[str, ...] = (
        "solutes de remplissage",
        "solutes de rempllssage",  # ARP's own typo, seen live on the site
    )

    @classmethod
    def _extract_generic_name(cls, title: str, pdf_text: str) -> str:
        """
        Extract a drug/product name from the ARP notice title (the reliable
        source, since PDFs are usually scanned images). Falls back to
        scanning pdf_text with the same patterns when the title alone
        doesn't match (e.g. a generic "NOTE D'INFORMATION" title whose body
        text names the product).

        Returns "" when the notice names a drug CLASS/category rather than
        a specific product (e.g. "solutés de remplissage") — there's no
        single generic_name to resolve to, so the caller skips the record
        rather than guessing.
        """
        title_normalised = cls._strip_accents(title.lower())
        if any(term in title_normalised for term in cls._GENERIC_CATEGORY_TERMS):
            return ""

        for source in (title, pdf_text):
            if not source:
                continue
            name = cls._match_product_name(source)
            if name:
                return name

        return ""

    @classmethod
    def _match_product_name(cls, text: str) -> str:
        normalised = cls._strip_accents(text)

        for pattern in (cls._PRODUCT_AFTER_RUPTURE, cls._PRODUCT_AFTER_STOCK):
            m = pattern.search(normalised)
            if not m:
                continue
            tail = m.group(1).strip()
            # Cut at the first dosage-form/strength/manufacturer marker.
            split = cls._DOSAGE_FORM_SPLIT.split(tail, maxsplit=1)
            name = split[0].strip(" .:-")
            if name and len(name) >= 3:
                return name

        # Fallback: trailing ALL-CAPS product name(s) with no "de" connector.
        # The anchor keyword is matched case-insensitively, but the captured
        # run itself must genuinely be upper-case — otherwise this would
        # match ordinary title-case filler words in mixed-case titles.
        m = cls._TRAILING_CAPS_RUN.search(normalised)
        if m and m.group(1).strip() == m.group(1).strip().upper():
            caps_run = m.group(1).strip()
            # Use only the first brand token as generic_name — subsequent
            # tokens (e.g. a second trade name for the same combination)
            # are preserved in `reason`/`notes` but would otherwise pollute
            # generic_name with multiple product names glued together.
            first_token = caps_run.split()[0].strip(" .:-")
            if first_token and len(first_token) >= 3:
                return first_token

        return ""

    # -------------------------------------------------------------------------
    # Date helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _infer_start_date(pdf_url: str, pdf_text: str) -> str | None:
        """
        Infer a start date. Preference order:
          1. An explicit date found in the PDF body text (rare — scanned
             images have no text layer today).
          2. The /wp-content/uploads/YYYY/MM/ path segment on the PDF URL,
             used as a proxy for publish date (first of the month, since
             the exact day isn't encoded in the URL).
        """
        if pdf_text:
            date_from_text = SenegalARPScraper._parse_date_from_text(pdf_text)
            if date_from_text:
                return date_from_text

        match = re.search(r"/uploads/(\d{4})/(\d{2})/", pdf_url)
        if match:
            year, month = match.groups()
            return f"{year}-{month}-01"

        return None

    @staticmethod
    def _parse_date_from_text(text: str) -> str | None:
        """Look for a French-format date like '24 février 2024' or '24/02/2024'."""
        months_fr = {
            "janvier": "01", "fevrier": "02", "mars": "03", "avril": "04",
            "mai": "05", "juin": "06", "juillet": "07", "aout": "08",
            "septembre": "09", "octobre": "10", "novembre": "11", "decembre": "12",
        }
        normalised = SenegalARPScraper._strip_accents(text.lower())

        m = re.search(
            r"(\d{1,2})\s+(" + "|".join(months_fr.keys()) + r")\s+(\d{4})",
            normalised,
        )
        if m:
            day, month_name, year = m.groups()
            return f"{year}-{months_fr[month_name]}-{int(day):02d}"

        m2 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", text)
        if m2:
            day, month, year = m2.groups()
            try:
                return date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                return None

        return None


# -------------------------------------------------------------------------
# Standalone entrypoint
# -------------------------------------------------------------------------

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
        print("Fetches live ARP Senegal data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = SenegalARPScraper(db_client=MagicMock())

        print("\n-- Fetching from ARP Senegal ...")
        raw = scraper.fetch()
        print(f"-- Raw shortage-candidate records received : {len(raw)}")

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
        else:
            print("\n-- No shortage-shaped notices found in this run.")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = SenegalARPScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
