#!/usr/bin/env python3
"""Add industry pharma-news / trade-press sources to intelligence_sources.

These are weak-signal "early warning" news outlets (and one financial-markets
aggregator) supplied to broaden Mederti's macro intelligence catalog. They are
secondary press — useful for surfacing plant issues, M&A, recalls and policy
shifts early, but always to be confirmed against primary regulator sources.

Idempotent: upserts on source_id, so re-running is safe.

Usage:
    python3 backend/importers/industry_news_press_sources.py --dry-run
    python3 backend/importers/industry_news_press_sources.py --only fierce_pharma_news
    python3 backend/importers/industry_news_press_sources.py        # full batch
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

ROWS = [
    {
        "source_id": "fierce_pharma_news",
        "name": "Fierce Pharma",
        "owner_org": "Questex LLC",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Global (US/EU focus)",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://www.fiercepharma.com/ (RSS feeds published per section)",
        "docs_entrypoint": "https://www.fiercepharma.com/",
        "formats": "HTML; RSS",
        "update_frequency_expected": "daily",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "medium",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Manufacturing, M&A, recalls and commercial pharma news. Weak-signal early warning for plant issues and supply disruption; confirm against primary regulator sources.",
    },
    {
        "source_id": "reuters_healthcare_pharma",
        "name": "Reuters Healthcare & Pharmaceuticals",
        "owner_org": "Thomson Reuters",
        "category": "early_warning",
        "subcategory": "news_wire",
        "geography_coverage": "Global",
        "access_method": "web",
        "auth": "none (some content metered)",
        "raw_data_entrypoints": "https://www.reuters.com/business/healthcare-pharmaceuticals/",
        "docs_entrypoint": "https://www.reuters.com/business/healthcare-pharmaceuticals/",
        "formats": "HTML",
        "update_frequency_expected": "continuous",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "medium",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Global newswire coverage of pharma supply, regulation and corporate events. High reliability; no clean public RSS, scrape/section-watch.",
    },
    {
        "source_id": "pharmainfocus_au_news",
        "name": "Pharma in Focus (Australia)",
        "owner_org": "Pharma in Focus Pty Ltd",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Australia",
        "access_method": "web",
        "auth": "none (some content subscriber-only)",
        "raw_data_entrypoints": "https://pharmainfocus.com.au/",
        "docs_entrypoint": "https://pharmainfocus.com.au/",
        "formats": "HTML",
        "update_frequency_expected": "weekly",
        "recommended_poll_frequency": "weekly",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Australian pharma industry/policy news; complements TGA primary data for AU shortage context.",
    },
    {
        "source_id": "biopharma_dive_news",
        "name": "BioPharma Dive",
        "owner_org": "Industry Dive (Informa)",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Global (US focus)",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://www.biopharmadive.com/ (RSS available at /feeds/)",
        "docs_entrypoint": "https://www.biopharmadive.com/",
        "formats": "HTML; RSS",
        "update_frequency_expected": "daily",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "medium",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Biopharma manufacturing, pipeline and regulatory news. Useful early signal on capacity and approvals; confirm specifics with primary sources.",
    },
    {
        "source_id": "pharmatimes_news",
        "name": "PharmaTimes",
        "owner_org": "PharmaTimes Media Ltd",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Global (UK/EU focus)",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://pharmatimes.com/ (RSS published per section)",
        "docs_entrypoint": "https://pharmatimes.com/",
        "formats": "HTML; RSS",
        "update_frequency_expected": "daily",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "UK/EU-leaning pharma industry and policy news; supports EU/UK shortage and regulatory context.",
    },
    {
        "source_id": "drugs_com_pharma_news",
        "name": "Drugs.com Pharma News",
        "owner_org": "Drugsite Trust",
        "category": "early_warning",
        "subcategory": "consumer_health_news",
        "geography_coverage": "Global (US focus)",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://www.drugs.com/pharmanews.html (RSS available)",
        "docs_entrypoint": "https://www.drugs.com/pharmanews.html",
        "formats": "HTML; RSS",
        "update_frequency_expected": "daily",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Aggregated pharma/health news and FDA approvals for a consumer audience; secondary source, confirm against FDA primary data.",
    },
    {
        "source_id": "yahoo_finance_drug_manufacturers",
        "name": "Yahoo Finance — Drug Manufacturers (General)",
        "owner_org": "Yahoo (Apollo Global / Verizon)",
        "category": "macro",
        "subcategory": "financial_markets_press",
        "geography_coverage": "Global (listed drug manufacturers)",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://finance.yahoo.com/sectors/healthcare/drug-manufacturers-general/",
        "docs_entrypoint": "https://finance.yahoo.com/sectors/healthcare/drug-manufacturers-general/",
        "formats": "HTML",
        "update_frequency_expected": "continuous (market hours)",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Equity/sector view of listed drug manufacturers — earnings, guidance and market reaction. Maps corporate stress to potential supply risk; not a primary supply source.",
    },
    {
        "source_id": "endpoints_news",
        "name": "Endpoints News",
        "owner_org": "Endpoints Company",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Global (US/EU biopharma focus)",
        "access_method": "web",
        "auth": "none (some content subscriber-only)",
        "raw_data_entrypoints": "https://endpoints.news/ (RSS published per channel)",
        "docs_entrypoint": "https://endpoints.news/",
        "formats": "HTML; RSS",
        "update_frequency_expected": "daily",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "medium",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Biopharma R&D, manufacturing, dealmaking and regulatory news. Strong early signal on capacity, approvals and corporate stress; confirm specifics with primary sources.",
    },
    {
        "source_id": "mednews_au",
        "name": "MedNews (Australia)",
        "owner_org": "MedNews",
        "category": "early_warning",
        "subcategory": "trade_press",
        "geography_coverage": "Australia",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://mednews.com.au/",
        "docs_entrypoint": "https://mednews.com.au/",
        "formats": "HTML",
        "update_frequency_expected": "weekly",
        "recommended_poll_frequency": "weekly",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "Australian medical/pharma industry news; complements TGA primary data for AU shortage and policy context.",
    },
    {
        "source_id": "abc_news_au_pharma_industry",
        "name": "ABC News (Australia) — Pharmaceutical Industry topic",
        "owner_org": "Australian Broadcasting Corporation",
        "category": "early_warning",
        "subcategory": "national_press",
        "geography_coverage": "Australia",
        "access_method": "web",
        "auth": "none",
        "raw_data_entrypoints": "https://www.abc.net.au/news/topic/pharmaceutical-industry (topic RSS available)",
        "docs_entrypoint": "https://www.abc.net.au/news/topic/pharmaceutical-industry",
        "formats": "HTML; RSS",
        "update_frequency_expected": "as published",
        "recommended_poll_frequency": "daily",
        "priority_for_daily_monitoring": "low",
        "is_medicines_regulator": False,
        "is_government_or_igo": False,
        "notes": "National public-broadcaster coverage of the AU pharmaceutical industry — supply, pricing (PBS) and policy. Good for public-interest framing; confirm regulatory specifics with TGA.",
    },
]


def _req(method, path, payload=None, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def upsert(rows):
    return _req(
        "POST",
        "intelligence_sources?on_conflict=source_id",
        rows,
        {"Prefer": "resolution=merge-duplicates,return=representation"},
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="upsert a single source_id")
    args = ap.parse_args()

    if not SUPABASE_URL or not SERVICE_KEY:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (source .env)")

    rows = ROWS
    if args.only:
        rows = [r for r in ROWS if r["source_id"] == args.only]
        if not rows:
            sys.exit(f"no row with source_id={args.only}")

    if args.dry_run:
        print(f"DRY RUN — would upsert {len(rows)} row(s):")
        for r in rows:
            print(f"  - {r['source_id']:38s} [{r['category']}/{r['subcategory']}] {r['name']}")
        return

    status, resp = upsert(rows)
    if status not in (200, 201):
        sys.exit(f"upsert failed ({status}): {resp}")
    n = len(resp) if isinstance(resp, list) else "?"
    print(f"OK — upserted {n} row(s):")
    for r in (resp or []):
        print(f"  - {r['source_id']}")


if __name__ == "__main__":
    main()
