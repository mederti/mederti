"""
Taiwan TFDA Drug Supply Information Scraper
--------------------------------------------
Source:  Taiwan Food and Drug Administration (食品藥物管理署, TFDA)
         Ministry of Health and Welfare (衛生福利部)
URL:     https://www.fda.gov.tw/

IMPORTANT — fidelity note (read before touching this file)
=================================================================
Taiwan has THREE relevant systems. Only ONE of them is reachable by a
plain HTTP client, and it is NOT the structured per-drug one:

1. 西藥供應資訊平台 ("Western Medicine Supply Information Platform",
   dsms.fda.gov.tw) — the REAL per-drug shortage database (live status,
   named drugs, alternative products, project-import approvals). This is
   the system that would give us high-fidelity structured data.
   CONFIRMED UNREACHABLE from this scraper's network path: TCP connect
   and TLS handshake both succeed (cert is valid, *.fda.gov.tw), but the
   server never returns an HTTP response body — the request hangs until
   client-side timeout with 0 bytes received. This is not a slow-JS
   problem; it reproduces identically with curl, httpx, and raw sockets
   with a real UA. Most likely a bot-detection/WAF layer that silently
   drops non-browser clients, or an internal-only routing quirk. A
   headless-browser (Playwright) fetch was NOT attempted here because
   BaseScraper's HTTP surface (self._get/_get_json) is httpx-based and
   introducing a browser dependency is out of scope for this file.
   Flagged in supabase/migrations/064 as needing headless-browser support.

2. 藥品供應監測系統 ("Drug Supply Monitoring System", ddms.fda.gov.tw) —
   distributor-inventory system for pharmacists/wholesalers. Not a public
   query surface; not attempted.

3. Biweekly narrative bulletins on fda.gov.tw ("本署新聞" / TFDA News,
   news.aspx?cid=4) titled e.g.:
       "西藥供應資訊平台112年6月14日至6月27日通報案件辦理情形"
       (Western Medicine Supply Info Platform — case handling status for
       the reporting period 2023-06-14 to 2023-06-27)
   These ARE plain-HTML fetchable (confirmed working via httpx) and
   publish real aggregate case-count statistics every ~2 weeks, PLUS a
   "spotlight" section naming 1+ specific drugs with a narrative status
   (e.g. "目前控貨中" = currently stock-controlled/short, "已恢復供應" =
   supply restored, "啟動公開徵求" = soliciting alternative import/mfg).

THIS SCRAPER IMPLEMENTS FALLBACK #3 (narrative bulletins). It is
LOWER FIDELITY than the real per-drug platform would be:
  - Aggregate case counts are NOT per-drug (they cover all drugs
    reported in the 2-week window as one number).
  - Only the "spotlight" drug(s) explicitly named in the bulletin text
    become individual shortage_events rows; the rest of the aggregate
    count is captured only as an informational note, not as
    normalized per-drug records.
  - Dates are ROC (Republic of China / Minguo) calendar dates embedded
    in Traditional Chinese prose and must be converted (ROC year + 1911
    = Gregorian year).
  - There is no live index/listing endpoint that plain HTTP can read
    (news.aspx list pages are populated by an ASP.NET client-side
    postback/AJAX mechanism that returns nothing to a plain GET, and
    TC/sitemap.xml is a stale cached snapshot that does not include
    current article ids). Discovery of new bulletin ids therefore
    can't be automated with an httpx-only client; NEW_BULLETIN_IDS
    below is a maintained seed list and must be extended by hand
    (or by wiring the id-discovery step into a headless-browser run)
    as new fortnightly bulletins are published.

Traditional Chinese terms relied on for parsing
------------------------------------------------
    藥品        = drug / medicine
    短缺        = shortage (藥品短缺 = drug shortage)
    供應        = supply (西藥供應資訊平台 = Western Medicine Supply Info Platform)
    缺藥        = "lacking medicine" — colloquial/media term for shortage
    通報        = report/notify (通報案件 = reported case)
    控貨中      = "under stock control" — de facto active-shortage status
    已恢復供應    = "supply restored" → resolved
    恢復供應品項  = "items with restored supply" (aggregate count)
    建議使用替代品項 = "alternative product recommended" (aggregate count)
    無短缺案件    = "investigated, found not actually short" (aggregate count)
    啟動公開徵求  = "launched a public solicitation" for alternative
                    import/manufacture — a regulatory_action response
    處理中案件數  = "cases still being processed" (aggregate count)
    原料因素      = raw-material factor (reason)
    自荒隷油战爭、供需失衡 = geopolitical/supply-demand imbalance (context, not
                    a parsed field, but appears in bulletin preambles)
    臨床用量增加、需求增加 = clinical demand increase (demand_surge reason)
    生產品質問題    = production quality issue (manufacturing_issue reason)
    全球性缺貨    = global shortage (supply_chain reason)
    缺工          = labor shortage at manufacturer (raw_material/manufacturing_issue)

Data source UUID:  10000000-0000-0000-0000-000000000116
Country:           Taiwan
Country code:      TW
Confidence:        65/100 (per data_sources seed — narrative-bulletin fallback,
                    not the structured per-drug platform)

Cron:  Not yet wired (added by a separate integration pass).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class TaiwanTFDAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000116"
    SOURCE_NAME: str  = "TFDA — Drug Supply Information Platform (Taiwan)"
    BASE_URL: str     = "https://www.fda.gov.tw/"
    COUNTRY: str      = "Taiwan"
    COUNTRY_CODE: str = "TW"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # TFDA "本署新聞" (official news) article endpoint. Individual bulletins are
    # addressed by an opaque id (usually "t" + 6 digits for press releases).
    NEWS_ARTICLE_URL: str = "https://www.fda.gov.tw/TC/newsContent.aspx"

    # ── Known biweekly "西藥供應資訊平台...通報案件辦理情形" bulletin ids ──
    # (plus a few adjacent ad-hoc press statements that also name specific
    # drugs). fda.gov.tw's news list pages are rendered client-side (a
    # plain GET returns an empty shell) and TC/sitemap.xml is a stale
    # snapshot that predates these ids, so there is no httpx-reachable
    # index to crawl automatically. This list is the discovery mechanism
    # and must be extended by hand as new fortnightly bulletins are
    # published (id format observed so far: "t" + 6 digits).
    NEWS_ARTICLE_IDS: list[str] = [
        "t601830",  # 112/6/14-6/27 biweekly bulletin (Etomidate spotlight)
        "t601812",  # 112/5/31-6/13 biweekly bulletin (Basiliximab spotlight)
        "t601790",  # 112/3/25-6/5 cumulative update (Entrectinib, Adenosine, Hep A vaccine, Basiliximab)
        "t601694",  # ad-hoc press statement re: media shortage reports (Adenosine, magnesium oxide)
        "t622409",  # 2024-01-22 press statement (莫鼻卡/ephedrine-class, artificial tears, magnesium oxide)
        "t601541",  # ad-hoc press statement re: individual brand shortages
        "t601510",  # general "TFDA continues to stabilise domestic drug supply" statement
    ]

    # Status phrases (Traditional Chinese) -> canonical status
    _STATUS_KEYWORDS: list[tuple[str, str]] = [
        ("已恢復供應", "resolved"),
        ("恢復供應中", "resolved"),
        ("穩定供應中", "resolved"),
        ("預計.{0,20}恢復供應", "anticipated"),
        ("控貨中", "active"),
        ("短缺期間", "active"),
        ("目前仍.{0,10}短缺", "active"),
        ("從節中", "active"),
    ]

    # Free-text reason phrase -> canonical reason_category. Checked before
    # falling back to the centralised map_reason_category().
    _REASON_MAP: dict[str, str] = {
        "原料因素":       "raw_material",
        "原物料":         "raw_material",
        "生產品質問題":   "manufacturing_issue",
        "製造廠尚無法開始生產": "manufacturing_issue",
        "缺工":           "manufacturing_issue",
        "全球性缺貨":     "supply_chain",
        "全球性缺货":     "supply_chain",
        "臨床用量增加":   "demand_surge",
        "需求增加":       "demand_surge",
        "需求量增加":     "demand_surge",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch TFDA biweekly drug-supply bulletins and adjacent shortage
        press statements from the TFDA News (本署新聞) section.

        Strategy (fallback #3 — see module docstring):
        1. For each known article id in NEWS_ARTICLE_IDS, GET
           newsContent.aspx?cid=4&id=<id>.
        2. Skip ids that 404 or don't contain a recognisable bulletin/
           shortage-statement body (defensive — ids can be retired).
        3. Return the raw HTML + extracted metadata per article; the bulk
           of the parsing happens in normalize() so raw_scrapes keeps the
           full source HTML for auditability.
        """
        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.NEWS_ARTICLE_URL,
        })

        records: list[dict] = []

        for article_id in self.NEWS_ARTICLE_IDS:
            url = f"{self.NEWS_ARTICLE_URL}?cid=4&id={article_id}"
            try:
                resp = self._get(url)
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch TFDA news article — skipping",
                    extra={"error": str(exc), "url": url, "article_id": article_id},
                )
                continue

            html = resp.text
            if "本署新聞" not in html and "藥品" not in html:
                self.log.warning(
                    "Article id did not return recognisable TFDA news content — skipping",
                    extra={"article_id": article_id, "url": url},
                )
                continue

            records.append({
                "article_id": article_id,
                "url": url,
                "html": html,
            })

        if not records:
            raise ScraperError(
                "TFDA fetch failed: no known bulletin ids returned usable content "
                "(all skipped or errored)"
            )

        self.log.info("TFDA fetch complete", extra={"records": len(records)})
        return records

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize TFDA bulletin/press-statement HTML into shortage event dicts."""
        self.log.info(
            "Normalising TFDA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in raw:
            try:
                results = self._normalise_article(rec)
                if not results:
                    skipped += 1
                    continue
                normalised.extend(results)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise TFDA article",
                    extra={"error": str(exc), "article_id": rec.get("article_id")},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_article(self, rec: dict) -> list[dict]:
        """
        Parse a single TFDA news article into zero or more shortage event
        dicts — one per explicitly named "spotlight" drug. The aggregate
        biweekly case-count statistics (which cover many unnamed drugs)
        are NOT expanded into per-drug rows; they're attached as context
        in `notes` on whatever named-drug rows the same article produces,
        since there is no drug identity to key them on individually.
        """
        import html as htmlmod

        html_raw = rec["html"]
        url = rec["url"]
        article_id = rec["article_id"]

        text = htmlmod.unescape(html_raw)

        title_match = re.search(r"<title>\s*(.*?)\s*-\s*本署新聞", text, re.S)
        title = title_match.group(1).strip() if title_match else ""

        publish_date_match = re.search(r"發布日期：(\d{4}-\d{2}-\d{2})", text)
        publish_date = publish_date_match.group(1) if publish_date_match else date.today().isoformat()

        # Extract the article body (TFDA's CMS content panel)
        body_idx = text.find("PnlCms")
        if body_idx == -1:
            return []
        body_html = text[body_idx:body_idx + 8000]
        body = re.sub(r"<script.*?</script>", " ", body_html, flags=re.S)
        body = re.sub(r"<[^>]+>", "\n", body)
        body = re.sub(r"[ \t]+", " ", body)
        body = re.sub(r"\n\s*\n+", "\n", body).strip()

        # ── Aggregate reporting-period stats (informational context only) ──
        # Two date-range phrasings observed:
        #   "112年6月14日至6月27日"        (year given once, shared by both ends)
        #   "自112年3月25日至112年6月5日"   (year repeated on both ends)
        period_match = re.search(
            r"(\d{2,3})年(\d{1,2})月(\d{1,2})日至(?:\d{2,3}年)?(\d{1,2})月(\d{1,2})日", text
        )
        aggregate_note = ""
        if period_match:
            roc_year, m1, d1, m2, d2 = period_match.groups()
            greg_year = int(roc_year) + 1911
            # "共接獲"/"共計接獲" and "建議使用替代品項N件(共M項藥品)" vs plain
            # "...N件" both appear across bulletins — tolerate both.
            counts_match = re.search(
                r"共(?:計)?接獲(\d+)件藥品短缺通報案件.*?"
                r"無短缺案件(\d+)件、建議使用替代品項(\d+)件.*?"
                r"恢復供應品項(\d+)件、處理中案件數(\d+)件",
                body,
            )
            if counts_match:
                received, no_shortage, alt_recommended, restored, in_progress = counts_match.groups()
                aggregate_note = (
                    f"Biweekly aggregate ({greg_year}-{int(m1):02d}-{int(d1):02d} to "
                    f"{greg_year}-{int(m2):02d}-{int(d2):02d}): {received} cases reported, "
                    f"{no_shortage} found not actually short, {alt_recommended} given "
                    f"alternative recommendations, {restored} restored to supply, "
                    f"{in_progress} still processing."
                )

        events: list[dict] = []

        # ── Spotlight sections. Two shapes observed in the wild:
        #
        # Shape A — header names ONE drug, numbered sub-items are just
        # supporting detail about that same drug:
        #     "二、針對Etomidate注射劑型供應情形，...
        #      (一)主要用於快速氣管插管...
        #      (二)國內有一張藥品許可證...
        #      (三)食藥署已於112年6月20日啟動公開徵求..."
        #
        # Shape B — header is a generic lead-in ("近期有短缺疑慮的藥品供應
        # 情形"), and EACH numbered item itself names a different drug:
        #     "三、針對近期有短缺疑慮的藥品供應情形：
        #      (一)安室律注射劑 (Adenosine)：...
        #      (二)氧化鎂錠劑：..."
        #
        # Disambiguate by checking whether the numbered sub-item text
        # itself matches a "<name>[(English)]：" drug-label prefix — if it
        # does, treat it as its own drug (Shape B); otherwise fall back to
        # attributing the header phrase's drug name to the whole block
        # (Shape A).
        header_patterns = [
            r"針對([^，。：]{2,40}?)供應情形",
            r"有關([^，。：]{2,40}?)供應(?:情形|短缺情事)",
        ]
        # Generic lead-in phrases that name a category, not an actual drug —
        # skip these as a header-drug candidate (Shape B relies on the
        # numbered sub-items instead).
        _GENERIC_HEADER_MARKERS = ("疑慮", "個別", "近期", "情事")

        drug_item_re = re.compile(
            r"^([一-鿿]{2,12}(?:\s*[（(][A-Za-z][A-Za-z\s;]{1,40}[）)])?"
            r"|[A-Za-z][A-Za-z\-]{2,30})"
            r"(?:注射劑?型?|錠劑?|口服藥?品?|膠囊|懸液|疫苗)?[：:]"
        )

        for header_match in re.finditer(
            "|".join(f"(?:{p})" for p in header_patterns), body
        ):
            header_phrase = next(g for g in header_match.groups() if g)
            header_is_generic = any(m in header_phrase for m in _GENERIC_HEADER_MARKERS)

            # Grab the block of text from this header up to the next
            # top-level 一/二/三 numeral marker or end of body.
            block_start = header_match.end()
            next_section = re.search(r"\n[一二三四五六七八九十]、", body[block_start:])
            block_end = block_start + next_section.start() if next_section else len(body)
            block = body[block_start:block_end]

            # Split the block into numbered (一)/(二)/... sub-items.
            sub_items = re.split(r"\n(?=[（(][一二三四五六七八九十][）)])", block)

            per_item_drugs: list[tuple[str, str]] = []  # (drug_name, item_text)
            for sub in sub_items:
                sub_stripped = re.sub(r"^[（(][一二三四五六七八九十][）)]", "", sub).strip()
                item_match = drug_item_re.match(sub_stripped)
                if item_match:
                    per_item_drugs.append((item_match.group(1), sub_stripped))

            if per_item_drugs and (header_is_generic or len(per_item_drugs) > 1):
                # Shape B — each numbered item is its own drug.
                for raw_name, item_text in per_item_drugs:
                    drug_name = self._extract_drug_name(raw_name)
                    if not drug_name:
                        continue
                    events.append(self._build_event(
                        drug_name, item_text, title, url, article_id,
                        publish_date, aggregate_note, header_phrase,
                    ))
            elif not header_is_generic:
                # Shape A — header itself names the drug; use the whole
                # block as the status/reason window.
                drug_name = self._extract_drug_name(header_phrase)
                if drug_name:
                    events.append(self._build_event(
                        drug_name, block, title, url, article_id,
                        publish_date, aggregate_note, header_phrase,
                    ))

        # ── "No alternative available, public solicitation launched" drugs.
        # These sentences name the drugs with the SEVEREST shortages (no
        # substitute exists) mid-prose, e.g.:
        #   "...另無替代藥品啟動公開徵求案件共計4個品項...其中肺癌用藥
        #    Entrectinib口服藥品、心律不整用藥Adenosine注射藥品及不活化
        #    A型肝炎疫苗皆已核准...；另抗排斥用藥Basiliximab注射劑型..."
        # Only fires when the phrase is immediately followed by "共計N個
        # 品項" (i.e. this is the cumulative-report shape that actually
        # goes on to name drugs) — the plain biweekly aggregate line
        # ("...啟動公開徵求案件1件、恢復供應品項...") does NOT continue
        # into a named-drug list and must not be matched here, since that
        # would otherwise bleed into an unrelated spotlight section later
        # in the same article and mint bogus drug names from prose
        # (e.g. "Rapid Sequence Intubation" from an RSI acronym gloss).
        # Only English/Latin drug names are reliably extractable from this
        # free-prose shape (Chinese-only names like "不活化A型肝炎疫苗" are
        # too ambiguous to safely split out) — that's an accepted gap in
        # this fallback path, documented in the module docstring.
        no_alt_match = re.search(
            r"無替代藥品啟動公開徵求案件共計\d+個品項.{0,400}?(?=\n[一二三四五六七八九十]、|$)",
            body, re.S,
        )
        if no_alt_match:
            window = no_alt_match.group(0)
            # Drop acronym/gloss parentheticals like "(Rapid Sequence
            # Intubation; RSI)" before scanning for drug-name tokens —
            # these are English but not drug names.
            window_for_names = re.sub(r"[（(][^）)]*[；;][^）)]*[）)]", " ", window)
            for latin_name in dict.fromkeys(re.findall(r"[A-Z][A-Za-z]{3,}", window_for_names)):
                events.append(self._build_event(
                    latin_name, window, title, url, article_id,
                    publish_date, aggregate_note, "無替代藥品啟動公開徵求",
                ))

        # If no spotlight drug was named but the article is clearly a
        # bulletin with aggregate stats, still surface it via a synthetic
        # "platform-wide" note so the run isn't silently empty-handed for
        # periods with no named drug — but skip that fallback if this is
        # just a generic policy statement with no numbers at all.
        if not events and aggregate_note:
            events.append({
                "generic_name":            "Multiple drugs (aggregate report)",
                "status":                  "active",
                "severity":                "low",
                "reason":                  None,
                "reason_category":         "unknown",
                "start_date":              publish_date,
                "source_url":              url,
                "notes":                   f"{title} | {aggregate_note}",
                "source_confidence_score": 55,
                "raw_record": {
                    "article_id": article_id,
                    "title": title,
                },
            })

        return events

    def _build_event(
        self,
        drug_name: str,
        window: str,
        title: str,
        url: str,
        article_id: str,
        publish_date: str,
        aggregate_note: str,
        spotlight_phrase: str,
    ) -> dict:
        """Build a single normalized shortage-event dict for a named drug
        found in a TFDA bulletin/press-statement window of text."""
        status = self._determine_status(window)
        raw_reason = self._extract_reason(window)
        reason_category = self._map_reason(raw_reason)

        notes_parts = [f"Spotlight in TFDA bulletin: {title}"]
        if aggregate_note:
            notes_parts.append(aggregate_note)
        notes = " | ".join(notes_parts)

        return {
            "generic_name":            drug_name,
            "status":                  status,
            "severity":                "medium",
            "reason":                  raw_reason or None,
            "reason_category":         reason_category,
            "start_date":              publish_date,
            "source_url":              url,
            "notes":                   notes,
            "source_confidence_score": 65,
            "raw_record": {
                "article_id": article_id,
                "title": title,
                "spotlight_phrase": spotlight_phrase,
                "window": window[:800],
            },
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _extract_drug_name(self, phrase: str) -> str:
        """
        Extract a usable drug/product name from a spotlight phrase such as
        "Etomidate注射劑型", "抗排斥用藥(Basiliximab注射劑型)",
        or "莫鼻卡藥品".

        Prefers the English INN/brand token (Latin letters) when present,
        since that's what the drugs table keys on; otherwise falls back to
        the Chinese product phrase itself, stripped of dosage-form suffixes.
        """
        # Prefer an embedded Latin drug name (INN or brand), e.g. "Etomidate"
        # or "Basiliximab" out of "抗排斥用藥(Basiliximab注射劑型)"
        latin_match = re.search(r"[A-Za-z][A-Za-z\-]{2,}", phrase)
        if latin_match:
            return latin_match.group(0).strip()

        # No Latin token — use the Chinese phrase, stripping common
        # dosage-form / packaging suffixes.
        cleaned = phrase
        for suffix in ("注射劑型", "錠劑", "口服藥品", "膠囊",
                       "懸液", "藥品", "疫苗"):
            cleaned = cleaned.replace(suffix, "")
        cleaned = cleaned.strip("（）() ")
        return cleaned or phrase.strip()

    def _determine_status(self, text: str) -> str:
        """Determine shortage status from bulletin narrative text."""
        for pattern, status in self._STATUS_KEYWORDS:
            if re.search(pattern, text):
                return status
        return "active"

    def _map_reason(self, raw: str) -> str:
        """Map TFDA reason phrase to canonical reason_category."""
        if not raw:
            return "unknown"
        for key, cat in self._REASON_MAP.items():
            if key in raw:
                return cat
        return map_reason_category(raw)

    def _extract_reason(self, text: str) -> str:
        """Extract a shortage reason phrase from narrative bulletin text."""
        for phrase in self._REASON_MAP:
            if phrase in text:
                return phrase
        return ""


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
        print("Fetches live TFDA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = TaiwanTFDAScraper(db_client=MagicMock())

        print("\n-- Fetching from TFDA ...")
        raw = scraper.fetch()
        print(f"-- Raw records received : {len(raw)}")

        print("-- Normalising records ...")
        events = scraper.normalize(raw)
        print(f"-- Normalised events    : {len(events)}")

        if events:
            print("\n-- Sample event (first record, raw_record omitted):")
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str, ensure_ascii=False))

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

    scraper = TaiwanTFDAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
