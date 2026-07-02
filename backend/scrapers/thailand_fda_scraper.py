"""
Thai FDA — National Drug Information (NDI) Drug Shortage Bulletin Scraper
--------------------------------------------------------------------------
Source:  National Drug Information portal (NDI), operated by the National
         Drug Policy Division (กองนโยบายแห่งชาติด้านยา) under the Thai FDA.
URL:     https://ndi.fda.moph.go.th/ndi_news?category_id=17

The NDI portal publishes a news category (category_id=17, labelled
"ยาขาดแคลน" — "drug shortage") containing:
  - Monthly drug-shortage bulletin announcements, most of which link to a
    downloadable PDF ("รายการยาที่มีปัญหาขาดแคลนรายเดือน ณ <month> <year>" —
    "Monthly list of drugs with shortage problems as of <month> <year>").
    The PDF is a structured table: drug name, national shortage status,
    company/brand info, expected resupply timing, root-cause reason, and a
    last-updated date (Buddhist Era, DD/MM/YY or DD/MM/YYYY).
  - A small number of unrelated administrative announcements that also carry
    category_id=17 (e.g. the annual orphan-drug list notice) — these have no
    shortage-status table and are skipped.
  - Some newer bulletins link out to an external Google Looker Studio
    dashboard instead of a PDF (interactive BI report, not scrapable via
    plain HTTP) — skipped; only PDF-bearing bulletins yield structured
    per-drug rows.

Listing pagination is handled by the site's `per_page` query parameter,
which is really a *page number* (not a page size) — quirk of the CodeIgniter
pagination library the portal runs on. Critically, `per_page` alone drops
the `category_id` filter (it returns the unfiltered "all categories" list on
page ≥2), so `category_id` must be re-sent on every paginated request.

Key Thai terms relied on for parsing
─────────────────────────────────────
Status. Each bulletin row prints BOTH a Thai phrase and a canonical English
tag in parentheses (e.g. "ยังขาดแคลน (Currently in shortage)"). This
scraper keys off the THAI phrase, not the bracketed English tag — these
PDFs are multi-column tables, and pdfplumber's text extraction frequently
interleaves adjacent columns' text between "(Currently in" and "shortage)"
(the tag wraps across a line break, with company/contact text from a
neighbouring cell landing in between). The Thai phrase is a single
contiguous token in the drug-name/status cell and survives extraction
reliably (spot-checked at 77/78 rows correctly classified vs ~28% recall
for the bracketed-tag approach):
    ยังขาดแคลน            (Currently in shortage)  -> active
    อยู่ระหว่างดำเนินการแก้ไข (In process)             -> active
    แก้ไขเสร็จแล้ว          (Resolved)               -> resolved
    ยกเลิกการผลิต/นำเข้า   (Discontinuation)         -> resolved
        (Discontinuation means the manufacturer/importer has permanently
        withdrawn the product — treated as "resolved" for shortage-tracking
        purposes since it exits the active national watch-list, matching
        how other scrapers treat discontinued-product notices.)

Column headers (for reference — table is parsed from extracted PDF text,
not pdfplumber's extract_tables(), since Thai PDF text wraps unpredictably
across grid lines):
    ลำดับ                  = No.
    ชื่อตัวยา/รูปแบบ         = Drug name / dosage form
    สถานะยาในภาพรวมของประเทศ = National shortage status (see above)
    ข้อมูลเพิ่มเติม           = Additional info (brand name / company / contact)
    ยาพร้อมจำหน่าย/...      = Expected resupply timing
    ปัญหาที่พบ              = Root-cause reason
    ข้อมูลล่าสุด             = Last-updated date

Root-cause reasons. Every bulletin page prints a fixed 7-item LEGEND
defining the reason categories, but the per-drug "ปัญหาที่พบ" cell text is
often a narrower/differently-worded restatement rather than the legend
phrase verbatim (confirmed by direct inspection of extracted PDF text —
matching against the legend's own wording under-matches badly). Patterns
actually used are the observed per-row cell text:
    ปรับปรุง/แก้ไขทะเบียน/GMP     = Registration/GMP amendment      -> regulatory_action
    เปลี่ยนแปลงโรงงานผู้ผลิต       = Manufacturing site change        -> manufacturing_issue
    ปรับปรุงสถานที่ผลิต           = Manufacturing site change        -> manufacturing_issue
    ขาดแคลนวัตถุดิบ               = Raw material shortage            -> raw_material
    ยกเลิกการผลิต/ยกเลิกการวางจำหน่าย = Discontinuation of mfg/import -> discontinuation
    การขนส่งสินค้าล่าช้า(กว่ากำหนด)  = Transport/shipping delay        -> distribution
    ปริมาณคำสั่งซื้อเพิ่มมากขึ้น    = Increased order/demand           -> demand_surge
    เรียกเก็บยาคืน                = Product recall                   -> regulatory_action
    (unmatched reason text falls back to the centralized free-text
    reason_mapper, then to "unknown")

Data source UUID:  10000000-0000-0000-0000-000000000107
Country:           Thailand
Country code:      TH
Confidence:        78/100 (per migration 064 seed)

Cron:  Not yet wired (new-country scraper). Monthly cadence upstream — daily
       polling is safe since MD5 shortage_id dedup makes re-runs idempotent.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


def _loose(thai: str) -> str:
    """
    Build a regex from a literal Thai substring that tolerates a stray
    whitespace character between any two glyphs.

    Thai combining vowels/tone marks routinely pick up a spurious space
    under pdfplumber/pdfminer's text-layout engine (e.g. the word "ผลิต"
    — "manufacture" — often extracts as "ผผู้ ลติ" or "ผลติ" depending on
    the PDF's internal glyph ordering). Matching char-by-char with an
    optional `\\s*` in between is more robust than guessing exact spacing.
    """
    return r"\s*".join(re.escape(ch) for ch in thai)


class ThailandFDAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000107"
    SOURCE_NAME: str  = "Thai FDA — National Drug Information shortage bulletin"
    BASE_URL: str     = "https://ndi.fda.moph.go.th/ndi_news?category_id=17"
    COUNTRY: str      = "Thailand"
    COUNTRY_CODE: str = "TH"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0  # bulletin PDFs can run 15-30+ pages

    # Shortage-category news listing (category_id=17 = "ยาขาดแคลน" / drug shortage)
    LISTING_URL: str = "https://ndi.fda.moph.go.th/ndi_news"
    DETAIL_URL_TMPL: str = "https://ndi.fda.moph.go.th/ndi_news_detail/index/{news_id}"

    # Site pagination is CodeIgniter-style: `per_page` is actually a page
    # NUMBER (1, 2, 3, ...), not a page size, and it drops category_id
    # unless re-sent explicitly. 3 pages total observed; page 3 already
    # returns zero category-17 items, so this is a safe fixed upper bound
    # (a full re-scrape stays fast and idempotent either way).
    MAX_LISTING_PAGES: int = 5

    # Status detection is keyed on the THAI status phrase, not the bracketed
    # English tag printed alongside it in the source. These PDFs are
    # multi-column tables, and pdfplumber's extract_text() frequently
    # interleaves adjacent columns' text between "(Currently in" and
    # "shortage)" — the English tag wraps mid-phrase across a line break,
    # with unrelated cell text (company name, contact info) landing in
    # between. A literal "(...)" regex against that text misses a large
    # share of rows. The Thai phrase sits as a single contiguous token in
    # the drug-name/status column and survives extraction reliably
    # (spot-checked: 77/78 rows classified correctly in a sample bulletin,
    # vs ~28% recall keying off the bracketed English tag). Patterns
    # tolerate stray internal spaces — Thai combining vowels often get a
    # spurious space inserted by the PDF's text layer.
    _STATUS_PATTERNS: list[tuple[str, str, str]] = [
        # (regex, english label (for notes/logging), canonical status)
        (_loose("ยงั ขาดแคลน"), "Currently in shortage", "active"),
        (_loose("ดา เนินการแกไ้ ข"), "In process", "active"),
        (_loose("แกไ้ ขเสรจ็ แลว้") + "|" + _loose("แกไ้ ขเสร็จแลว้"), "Resolved", "resolved"),
        # Discontinuation means the manufacturer/importer has permanently
        # withdrawn the product — treated as "resolved" for shortage-
        # tracking purposes since it exits the active national watch-list.
        (_loose("ยกเลกิ การผลติ"), "Discontinuation", "resolved"),
    ]

    # Root-cause reason phrases (Thai) -> canonical English reason, matched
    # against pdfplumber-extracted text via _loose() (see above — tolerates
    # stray whitespace from Thai combining-vowel glyph extraction quirks).
    # Phrases were captured from actual bulletin PDF text (not the printed
    # legend's wording, which is close but NOT verbatim what appears in the
    # per-drug "ปัญหาที่พบ" reason column — e.g. the legend says "ปริมาณ
    # ความต้องการใช้ยาเพิ่มมากขึ้น" but the table cells actually say the
    # narrower "ปริมาณคำสั่งซื้อเพิ่มมากขึ้น" — order quantity increased).
    _REASON_PATTERNS: list[tuple[str, str]] = [
        (_loose("ปรบั ปรงุ") + r"\s*/?\s*" + _loose("แกไ้ ขทะเบยี น") + r"\s*/?\s*GMP",
         "Registration/GMP amendment"),
        (_loose("เปลย่ี น") + r".{0,4}" + _loose("โรงงานผผู้ ลติ"), "Manufacturing site change"),
        (_loose("ปรบั ปรงุ สถานทผ่ี ลติ"), "Manufacturing site change"),
        (_loose("ขาดแคลนวตั ถุดบิ"), "Raw material shortage"),
        (_loose("ยกเลกิ การผลติ") + "|" + _loose("ยกเลกิ การวางจา หน่าย"),
         "Discontinuation of manufacture/import"),
        (_loose("การขนสง่") + r".{0,10}" + _loose("ล่าชา้"), "Transport delay"),
        (_loose("ปรมิ าณคา สงั่ซอ้ื เพมิ่ มากขน้ึ"), "Increased order/demand"),
        (_loose("เรยี กเกบ็ ยาคนื "), "Product recall"),
    ]

    # Reason English label -> canonical reason_category (checked before
    # falling back to the centralized free-text mapper).
    _REASON_CATEGORY_MAP: dict[str, str] = {
        "Registration/GMP amendment":            "regulatory_action",
        "Manufacturing site change":              "manufacturing_issue",
        "Raw material shortage":                  "raw_material",
        "Discontinuation of manufacture/import":  "discontinuation",
        "Transport delay":                        "distribution",
        "Increased order/demand":                 "demand_surge",
        "Product recall":                         "regulatory_action",
    }

    # Bulletin titles carry this phrase; used to distinguish genuine monthly
    # shortage bulletins from unrelated administrative notices that also
    # live under category_id=17 (e.g. the annual orphan-drug-list notice).
    _BULLETIN_TITLE_MARKERS: tuple[str, ...] = (
        "รายการยาที่มีปัญหาขาดแคลน",  # "list of drugs with shortage problems"
        "ปัญหาขาดแคลน",               # "shortage problem" (looser fallback)
    )

    # Thai month names -> month number, for parsing bulletin titles like
    # "รายการยาที่มีปัญหาขาดแคลนรายเดือน ณ มกราคม 2566"
    _THAI_MONTHS: dict[str, int] = {
        "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
        "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
        "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
    }

    BE_OFFSET: int = 543  # Thai Buddhist Era = Gregorian year + 543

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch NDI drug-shortage bulletin listings, then the PDF (or detail
        page, as fallback) for each bulletin.

        Strategy:
        1. GET the category_id=17 listing, paginated (category_id must be
           re-sent on every page — see MAX_LISTING_PAGES docstring above).
        2. For each listing item whose title looks like a monthly shortage
           bulletin, fetch its detail page to find the linked PDF.
        3. Download and text-extract the PDF (pdfplumber). Bulletins that
           link to an external dashboard (e.g. Google Looker Studio) instead
           of a PDF are skipped — no scrapable per-drug data there.
        """
        listing_items = self._fetch_listing()
        self.log.info(
            "NDI listing fetched",
            extra={"items": len(listing_items)},
        )

        records: list[dict] = []
        for item in listing_items:
            if not self._looks_like_bulletin(item["title"]):
                self.log.debug(
                    "Skipping non-bulletin NDI news item",
                    extra={"title": item["title"], "url": item["url"]},
                )
                continue

            try:
                detail = self._fetch_detail(item)
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch NDI bulletin detail page",
                    extra={"error": str(exc), "url": item["url"]},
                )
                continue

            if not detail.get("pdf_url"):
                self.log.info(
                    "NDI bulletin has no linked PDF (likely external "
                    "dashboard link) — skipping",
                    extra={"title": item["title"], "url": item["url"]},
                )
                continue

            try:
                pdf_text = self._fetch_pdf_text(detail["pdf_url"])
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch/parse NDI bulletin PDF",
                    extra={"error": str(exc), "pdf_url": detail["pdf_url"]},
                )
                continue

            records.append({
                "title":         item["title"],
                "news_url":      item["url"],
                "pdf_url":       detail["pdf_url"],
                "list_date":     item.get("date"),
                "pdf_text":      pdf_text,
            })

        self.log.info("NDI fetch complete", extra={"bulletins": len(records)})
        return records

    def _fetch_listing(self) -> list[dict]:
        """Fetch all pages of the category_id=17 ('ยาขาดแคลน') news listing."""
        items: list[dict] = []
        seen_urls: set[str] = set()

        for page_num in range(1, self.MAX_LISTING_PAGES + 1):
            params: dict[str, str] = {"category_id": "17"}
            if page_num > 1:
                params["per_page"] = str(page_num)
            try:
                resp = self._get(self.LISTING_URL, params=params)
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch NDI listing page",
                    extra={"error": str(exc), "page": page_num},
                )
                break

            page_items = self._parse_listing_page(resp.text)
            new_items = [it for it in page_items if it["url"] not in seen_urls]
            if not new_items:
                # Empty page (or all-duplicate page) — end of the category.
                break
            for it in new_items:
                seen_urls.add(it["url"])
            items.extend(new_items)

        return items

    def _parse_listing_page(self, html: str) -> list[dict]:
        """Parse one page of the NDI news listing into title/url/date items."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        items: list[dict] = []

        title_links = soup.find_all("a", href=re.compile(r"ndi_news_detail/index/\d+"))
        # Each title link's container also has a sibling "t-update" date div,
        # but BeautifulSoup traversal is simplest via the shared parent block.
        for link in title_links:
            title_div = link.find_parent(class_="title-news2f")
            if title_div is None:
                continue
            title = link.get_text(strip=True)
            url = link.get("href", "")
            if not title or not url:
                continue

            # Find the nearest following ".t-update" date within the same
            # news block (structurally a sibling a few levels up).
            date_str: str | None = None
            block = title_div.find_parent(class_="boxnews2f") or title_div.parent
            if block is not None:
                date_div = block.find(class_="t-update")
                if date_div:
                    date_str = date_div.get_text(strip=True)

            news_id_match = re.search(r"/index/(\d+)", url)
            items.append({
                "title":   title,
                "url":     url,
                "news_id": news_id_match.group(1) if news_id_match else None,
                "date":    date_str,
            })

        return items

    def _looks_like_bulletin(self, title: str) -> bool:
        return any(marker in title for marker in self._BULLETIN_TITLE_MARKERS)

    def _fetch_detail(self, item: dict) -> dict:
        """Fetch a bulletin's detail page and locate its linked PDF (if any)."""
        resp = self._get(item["url"])
        html = resp.text

        pdf_match = re.search(r'href="([^"]+\.pdf)"', html, re.IGNORECASE)
        pdf_url = pdf_match.group(1) if pdf_match else None
        if pdf_url and not pdf_url.startswith("http"):
            pdf_url = f"https://ndi.fda.moph.go.th{pdf_url}"

        return {"pdf_url": pdf_url}

    def _fetch_pdf_text(self, pdf_url: str) -> str:
        """Download a bulletin PDF and extract its full text via pdfplumber."""
        try:
            import pdfplumber
        except ImportError as exc:
            raise ScraperError(
                "pdfplumber is required for the Thai FDA scraper. "
                "Install it with: pip install pdfplumber"
            ) from exc

        resp = self._get(pdf_url)

        full_text = ""
        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            self.log.debug(
                "NDI bulletin PDF opened",
                extra={"pages": len(pdf.pages), "url": pdf_url},
            )
            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    text = page.extract_text()
                    if text:
                        full_text += text + "\n"
                except Exception as exc:
                    self.log.warning(
                        "Failed to extract text from NDI PDF page",
                        extra={"url": pdf_url, "page": page_num, "error": str(exc)},
                    )

        return full_text

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize fetched bulletin PDFs into standard shortage event dicts."""
        self.log.info(
            "Normalising NDI bulletins",
            extra={"source": self.SOURCE_NAME, "bulletins": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for bulletin in raw:
            try:
                rows = self._normalise_bulletin(bulletin)
                normalised.extend(rows)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise NDI bulletin",
                    extra={"error": str(exc), "title": bulletin.get("title")},
                )

        self.log.info(
            "Normalisation done",
            extra={"bulletins": len(raw), "events": len(normalised), "skipped_bulletins": skipped},
        )
        return normalised

    def _normalise_bulletin(self, bulletin: dict) -> list[dict]:
        """Parse one bulletin's PDF text into per-drug shortage event dicts."""
        pdf_text = bulletin.get("pdf_text") or ""
        if not pdf_text.strip():
            return []

        bulletin_date = self._parse_bulletin_title_date(bulletin["title"])
        blocks = self._split_drug_blocks(pdf_text)

        # Dedupe per generic_name within a bulletin — the source lists one
        # row per BRAND under each numbered drug entry (several manufacturers
        # can share one shortage listing), but shortage_events is one row
        # per drug/source/country/start_date. Keep the block for the most
        # urgent brand-level status seen for that drug, so a drug isn't
        # marked "resolved" just because the first brand row parsed happened
        # to be the resolved one while another brand is still short.
        _URGENCY = {"resolved": 0, "active": 1}
        by_drug: dict[str, dict] = {}
        for block in blocks:
            parsed = self._parse_drug_block(block, bulletin, bulletin_date)
            if parsed is None:
                continue
            key = parsed["generic_name"].strip().lower()
            existing = by_drug.get(key)
            if existing is None:
                by_drug[key] = parsed
                continue
            existing_rank = (_URGENCY[existing["status"]], existing["severity"] == "high")
            parsed_rank = (_URGENCY[parsed["status"]], parsed["severity"] == "high")
            if parsed_rank > existing_rank:
                by_drug[key] = parsed

        return list(by_drug.values())

    def _split_drug_blocks(self, text: str) -> list[str]:
        """
        Split bulletin PDF text into per-drug-row blocks.

        Strategy: strip the repeating page header/legend (printed on every
        page), then split on lines that START a new numbered drug row
        (e.g. "1 BUPROPION HYDROCHLORIDE ..." or "1. Protamine sulphate ...").
        """
        cleaned_lines: list[str] = []
        in_legend = False
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped.startswith("นิยามสถานะยาในปัจจุบัน"):
                in_legend = True
                continue
            if in_legend:
                if "อื่นๆ" in stripped:
                    in_legend = False
                continue
            if re.match(r"^ลา\s*ดบั|^ล\s*า\s*ดบั", stripped):
                continue
            if stripped in (
                "ภาพรวมของ ระยะเวลาที่คาด ล่าสดุ",
                "ประเทศ ว่ากลบั มา",
                "จา หน่ายได้ของ",
                "แต่ละบริษทั",
            ):
                continue
            cleaned_lines.append(line)

        row_start_re = re.compile(r"^\s*\d{1,3}\.?\s+[A-Za-z]")
        blocks: list[list[str]] = []
        current: list[str] = []
        for line in cleaned_lines:
            if row_start_re.match(line):
                if current:
                    blocks.append(current)
                current = [line]
            elif current:
                current.append(line)
        if current:
            blocks.append(current)

        return ["\n".join(b) for b in blocks]

    def _parse_drug_block(
        self, block: str, bulletin: dict, bulletin_date: str | None,
    ) -> dict | None:
        """Extract generic_name / status / reason / date from one drug block."""
        flattened = re.sub(r"\s+", " ", block)

        status_en: str | None = None
        status: str | None = None
        for pattern, label, canonical in self._STATUS_PATTERNS:
            if re.search(pattern, block):
                status_en, status = label, canonical
                break
        if status is None:
            # No recognizable status phrase — likely a stray continuation
            # fragment from a drug name that wrapped across a page break.
            return None

        first_line = block.split("\n", 1)[0]
        name_match = re.match(r"^\s*\d{1,3}\.?\s+([A-Za-z][A-Za-z0-9 /\.\-]*)", first_line)
        if not name_match:
            return None
        generic_name = re.sub(r"\s+", " ", name_match.group(1)).strip()
        # Drop a bare dosage-form-only fragment (e.g. name split mid-word
        # across a page boundary leaves only "mg" or "inj" behind).
        if len(generic_name) < 3 or generic_name.lower() in {"mg", "ml", "inj", "tab", "syr"}:
            return None

        # Reason: match against the 7-item fixed legend of root causes.
        # Uses the flattened (whitespace-collapsed) text since a reason
        # phrase can itself wrap across a PDF line break.
        raw_reason: str | None = None
        for pattern, label in self._REASON_PATTERNS:
            if re.search(pattern, flattened):
                raw_reason = label
                break

        reason_category = (
            self._REASON_CATEGORY_MAP.get(raw_reason, "unknown")
            if raw_reason
            else map_reason_category(None)
        )

        # Last-updated date: the rightmost DD/MM/YY(YY) token on the block's
        # last populated line (Buddhist Era — converted to Gregorian ISO).
        last_updated: str | None = None
        for line in reversed(block.split("\n")):
            date_match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$", line.strip())
            if date_match:
                last_updated = self._be_date_to_iso(*date_match.groups())
                if last_updated:
                    break

        start_date = last_updated or bulletin_date or date.today().isoformat()

        # Brand name, if present ("ชื่อการค้า: BRAND NAME").
        brand_names: list[str] = []
        brand_match = re.search(r"ชื่อการคา้\s*:?\s*([A-Za-z0-9][A-Za-z0-9 %\.\-\(\)/]+)", flattened)
        if brand_match:
            brand_names.append(re.sub(r"\s+", " ", brand_match.group(1)).strip()[:200])

        notes_parts = [f"Bulletin: {bulletin['title'][:200]}"]
        if raw_reason:
            notes_parts.append(f"Reason: {raw_reason}")
        notes = "; ".join(notes_parts)

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             brand_names,
            "status":                  status,
            "severity":                "high" if status_en == "Currently in shortage" else "medium",
            "reason":                  raw_reason,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              bulletin.get("pdf_url") or bulletin.get("news_url") or self.BASE_URL,
            "notes":                   notes,
            "source_confidence_score": 78,
            "raw_record": {
                "bulletin_title": bulletin["title"],
                "bulletin_news_url": bulletin.get("news_url"),
                "pdf_url": bulletin.get("pdf_url"),
                "block_text": block,
                "status_en": status_en,
            },
        }

    # -------------------------------------------------------------------------
    # Date helpers
    # -------------------------------------------------------------------------

    def _parse_bulletin_title_date(self, title: str) -> str | None:
        """
        Extract a fallback start_date from a bulletin title like:
            "รายการยาที่มีปัญหาขาดแคลนรายเดือน ณ มกราคม 2566"
            ("Monthly list of drugs with shortage problems as of January 2023")
        Returns the 1st of that month, ISO-8601, Gregorian.
        """
        year_match = re.search(r"(25\d{2})", title)  # Buddhist Era, 4-digit
        if not year_match:
            return None
        be_year = int(year_match.group(1))
        gregorian_year = be_year - self.BE_OFFSET

        month_num = None
        for th_month, num in self._THAI_MONTHS.items():
            if th_month in title:
                month_num = num
                break
        if month_num is None:
            month_num = 1  # fall back to Jan 1 of that year if month unclear

        try:
            return date(gregorian_year, month_num, 1).isoformat()
        except ValueError:
            return None

    def _be_date_to_iso(self, day: str, month: str, year: str) -> str | None:
        """Convert a DD/MM/YY or DD/MM/YYYY Buddhist-Era date to ISO Gregorian."""
        try:
            d, m, y = int(day), int(month), int(year)
        except ValueError:
            return None

        if y < 100:
            # 2-digit BE year, e.g. "66" -> 2566 BE -> 2023 CE.
            # Assume 2500s century (valid through BE 2599 / CE 2056).
            y += 2500
        gregorian_year = y - self.BE_OFFSET

        try:
            return date(gregorian_year, m, d).isoformat()
        except ValueError:
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
        print("Fetches live Thai FDA NDI data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = ThailandFDAScraper(db_client=MagicMock())

        print("\n-- Fetching from Thai FDA NDI ...")
        raw = scraper.fetch()
        print(f"-- Raw bulletins received : {len(raw)}")

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

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = ThailandFDAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
