"""
NMPA China API Manufacturer Suspension Notices Scraper (UPSTREAM SIGNAL)
------------------------------------------------------------------------
Source:  NMPA — API Manufacturer Suspension Notices
URL:     https://english.nmpa.gov.cn/

The National Medical Products Administration (NMPA) of China publishes
drug safety news and notices on their English-language portal. This scraper
monitors for notices about API (Active Pharmaceutical Ingredient)
manufacturing suspensions, facility shutdowns, or drug quality issues.

China is the world's largest producer of pharmaceutical APIs. Suspension of
a Chinese API manufacturing facility can cascade into shortages globally
within weeks to months. This makes NMPA a critical upstream signal source.

This is an UPSTREAM SIGNAL scraper: facility suspensions and quality
findings at Chinese API manufacturers are leading indicators of future
shortages in downstream markets worldwide.

Data source UUID:  10000000-0000-0000-0000-000000000053
Country:           China
Country code:      CN
Confidence:        65/100 (English portal may lag behind Chinese-language original)
Source tier:       3 (upstream signal, not a direct shortage declaration)

Cron:  Every 24 hours
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

    RATE_LIMIT_DELAY: float = 3.0   # Be polite to Chinese gov servers
    REQUEST_TIMEOUT: float  = 60.0
    SCRAPER_VERSION: str    = "1.0.0"

    # NMPA English portal URLs for drug safety news
    NEWS_URLS: list[str] = [
        "https://english.nmpa.gov.cn/2019-09/25/c_386498.htm",  # Drug safety news index
        "https://english.nmpa.gov.cn/news.html",
        "https://english.nmpa.gov.cn/",
    ]

    # Keywords that indicate relevant notices for upstream signals
    _RELEVANCE_KEYWORDS: list[str] = [
        "suspend",
        "suspension",
        "revoke",
        "revocation",
        "recall",
        "withdrawal",
        "shutdown",
        "shut down",
        "cease production",
        "halt production",
        "stop production",
        "gmp violation",
        "gmp certificate",
        "quality issue",
        "quality problem",
        "not standard",
        "substandard",
        "counterfeit",
        "fake drug",
        "api manufacturer",
        "active pharmaceutical ingredient",
        "drug safety",
        "pharmaceutical production",
        "manufacturing violation",
        "facility inspection",
        "warning letter",
        "import alert",
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
        "quality issue":    "medium",
        "warning letter":   "medium",
        "substandard":      "medium",
        "inspection":       "low",
    }

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> list[dict]:
        """
        Fetch NMPA drug safety news from the English portal.

        Strategy:
        1. GET the English news/safety pages.
        2. Parse HTML for news items and notices.
        3. Filter for drug safety / API manufacturing related notices.
        4. Follow links to individual notices for detail extraction.
        """
        from bs4 import BeautifulSoup

        self.log.info("Scrape started", extra={
            "source": self.SOURCE_NAME,
            "url": self.BASE_URL,
        })

        all_records: list[dict] = []
        seen_urls: set[str] = set()

        for news_url in self.NEWS_URLS:
            try:
                resp = self._get(news_url)
                soup = BeautifulSoup(resp.text, "html.parser")
                records = self._extract_news_items(soup, news_url, seen_urls)
                all_records.extend(records)
                self.log.info(
                    "Extracted news items from page",
                    extra={"url": news_url, "items": len(records)},
                )
            except Exception as exc:
                self.log.warning(
                    "Failed to fetch NMPA news page",
                    extra={"url": news_url, "error": str(exc)},
                )

        # Filter for relevant notices only
        relevant = self._filter_relevant(all_records)

        self.log.info(
            "NMPA fetch complete",
            extra={
                "total_items": len(all_records),
                "relevant_items": len(relevant),
            },
        )
        return relevant

    def _extract_news_items(
        self, soup, page_url: str, seen_urls: set[str]
    ) -> list[dict]:
        """Extract news items from a parsed NMPA page."""
        records: list[dict] = []

        # NMPA English portal uses various list structures for news
        # Try multiple selectors
        containers = (
            soup.select(".list_con li")           # Common NMPA list pattern
            or soup.select(".news_list li")        # Alternative news list
            or soup.select(".content_list li")     # Content listing
            or soup.select("ul.list li")           # Generic list
            or soup.select("article")              # Article elements
            or soup.select(".main-content li")     # Main content area
        )

        for container in containers:
            record = self._parse_news_item(container, page_url, seen_urls)
            if record:
                records.append(record)

        # Also try direct link extraction if no structured containers found
        if not records:
            records = self._extract_from_all_links(soup, page_url, seen_urls)

        return records

    def _parse_news_item(
        self, container, page_url: str, seen_urls: set[str]
    ) -> dict | None:
        """Parse a single news item container."""
        # Find the link
        link_el = container.select_one("a[href]")
        if not link_el:
            return None

        title = link_el.get_text(strip=True)
        if not title or len(title) < 5:
            return None

        href = link_el.get("href", "")
        href = self._normalize_url(href, page_url)

        if href in seen_urls:
            return None
        seen_urls.add(href)

        # Extract date
        date_el = (
            container.select_one(".date")
            or container.select_one("span.time")
            or container.select_one("time")
            or container.select_one(".news_date")
        )
        date_text = ""
        if date_el:
            date_text = date_el.get_text(strip=True)
            if date_el.name == "time" and date_el.get("datetime"):
                date_text = date_el["datetime"]

        # If no separate date element, try to extract date from title
        if not date_text:
            date_match = re.search(r'(\d{4}[-/]\d{2}[-/]\d{2})', title)
            if date_match:
                date_text = date_match.group(1)

        # Extract summary/description
        summary_el = (
            container.select_one("p")
            or container.select_one(".desc")
            or container.select_one(".summary")
        )
        summary = summary_el.get_text(strip=True) if summary_el else ""

        return {
            "title": title,
            "url": href,
            "date": date_text,
            "summary": summary,
            "source_page": page_url,
        }

    def _extract_from_all_links(
        self, soup, page_url: str, seen_urls: set[str]
    ) -> list[dict]:
        """Fallback: extract relevant items from all page links."""
        records: list[dict] = []

        for link in soup.select("a[href]"):
            title = link.get_text(strip=True)
            if not title or len(title) < 10:
                continue

            href = link.get("href", "")
            href = self._normalize_url(href, page_url)

            if href in seen_urls:
                continue

            # Only include links that look like news/notice pages
            if not any(ext in href for ext in (".htm", ".html", ".shtml")):
                continue

            seen_urls.add(href)

            records.append({
                "title": title,
                "url": href,
                "date": "",
                "summary": "",
                "source_page": page_url,
            })

        return records

    def _filter_relevant(self, records: list[dict]) -> list[dict]:
        """Filter records to keep only those relevant to drug safety / API manufacturing."""
        relevant: list[dict] = []
        for rec in records:
            combined = f"{rec.get('title', '')} {rec.get('summary', '')}".lower()
            if any(kw in combined for kw in self._RELEVANCE_KEYWORDS):
                relevant.append(rec)
        return relevant

    @staticmethod
    def _normalize_url(href: str, page_url: str) -> str:
        """Normalize a URL relative to the page it was found on."""
        if href.startswith("http"):
            return href
        if href.startswith("//"):
            return f"https:{href}"
        if href.startswith("/"):
            return f"https://english.nmpa.gov.cn{href}"
        # Relative URL — resolve against the page URL
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

        # Extract drug or ingredient name from the notice title
        generic_name = self._extract_drug_or_ingredient(title, rec.get("summary", ""))
        if not generic_name:
            # Use the cleaned title as a fallback
            generic_name = self._clean_title(title)

        if not generic_name or len(generic_name) < 3:
            return None

        # Classify the notice
        combined_text = f"{title} {rec.get('summary', '')}".lower()
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
            r'(?:suspend|revoke|recall|halt|stop|cease)\w*\s+(?:production|manufacturing|distribution)?\s*(?:of\s+)?([A-Z][a-zA-Z\s\-]+?)(?:\s+(?:by|at|from|due|following|after|in)\b)',
            r'(?:suspend|revoke|recall|halt|stop|cease)\w*\s+([A-Z][a-zA-Z\s\-]+?)(?:\s+(?:production|manufacturing|distribution|tablets?|capsules?|injection|api)\b)',
            r'([A-Z][a-zA-Z\s\-]+?)\s+(?:recalled|suspended|withdrawn|banned|halted)',
            r'(?:api|active\s+pharmaceutical\s+ingredient)\s+([A-Z][a-zA-Z\s\-]+)',
            r'(?:substandard|counterfeit|fake)\s+([A-Z][a-zA-Z\s\-]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, combined, re.IGNORECASE)
            if match:
                name = match.group(1).strip()
                # Clean up: remove trailing common words
                name = re.sub(
                    r'\s+(?:and|the|a|an|in|at|by|from|for|to|with|has|have|was|were|is|are|being|been)$',
                    '',
                    name,
                    flags=re.IGNORECASE,
                ).strip()
                if name and len(name) >= 3 and len(name) <= 100:
                    return name

        return ""

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
               ("quality issue", "quality problem", "substandard", "not standard")):
            return ("Drug quality issue", "active", severity)

        # Counterfeit -> active
        if any(kw in text for kw in ("counterfeit", "fake drug")):
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
               ("quality", "substandard", "not standard", "contamination")):
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
        print(f"-- Raw records received : {len(raw)}")

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
