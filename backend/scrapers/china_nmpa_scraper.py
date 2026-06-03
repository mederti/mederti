"""
NMPA China — Drug Enforcement / API-Suspension Signal Scraper (UPSTREAM SIGNAL)
-------------------------------------------------------------------------------
Source:  NMPA — API Manufacturer Suspension Notices
URL:     https://english.nmpa.gov.cn/

The National Medical Products Administration (NMPA) of China is the regulator
for a country that produces an estimated ~80% of the world's pharmaceutical
APIs. A GMP-certificate revocation, flight-inspection failure, or production
suspension at a Chinese API facility is a leading indicator of downstream
shortages worldwide — often weeks to months ahead of the importing-country
regulators (TGA/FDA/EMA) declaring an actual shortage. This makes NMPA a
high-value UPSTREAM SIGNAL source for the prediction engine.

WHAT THIS SCRAPER MONITORS
==========================
The English portal (english.nmpa.gov.cn) is a static, plain-HTML site hosted on
chinadaily.com.cn infrastructure. We crawl its live index pages (news + drug
notices + homepage), follow each item into its article body, and keyword-scan
title+body for *enforcement* signals (recalls, GMP revocations, production
suspensions, substandard/counterfeit findings, contamination/impurities).
Everything captured is tagged tier-3 / upstream so it never inflates genuine
shortage counts.

KNOWN LIMITATION — read before "fixing" low yield  (verified 2026-06-03)
=======================================================================
The *English* portal lags badly and is overwhelmingly policy/diplomacy news;
it rarely publishes granular API-suspension notices. The real, timely,
structured enforcement data lives on the *Chinese* portal (www.nmpa.gov.cn):
  • 飞行检查  (flight / for-cause inspections)  /xxgk/fxjzh/index.html
  • 公告通告  (announcements & notices)         /xxgk/ggtg/index.html
  • 收回药品GMP证书 (GMP certificate revocations)
…but www.nmpa.gov.cn sits behind a JavaScript anti-bot WAF (the `_$dp()` /
`$_ts` challenge — the served <body> is empty until JS runs and sets a cookie).
It is therefore NOT scrapable with this project's httpx + BeautifulSoup stack;
capturing it would require a headless browser (Playwright/Selenium) plus
Chinese-language keyword + drug-name handling. That is the recommended upgrade
to turn this from a low-yield English monitor into a high-yield signal feed.
Tracked as a follow-up — do not silently broaden keywords to "find something"
on the English side, as that just captures policy noise.

Data source UUID:  10000000-0000-0000-0000-000000000053
Country:           China
Country code:      CN
Confidence:        65/100 (English portal lags the Chinese original)
Source tier:       3 (upstream signal, not a direct shortage declaration)

Cron:  Daily (a news monitor; cheap and the source updates irregularly)
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError
from backend.utils.reason_mapper import map_reason_category


class ChinaNMPAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000053"
    SOURCE_NAME: str  = "NMPA — API Manufacturer Suspension Notices"
    BASE_URL: str     = "https://english.nmpa.gov.cn/"
    COUNTRY: str      = "China"
    COUNTRY_CODE: str = "CN"

    RATE_LIMIT_DELAY: float = 2.5   # Be polite to gov servers
    REQUEST_TIMEOUT: float  = 45.0
    SCRAPER_VERSION: str    = "2.0.0"

    # Live English-portal index pages (verified 2026-06-03). Pagination is
    # JS-driven (no static page URLs), so only the latest page of each index is
    # reachable — acceptable for a daily monitor. The old build pointed at a
    # dead 2019 article URL (c_386498.htm) which is why it returned 0 rows.
    NEWS_URLS: list[str] = [
        "https://english.nmpa.gov.cn/news.html",    # general news index
        "https://english.nmpa.gov.cn/drugs.html",   # drug notices & announcements
        "https://english.nmpa.gov.cn/index.html",   # homepage (latest headlines)
    ]

    # Article links look like  2026-06/01/c_1187215.htm  (also .shtml/.html).
    _ARTICLE_HREF_RE = re.compile(r"\d{4}-\d{2}/\d{2}/c_\d+\.s?html?", re.IGNORECASE)
    # Pull the publication date straight out of the href — robust and exact.
    _HREF_DATE_RE    = re.compile(r"(\d{4})-(\d{2})/(\d{2})/c_\d+")
    # "Updated: 2026-01-28" appears in article bodies as a confirmation source.
    _BODY_DATE_RE    = re.compile(r"Updated:\s*(\d{4})-(\d{2})-(\d{2})")

    # Cap how many article bodies we follow per run (the English indexes carry
    # only a handful of real items, so this is a safety bound, not a sampler).
    MAX_ARTICLES: int = 40

    # Perennial nav/about links that match the article href pattern but are not
    # news — skip so we don't waste fetches on them.
    _SKIP_TITLES: set[str] = {
        "our responsibilities", "contact us", "leadership",
        "about nmpa", "home",
    }

    # Enforcement-signal keywords (substring match over title + body, lowercased).
    # Deliberately PRECISE: these are action verbs / findings that indicate a
    # real supply-affecting event, not generic policy/PR. Do NOT add broad terms
    # like "drug safety", "active pharmaceutical ingredient" or "inspection" on
    # their own — the English portal is policy-heavy and they generate noise.
    _RELEVANCE_KEYWORDS: list[str] = [
        "recall",
        "recalled",
        "suspend",            # suspended / suspension / suspend production
        "revoke",
        "revocation",
        "withdrawn from the market",
        "market withdrawal",
        "gmp certificate",
        "gmp violation",
        "halt production",
        "cease production",
        "stop production",
        "production halt",
        "production suspension",
        "manufacturing suspension",
        "substandard",
        "not up to standard",
        "counterfeit",
        "fake drug",
        "fake medicine",
        "contaminat",         # contamination / contaminated
        "impurit",            # impurity / impurities
        "nitrosamine",
        "quality defect",
        "failed inspection",
        "flight inspection",
        "unannounced inspection",
    ]

    # Title markers that identify a POLICY/REGULATION document (not an enforcement
    # event). The English portal publishes long policy announcements whose bodies
    # describe the enforcement regime ("…may suspend production / revoke the GMP
    # certificate / for substandard or counterfeit drugs…") — these match the
    # enforcement keywords but are NOT events. We require the keyword to appear in
    # the TITLE for such documents; a body-only match on a policy title is dropped.
    # NB: "announcement"/"circular" are deliberately NOT here — they're weak and
    # can prefix a genuine notice. The markers below are strong policy-document
    # signals; a title containing any of them is treated as policy regardless of
    # where the enforcement keyword matched.
    _POLICY_TITLE_MARKERS: list[str] = [
        "provisions",
        "measures",
        "regulation",
        "guidance",
        "guideline",
        "procedure",
        "interpretation",
        "policy",
        "supervision and administration",
        "administrative",
        "administration",
        "must read",
        "meets with",
    ]

    # Keyword -> severity mapping for facility-level events
    _SEVERITY_KEYWORDS: dict[str, str] = {
        "suspend":          "high",
        "revoke":           "high",
        "shutdown":         "high",
        "shut down":        "high",
        "cease production": "high",
        "halt production":  "high",
        "stop production":  "high",
        "gmp violation":    "high",
        "counterfeit":      "high",
        "recall":           "medium",
        "quality defect":   "medium",
        "substandard":      "medium",
        "contaminat":       "medium",
        "inspection":       "low",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Crawl the English NMPA index pages, follow each item into its article
        body, and return only enforcement-relevant notices.

        Strategy:
        1. GET each index page; collect article-style links (deduped).
        2. Follow each link into its body; extract text + publication date.
        3. Keyword-scan title+body for enforcement signals; keep matches.
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        # ── 1. Discover candidate article links across all index pages ───────
        candidates: dict[str, dict] = {}   # href -> {title, url, source_page}
        for index_url in self.NEWS_URLS:
            try:
                resp = self._get(index_url)
                soup = BeautifulSoup(resp.text, "html.parser")
                for a in soup.find_all("a", href=self._ARTICLE_HREF_RE):
                    title = a.get_text(strip=True)
                    if not title or len(title) < 5:
                        continue
                    if title.strip().lower() in self._SKIP_TITLES:
                        continue
                    href = self._normalize_url(a.get("href", ""), index_url)
                    if href in candidates:
                        continue
                    candidates[href] = {
                        "title":       title,
                        "url":         href,
                        "source_page": index_url,
                    }
                self.log.info(
                    "Index page scanned",
                    extra={"url": index_url, "running_candidates": len(candidates)},
                )
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch NMPA index page",
                    extra={"url": index_url, "error": str(exc)},
                )

        ordered = list(candidates.values())[: self.MAX_ARTICLES]

        # ── 2. Follow each candidate into its article body ───────────────────
        for rec in ordered:
            body = self._fetch_article_body(rec["url"])
            rec["summary"] = body[:600]
            rec["body"]    = body
            rec["date"]    = (
                self._date_from_href(rec["url"])
                or self._date_from_body(body)
                or ""
            )

        # ── 3. Keyword-filter for enforcement relevance ──────────────────────
        relevant = self._filter_relevant(ordered)

        # Stash for the dry-run reporter / diagnostics.
        self._discovered_count = len(ordered)
        self._discovered_sample = [r["title"] for r in ordered[:10]]

        self.log.info(
            "NMPA fetch complete",
            extra={
                "candidates_discovered": len(ordered),
                "relevant_items":        len(relevant),
            },
        )
        return relevant

    def _fetch_article_body(self, url: str) -> str:
        """GET an article and return its main body text (best-effort, never raises)."""
        from bs4 import BeautifulSoup

        try:
            resp = self._get(url)
            soup = BeautifulSoup(resp.text, "html.parser")
            container = (
                soup.select_one("div.art")
                or soup.select_one("div.main")
                or soup.select_one(".TRS_Editor")
                or soup.select_one(".article")
            )
            if container:
                return container.get_text(" ", strip=True)
            # Fall back to the whole document text — still keyword-scannable.
            return soup.get_text(" ", strip=True)
        except Exception as exc:
            self.log.warning(
                "Failed to fetch NMPA article body",
                extra={"url": url, "error": str(exc)},
            )
            return ""

    def _filter_relevant(self, records: list[dict]) -> list[dict]:
        """
        Keep records that look like genuine enforcement EVENTS.

        Precision rule (the English portal is policy-heavy):
          • policy/regulation documents (title carries a policy marker) are
            ALWAYS dropped — their bodies describe the enforcement regime and
            match keywords without being events; otherwise
          • keep if an enforcement keyword appears in the title or the body.
        """
        relevant: list[dict] = []
        for rec in records:
            title_l = str(rec.get("title", "")).lower()
            body_l  = str(rec.get("body", "")).lower()

            # Policy/regulation documents are always dropped — their bodies
            # describe the enforcement regime and match keywords without being
            # an actual event (applies even if a keyword is in the title, e.g.
            # "Provisions for Drug Recall Administration").
            if any(m in title_l for m in self._POLICY_TITLE_MARKERS):
                continue

            title_hit = any(kw in title_l for kw in self._RELEVANCE_KEYWORDS)
            body_hit  = any(kw in body_l for kw in self._RELEVANCE_KEYWORDS)
            if title_hit or body_hit:
                relevant.append(rec)
        return relevant

    def _date_from_href(self, href: str) -> str:
        """Derive ISO date from a NMPA article href (2026-06/01/c_… -> 2026-06-01)."""
        m = self._HREF_DATE_RE.search(href)
        if not m:
            return ""
        y, mo, d = m.groups()
        return f"{y}-{mo}-{d}"

    def _date_from_body(self, body: str) -> str:
        """Derive ISO date from an 'Updated: YYYY-MM-DD' line in the article body."""
        m = self._BODY_DATE_RE.search(body)
        if not m:
            return ""
        y, mo, d = m.groups()
        return f"{y}-{mo}-{d}"

    @staticmethod
    def _normalize_url(href: str, page_url: str) -> str:
        """Normalize a URL relative to the page it was found on."""
        if href.startswith("http"):
            return href
        if href.startswith("//"):
            return f"https:{href}"
        if href.startswith("/"):
            return f"https://english.nmpa.gov.cn{href}"
        # Relative URL — resolve against the page URL's directory.
        base = page_url.rsplit("/", 1)[0]
        return f"{base}/{href}"

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: list[dict]) -> list[dict]:
        """Normalize NMPA records into standard shortage event dicts."""
        self.log.info(
            "Normalising NMPA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(raw)},
        )

        normalised: list[dict] = []
        skipped = 0
        today = date.today().isoformat()

        for rec in raw:
            try:
                result = self._normalise_record(rec, today)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise NMPA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(raw), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    def _normalise_record(self, rec: dict, today: str) -> dict | None:
        """Convert a single NMPA record to a normalised shortage event dict."""
        title = str(rec.get("title") or "").strip()
        if not title:
            return None

        # Extract drug or ingredient name from the notice title/body.
        generic_name = self._extract_drug_or_ingredient(title, rec.get("summary", ""))
        if not generic_name:
            # Use the cleaned title as a fallback
            generic_name = self._clean_title(title)

        # Sanity guard: only emit when we have a plausible drug/ingredient name.
        # Better to drop a signal than to pollute the drugs table with a
        # sentence-fragment "drug" like "Revokes Gmp Certificate Of A …". (Tier-3
        # signal — missing one is cheaper than fabricating a junk drug record.)
        if not self._looks_like_drug_name(generic_name):
            self.log.info(
                "Skipping NMPA notice — no clean drug/ingredient name extracted",
                extra={"title": title[:140]},
            )
            return None

        # Classify the notice (uses title + body for best signal).
        combined_text = f"{title} {rec.get('body', '') or rec.get('summary', '')}".lower()
        reason, status, severity = self._classify_notice(combined_text)
        reason_category = self._map_reason(combined_text)

        # Parse date
        start_date = self._parse_date(rec.get("date")) or today

        # Build source URL
        source_url = rec.get("url") or self.BASE_URL

        # Build notes
        notes_parts: list[str] = []
        notes_parts.append(f"NMPA notice: {title[:250]}")
        if rec.get("summary"):
            notes_parts.append(f"Summary: {rec['summary'][:300]}")
        notes_parts.append("Upstream signal: Chinese API manufacturing")
        notes = "; ".join(notes_parts)

        return {
            "generic_name":            generic_name.title(),
            "brand_names":             [],
            "status":                  status,
            "severity":                severity,
            "reason":                  reason or None,
            "reason_category":         reason_category,
            "start_date":              start_date,
            "source_url":              source_url,
            "notes":                   notes,
            "source_confidence_score": 65,
            "raw_record":              rec,
            # Upstream signal fields
            "is_upstream_signal":      True,
            "source_tier":             3,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _extract_drug_or_ingredient(self, title: str, summary: str) -> str:
        """
        Extract a drug name or API ingredient name from notice text.

        Looks for patterns like:
            "... suspend production of [drug name] ..."
            "... recall of [drug name] ..."
            "... [drug name] found substandard ..."
            "... [drug name] API manufacturing ..."
        """
        combined = f"{title} {summary}"

        # Pattern: "suspend/recall/halt ... of [DRUG]"
        patterns = [
            # "[DRUG] (API) production/manufacturing suspended/halted/…" — the
            # drug leads the headline; tried first so we don't grab the location
            # from a trailing "… at <place> plant".
            r'\b([A-Z][a-zA-Z\-]{2,})\s+(?:api\s+)?(?:production|manufacturing)\s+(?:suspend|halt|stop|cease|was\s+suspend)',
            r'(?:suspend|revoke|recall|halt|stop|cease)\w*\s+(?:production|manufacturing|distribution)?\s*(?:of\s+)?([A-Z][a-zA-Z\s\-]+?)(?:\s+(?:by|at|from|due|following|after|in)\b)',
            r'(?:suspend|revoke|recall|halt|stop|cease)\w*\s+([A-Z][a-zA-Z\s\-]+?)(?:\s+(?:production|manufacturing|distribution|tablets?|capsules?|injection|api)\b)',
            r'([A-Z][a-zA-Z\s\-]+?)\s+(?:recalled|suspended|withdrawn|banned|halted)',
            r'(?:api|active\s+pharmaceutical\s+ingredient)\s+([A-Z][a-zA-Z\s\-]+)',
            r'(?:substandard|counterfeit|fake)\s+([a-zA-Z][a-zA-Z\-]+)',
            # "… of a Shandong amoxicillin manufacturer/maker/facility/producer"
            r'(?:of|at)\s+(?:a\s+|an\s+|the\s+)?(?:[A-Z][a-z]+\s+)?([a-zA-Z][a-zA-Z\-]+)\s+(?:manufacturer|maker|facility|plant|factory|producer|api\b)',
        ]

        for pattern in patterns:
            match = re.search(pattern, combined, re.IGNORECASE)
            if not match:
                continue
            name = match.group(1).strip()
            # Clean up: remove trailing common words
            name = re.sub(
                r'\s+(?:and|the|a|an|in|at|by|from|for|to|with|has|have|was|were|is|are|being|been)$',
                '',
                name,
                flags=re.IGNORECASE,
            ).strip()
            # Validate each candidate and keep the first that looks like a drug —
            # an earlier pattern can grab a sentence fragment ("GMP certificate
            # of …") while a later, more specific pattern finds the real name.
            if self._looks_like_drug_name(name):
                return name

        return ""

    # Tokens that mark a "name" as a sentence fragment / facility / admin phrase
    # rather than a drug or API ingredient.
    _NON_DRUG_TOKENS: frozenset[str] = frozenset({
        "manufacturer", "maker", "facility", "plant", "factory", "producer",
        "company", "certificate", "gmp", "revoke", "revokes", "revoked",
        "suspend", "suspends", "suspension", "announcement", "provisions",
        "administration", "supervision", "regulation", "update", "notice",
        "agency", "ministry", "department", "national", "products", "medical",
        "inspection", "violation", "training", "program", "meeting", "policy",
        "production", "manufacturing", "distribution", "drug", "drugs",
        "medicine", "medicines", "batch", "batches", "quality", "market",
    })

    def _looks_like_drug_name(self, name: str) -> bool:
        """
        Heuristic: is `name` a plausible drug/ingredient name (not a sentence
        fragment or facility/admin phrase)? Keeps clean extractions like
        "Valsartan" / "Amoxicillin" / "Heparin" and rejects junk like
        "Revokes Gmp Certificate Of A Shandong Amoxicillin Manufacturer".
        """
        if not name or len(name) < 3:
            return False
        words = name.split()
        if len(words) > 4:
            return False
        lowered = {w.strip(",.;:-").lower() for w in words}
        if lowered & self._NON_DRUG_TOKENS:
            return False
        return True

    @staticmethod
    def _clean_title(title: str) -> str:
        """Clean a notice title for use as a fallback drug/event name."""
        # Remove common prefix phrases
        cleaned = re.sub(
            r'^(?:NMPA\s*:?\s*|China\s*:?\s*|Notice\s*:?\s*|Announcement\s*:?\s*)',
            '',
            title,
            flags=re.IGNORECASE,
        ).strip()

        # Limit length
        if len(cleaned) > 100:
            cleaned = cleaned[:100].rsplit(" ", 1)[0]

        return cleaned if len(cleaned) >= 3 else ""

    def _classify_notice(self, text: str) -> tuple[str, str, str]:
        """
        Classify an NMPA notice into reason, status, and severity.

        For facility suspensions and shutdowns, status is "anticipated"
        because the shortage hasn't necessarily materialized yet.

        Returns:
            (reason_text, status, severity)
        """
        # Determine severity from keywords
        severity = "medium"
        for keyword, sev in self._SEVERITY_KEYWORDS.items():
            if keyword in text:
                severity = sev
                break

        # Facility suspension / shutdown -> anticipated shortage
        if any(kw in text for kw in
               ("suspend", "shutdown", "shut down", "cease production",
                "halt production", "stop production", "revoke")):
            return (
                "API manufacturing suspension/shutdown",
                "anticipated",
                "high",
            )

        # GMP violations -> anticipated
        if any(kw in text for kw in ("gmp violation", "gmp certificate")):
            return (
                "GMP violation at manufacturing facility",
                "anticipated",
                "high",
            )

        # Recall -> active
        if "recall" in text:
            return ("Drug recall", "active", severity)

        # Quality issues -> active
        if any(kw in text for kw in
               ("quality defect", "substandard", "not up to standard",
                "contaminat", "impurit", "nitrosamine")):
            return ("Drug quality issue", "active", severity)

        # Counterfeit -> active
        if any(kw in text for kw in ("counterfeit", "fake drug", "fake medicine")):
            return ("Counterfeit drug alert", "active", "high")

        # Generic drug safety notice
        return ("Drug safety notice", "anticipated", severity)

    def _map_reason(self, raw: str) -> str:
        """Map NMPA reason text to canonical reason_category."""
        if not raw:
            return "unknown"
        lower = raw.strip().lower()

        # Facility/manufacturing specific
        if any(kw in lower for kw in
               ("suspend", "shutdown", "shut down", "halt production",
                "cease production", "stop production", "gmp",
                "manufacturing", "facility")):
            return "manufacturing_issue"

        # Quality issues
        if any(kw in lower for kw in
               ("quality", "substandard", "not up to standard", "contaminat",
                "impurit", "nitrosamine")):
            return "manufacturing_issue"

        # Regulatory
        if any(kw in lower for kw in
               ("revoke", "regulatory", "inspection", "violation",
                "warning letter")):
            return "regulatory_action"

        # Supply chain
        if any(kw in lower for kw in ("api", "ingredient", "supply")):
            return "raw_material"

        # Counterfeit
        if any(kw in lower for kw in ("counterfeit", "fake")):
            return "regulatory_action"

        # Recall / withdrawal
        if any(kw in lower for kw in ("recall", "withdrawal", "withdrawn")):
            return "regulatory_action"

        # Fallback to centralized mapper
        return map_reason_category(raw)

    @staticmethod
    def _parse_date(raw: Any) -> str | None:
        """Parse various date formats to ISO-8601 date string."""
        if raw is None:
            return None
        if isinstance(raw, datetime):
            return raw.date().isoformat()
        if isinstance(raw, date):
            return raw.isoformat()
        raw_str = str(raw).strip()
        if not raw_str or raw_str in ("-", "N/A", "null", "None"):
            return None
        try:
            from dateutil import parser as dtparser
            dt = dtparser.parse(raw_str)
            return dt.date().isoformat()
        except (ValueError, ImportError):
            pass
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
        print("Fetches live NMPA data but makes NO database writes.")
        print("Set MEDERTI_DRY_RUN=0 to run against Supabase.")
        print("=" * 60)

        scraper = ChinaNMPAScraper(db_client=MagicMock())

        print("\n-- Fetching from NMPA ...")
        raw = scraper.fetch()
        discovered = getattr(scraper, "_discovered_count", None)
        if discovered is not None:
            print(f"-- Candidate articles discovered : {discovered}")
            for t in getattr(scraper, "_discovered_sample", []):
                print(f"     • {t[:90]}")
        print(f"-- Enforcement-relevant records  : {len(raw)}")

        if not raw:
            print(
                "\n-- NOTE: 0 enforcement notices on the English portal right now.\n"
                "   This is EXPECTED — the English portal is policy/diplomacy news\n"
                "   and rarely carries granular API-suspension/GMP notices. The\n"
                "   parser is wired correctly (see discovered count above) and will\n"
                "   capture enforcement items when they appear. The timely, complete\n"
                "   signal lives on the WAF-protected Chinese portal — see the module\n"
                "   docstring for the headless-browser follow-up."
            )

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

            # Show upstream signal fields
            upstream_count = sum(1 for e in events if e.get("is_upstream_signal"))
            print(f"\n-- Upstream signals: {upstream_count}/{len(events)}")
            tier_counts = Counter(e.get("source_tier") for e in events)
            print("-- Source tier breakdown:")
            for k, v in sorted(tier_counts.items()):
                print(f"   Tier {k}: {v}")

        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    # -- Live run --
    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = ChinaNMPAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
