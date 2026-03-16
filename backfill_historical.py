#!/usr/bin/env python3
"""
backfill_historical.py — Historical backfill for shortage data.

Pulls historical shortage records from FDA, Health Canada, and/or TGA.
Uses the same MD5 dedup key as existing scrapers — won't create duplicates.
Logs to raw_scrapes with source='historical_backfill' for traceability.

Usage:
    # Run all 3 sources (default cutoff 2024-03-01)
    python backfill_historical.py

    # Deep FDA backfill from 2005 with checkpoint/resume
    python backfill_historical.py --source fda --from 2005-01-01

    # Resume an interrupted deep backfill (auto-detects checkpoint)
    python backfill_historical.py --source fda --from 2005-01-01
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import sys
import time
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dateutil import parser as dtparser
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

CUTOFF_DATE = "2024-03-01"  # default — overridden by --from

FDA_SOURCE_ID = "10000000-0000-0000-0000-000000000001"
HC_SOURCE_ID  = "10000000-0000-0000-0000-000000000002"
TGA_SOURCE_ID = "10000000-0000-0000-0000-000000000003"

FDA_API_URL   = "https://api.fda.gov/drug/shortages.json"
HC_EXPORT_URL = "https://healthproductshortages.ca/search/export"
TGA_URL       = "https://apps.tga.gov.au/Prod/msi/search"

BACKFILL_VERSION = "backfill-1.1.0"
RATE_LIMIT_DELAY = 1.5  # seconds between HTTP requests (default)
DEEP_RATE_DELAY  = 1.0  # seconds for deep backfill (polite but faster)

# Checkpoint files for deep backfill
CHECKPOINT_FILE  = Path("fda_backfill_checkpoint.json")
FETCH_DATA_FILE  = Path("fda_backfill_data.json")

HEADERS = {
    "User-Agent": "Mederti-Scraper/1.0 (+https://mederti.com/bot; monitoring pharmaceutical shortages globally)",
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Cache-Control": "no-cache",
}

# In-memory cache: normalised_name -> drug_id
_drug_cache: dict[str, str] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Checkpoint helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_checkpoint() -> dict | None:
    """Load existing checkpoint if it exists and matches current cutoff."""
    if not CHECKPOINT_FILE.exists():
        return None
    try:
        with open(CHECKPOINT_FILE) as f:
            cp = json.load(f)
        if cp.get("cutoff_date") != CUTOFF_DATE:
            print(f"  Checkpoint cutoff ({cp.get('cutoff_date')}) != current ({CUTOFF_DATE}) — starting fresh.")
            clear_checkpoint()
            return None
        return cp
    except (json.JSONDecodeError, OSError):
        return None


def save_checkpoint(cp: dict) -> None:
    """Atomically write checkpoint to disk."""
    cp["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = CHECKPOINT_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(cp, f, indent=2)
    tmp.replace(CHECKPOINT_FILE)


def clear_checkpoint() -> None:
    """Remove checkpoint and data files."""
    for f in (CHECKPOINT_FILE, FETCH_DATA_FILE):
        try:
            f.unlink(missing_ok=True)
        except OSError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Utility functions
# ─────────────────────────────────────────────────────────────────────────────

def compute_shortage_id(drug_id: str, source_id: str, country_code: str, start_date: str) -> str:
    """MD5(drug_id|source_id|country_code|start_date) — matches BaseScraper + Postgres trigger."""
    raw = f"{drug_id}|{source_id}|{country_code}|{start_date}"
    return hashlib.md5(raw.encode()).hexdigest()


def find_or_create_drug(db: Any, generic_name: str, brand_names: list[str] | None, source_label: str) -> str | None:
    """3-tier drug lookup: exact → prefix → auto-create. Cached."""
    normalised = generic_name.strip().lower()
    if not normalised:
        return None

    if normalised in _drug_cache:
        return _drug_cache[normalised]

    # 1. Exact match
    result = db.table("drugs").select("id").eq("generic_name_normalised", normalised).limit(1).execute()
    if result.data:
        _drug_cache[normalised] = result.data[0]["id"]
        return result.data[0]["id"]

    # 2. Prefix match (first word, 4+ chars)
    first_word = normalised.split()[0].rstrip(";,")
    if len(first_word) >= 4:
        result = db.table("drugs").select("id, generic_name").ilike("generic_name_normalised", f"{first_word}%").limit(5).execute()
        if result.data:
            drug_id = result.data[0]["id"]
            _drug_cache[normalised] = drug_id
            return drug_id

    # 3. Auto-create
    insert_result = db.table("drugs").insert({
        "generic_name": generic_name.strip().title(),
        "brand_names": brand_names or [],
        "therapeutic_category": f"Auto-created by {source_label} backfill",
    }).execute()
    new_id = insert_result.data[0]["id"]
    _drug_cache[normalised] = new_id
    print(f"    [new drug] {generic_name.strip().title()}")
    return new_id


def log_raw_scrape(db: Any, source_id: str, source_label: str, total_fetched: int, backfill_tag: str = "historical_backfill") -> str:
    """Create a raw_scrapes entry for tracking this backfill run."""
    result = db.table("raw_scrapes").insert({
        "data_source_id": source_id,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "raw_data": {
            "source": backfill_tag,
            "label": source_label,
            "cutoff_date": CUTOFF_DATE,
            "total_fetched": total_fetched,
        },
        "content_hash": hashlib.md5(f"backfill-{source_label}-{datetime.now().isoformat()}".encode()).hexdigest(),
        "status": "processing",
        "scraper_version": BACKFILL_VERSION,
        "processing_started_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return result.data[0]["id"]


def update_raw_scrape(db: Any, scrape_id: str, status: str, found: int, processed: int, error: str | None = None) -> None:
    """Update the raw_scrapes entry with final status."""
    patch: dict[str, Any] = {
        "status": status,
        "processing_completed_at": datetime.now(timezone.utc).isoformat(),
        "records_found": found,
        "records_processed": processed,
    }
    if error:
        patch["error_message"] = error[:2000]
    db.table("raw_scrapes").update(patch).eq("id", scrape_id).execute()


def upsert_shortage_batch(
    db: Any,
    events: list[dict],
    source_id: str,
    country: str,
    country_code: str,
    source_label: str,
    *,
    start_index: int = 0,
    running_counts: dict[str, int] | None = None,
    checkpoint_fn: Any = None,
) -> dict[str, int]:
    """Upsert normalized events into shortage_events.

    Supports resuming from start_index with running_counts, and saves
    checkpoint via checkpoint_fn(index, counts) every 50 records.
    Returns {new, updated, skipped}.
    """
    counts = dict(running_counts) if running_counts else {"new": 0, "updated": 0, "skipped": 0}
    total = len(events)

    if start_index > 0:
        print(f"    Resuming upsert from record {start_index:,}/{total:,}")

    for i in range(start_index, total):
        ev = events[i]
        try:
            drug_id = find_or_create_drug(db, ev.get("generic_name", ""), ev.get("brand_names"), source_label)
            if not drug_id:
                counts["skipped"] += 1
                continue

            start_date = ev.get("start_date") or date.today().isoformat()
            shortage_id = compute_shortage_id(drug_id, source_id, country_code, start_date)

            # Pre-check existence
            existing_resp = db.table("shortage_events").select("id, status, severity").eq("shortage_id", shortage_id).limit(1).execute()
            is_new = not existing_resp.data

            status = ev.get("status", "active")
            end_date = ev.get("end_date")
            if status == "resolved" and not end_date:
                end_date = date.today().isoformat()

            record = {
                "shortage_id": shortage_id,
                "drug_id": drug_id,
                "data_source_id": source_id,
                "country": country,
                "country_code": country_code,
                "status": status,
                "severity": ev.get("severity"),
                "reason": ev.get("reason"),
                "reason_category": ev.get("reason_category"),
                "start_date": start_date,
                "end_date": end_date,
                "estimated_resolution_date": ev.get("estimated_resolution_date"),
                "last_verified_at": datetime.now(timezone.utc).isoformat(),
                "source_url": ev.get("source_url"),
                "raw_data": ev.get("raw_record", {}),
                "notes": ev.get("notes"),
            }

            db.table("shortage_events").upsert(record, on_conflict="shortage_id").execute()

            if is_new:
                counts["new"] += 1
            else:
                counts["updated"] += 1

        except Exception as exc:
            counts["skipped"] += 1
            if counts["skipped"] <= 10:
                print(f"    [error] {ev.get('generic_name', '?')}: {exc}")

        processed = i + 1

        # Checkpoint every 50 records
        if checkpoint_fn and processed % 50 == 0:
            checkpoint_fn(processed, counts)

        # Progress every 100 records
        if processed % 100 == 0 or processed == total:
            print(f"    Processed {processed:,}/{total:,} — {counts['new']:,} new, {counts['updated']:,} updated, {counts['skipped']} skipped")

    return counts


# ─────────────────────────────────────────────────────────────────────────────
# FDA
# ─────────────────────────────────────────────────────────────────────────────

# Status / reason / severity maps (replicated from fda_scraper.py)
_FDA_STATUS_MAP = {
    "Current": "active",
    "To Be Discontinued": "active",
    "Resolved": "resolved",
}

_FDA_REASON_MAP = {
    "Manufacturing Delays": "manufacturing_issue",
    "Manufacturing delays": "manufacturing_issue",
    "Quality Issues": "manufacturing_issue",
    "Demand Increase": "demand_surge",
    "Increased Demand": "demand_surge",
    "Raw Material Supply": "raw_material",
    "Raw Materials": "raw_material",
    "Supply Chain Issues": "supply_chain",
    "Supply Chain": "supply_chain",
    "Discontinuation": "discontinuation",
    "Business Decision": "discontinuation",
    "Regulatory Action": "regulatory_action",
    "Other": "unknown",
}

_FDA_CRITICAL_KEYWORDS = [
    "insulin", "epinephrine", "adrenaline", "vasopressin", "norepinephrine",
    "dopamine", "atropine", "adenosine", "sodium bicarbonate",
    "calcium gluconate", "potassium chloride", "dextrose", "naloxone",
    "morphine", "fentanyl", "propofol", "midazolam", "vecuronium",
    "succinylcholine", "rocuronium", "nitroglycerin",
]
_FDA_HIGH_KEYWORDS = [
    "injection", "infusion", "intravenous", "parenteral",
    "antibiotic", "antifungal", "chemotherapy", "oncology",
    "heparin", "warfarin", "enoxaparin",
    "amphotericin", "vancomycin", "meropenem", "piperacillin",
]


def _fda_clean_generic_name(name: str, dosage_form: str) -> str:
    if not dosage_form:
        return name.strip()
    lower_name = name.lower()
    lower_suffix = dosage_form.strip().lower()
    if lower_name.endswith(lower_suffix):
        cleaned = name[: -len(dosage_form.strip())].rstrip(" ,").strip()
        if cleaned:
            return cleaned
    return name.strip()


def _fda_parse_date(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    try:
        dt = dtparser.parse(raw.strip(), dayfirst=False)
        return dt.date().isoformat()
    except (ValueError, OverflowError):
        return None


def _fda_infer_severity(status: str, availability: str, generic_name: str, raw_generic: str) -> str:
    if status == "resolved":
        return "low"
    combined = f"{generic_name} {raw_generic}".lower()
    if any(kw in combined for kw in _FDA_CRITICAL_KEYWORDS):
        return "critical"
    avail_lower = availability.lower()
    if "unavailable" in avail_lower:
        if any(kw in combined for kw in _FDA_HIGH_KEYWORDS):
            return "critical"
        return "high"
    if "limited" in avail_lower:
        if any(kw in combined for kw in _FDA_HIGH_KEYWORDS):
            return "high"
        return "medium"
    return "medium"


def fetch_fda(rate_delay: float = RATE_LIMIT_DELAY) -> list[dict]:
    """Paginate through the openFDA drug shortages endpoint (simple, no checkpoint)."""
    api_key = os.environ.get("FDA_API_KEY", "").strip()
    all_records: list[dict] = []
    skip = 0
    total: int | None = None
    last_req = 0.0

    while True:
        elapsed = time.monotonic() - last_req
        if elapsed < rate_delay:
            time.sleep(rate_delay - elapsed)
        last_req = time.monotonic()

        params: dict[str, Any] = {"limit": 100, "skip": skip}
        if api_key:
            params["api_key"] = api_key

        resp = httpx.get(FDA_API_URL, params=params, headers=HEADERS, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()

        if total is None:
            total = data["meta"]["results"]["total"]
            pages = math.ceil(total / 100)
            print(f"  FDA API: {total:,} total records, {pages} pages")

        batch = data.get("results", [])
        all_records.extend(batch)
        skip += 100
        if skip >= total or not batch:
            break

    return all_records


def fetch_fda_with_checkpoint(rate_delay: float = DEEP_RATE_DELAY) -> list[dict]:
    """Paginate FDA API with checkpoint/resume for deep backfills.

    Saves fetched records to FETCH_DATA_FILE and tracks page progress
    in the checkpoint so a crash mid-fetch can resume.
    """
    cp = load_checkpoint()

    # If fetch already completed in a previous run, just load the data
    if cp and cp.get("fetch_complete"):
        if FETCH_DATA_FILE.exists():
            print(f"  Fetch already complete (checkpoint). Loading {FETCH_DATA_FILE} ...")
            with open(FETCH_DATA_FILE) as f:
                records = json.load(f)
            print(f"  Loaded {len(records):,} records from cache.")
            return records
        else:
            # Data file missing but checkpoint says complete — re-fetch
            print("  Checkpoint says fetch complete but data file missing — re-fetching.")
            cp = None

    # Resume or start fresh
    if cp and not cp.get("fetch_complete"):
        skip = cp.get("fetch_skip", 0)
        fetch_total = cp.get("fetch_total")
        # Load partially fetched data
        if FETCH_DATA_FILE.exists():
            with open(FETCH_DATA_FILE) as f:
                all_records = json.load(f)
            print(f"  Resuming fetch from skip={skip:,} ({len(all_records):,} records cached)")
        else:
            all_records = []
            skip = 0
    else:
        skip = 0
        fetch_total = None
        all_records = []
        cp = {
            "cutoff_date": CUTOFF_DATE,
            "phase": "fetch",
            "fetch_skip": 0,
            "fetch_total": None,
            "fetch_complete": False,
            "upsert_index": 0,
            "counts": {"new": 0, "updated": 0, "skipped": 0},
        }

    api_key = os.environ.get("FDA_API_KEY", "").strip()
    last_req = 0.0
    pages_this_run = 0

    while True:
        elapsed = time.monotonic() - last_req
        if elapsed < rate_delay:
            time.sleep(rate_delay - elapsed)
        last_req = time.monotonic()

        params: dict[str, Any] = {"limit": 100, "skip": skip}
        if api_key:
            params["api_key"] = api_key

        try:
            resp = httpx.get(FDA_API_URL, params=params, headers=HEADERS, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"  [fetch error at skip={skip}] {exc} — saving checkpoint and retrying in 5s...")
            save_checkpoint(cp)
            with open(FETCH_DATA_FILE, "w") as f:
                json.dump(all_records, f)
            time.sleep(5)
            continue

        if fetch_total is None:
            fetch_total = data["meta"]["results"]["total"]
            cp["fetch_total"] = fetch_total
            pages = math.ceil(fetch_total / 100)
            print(f"  FDA API: {fetch_total:,} total records, {pages} pages")

        batch = data.get("results", [])
        all_records.extend(batch)
        skip += 100
        pages_this_run += 1
        cp["fetch_skip"] = skip

        # Save to disk every 5 pages (~500 records)
        if pages_this_run % 5 == 0:
            with open(FETCH_DATA_FILE, "w") as f:
                json.dump(all_records, f)
            save_checkpoint(cp)
            page_num = skip // 100
            total_pages = math.ceil(fetch_total / 100)
            print(f"    Fetched page {page_num}/{total_pages} ({len(all_records):,} records so far)")

        if skip >= fetch_total or not batch:
            break

    # Final save
    with open(FETCH_DATA_FILE, "w") as f:
        json.dump(all_records, f)
    cp["fetch_complete"] = True
    cp["phase"] = "upsert"
    save_checkpoint(cp)
    print(f"  Fetch complete: {len(all_records):,} total records saved to {FETCH_DATA_FILE}")

    return all_records


def normalize_fda(records: list[dict], cutoff: str | None = None) -> list[dict]:
    """Normalize FDA records, filtering to those with start_date >= cutoff."""
    effective_cutoff = cutoff or CUTOFF_DATE
    normalised: list[dict] = []

    for rec in records:
        try:
            openfda = rec.get("openfda") or {}
            raw_generic = (rec.get("generic_name") or "").strip()
            if not raw_generic:
                continue

            dosage_form = (rec.get("dosage_form") or "").strip()
            generic_name = _fda_clean_generic_name(raw_generic, dosage_form)

            raw_brands = openfda.get("brand_name") or []
            brand_names = [b.title() for b in raw_brands if b.strip()]

            raw_status = (rec.get("status") or "Current").strip()
            status = _FDA_STATUS_MAP.get(raw_status, "active")

            start_date = _fda_parse_date(rec.get("initial_posting_date"))
            if not start_date:
                start_date = _fda_parse_date(rec.get("update_date"))
            if not start_date:
                start_date = date.today().isoformat()

            # Date filter
            if start_date < effective_cutoff:
                continue

            closing_date = _fda_parse_date(rec.get("discontinued_date") or rec.get("change_date"))
            end_date = closing_date if status == "resolved" else None

            fda_reason = (rec.get("shortage_reason") or "").strip()
            reason_category = "discontinuation" if raw_status == "To Be Discontinued" else _FDA_REASON_MAP.get(fda_reason, "unknown")

            related_info = (rec.get("related_info") or "").strip() or None
            resolved_note = (rec.get("resolved_note") or "").strip() or None
            reason = related_info or (fda_reason if fda_reason != "Other" else None)

            availability = (rec.get("availability") or "").strip()
            severity = _fda_infer_severity(status, availability, generic_name, raw_generic)

            therapeutic_cats = rec.get("therapeutic_category") or []
            therapeutic_str = "; ".join(therapeutic_cats) or None
            notes_parts = []
            if therapeutic_str:
                notes_parts.append(f"Therapeutic category: {therapeutic_str}")
            if availability:
                notes_parts.append(f"Availability: {availability}")
            if related_info:
                notes_parts.append(related_info)
            if resolved_note:
                notes_parts.append(f"Resolution note: {resolved_note}")
            notes = "\n\n".join(notes_parts) or None

            normalised.append({
                "generic_name": generic_name,
                "brand_names": brand_names,
                "status": status,
                "severity": severity,
                "reason": reason,
                "reason_category": reason_category,
                "start_date": start_date,
                "end_date": end_date,
                "estimated_resolution_date": None,
                "source_url": "https://www.accessdata.fda.gov/scripts/drugshortages/",
                "notes": notes,
                "raw_record": {
                    "package_ndc": rec.get("package_ndc"),
                    "dosage_form": dosage_form or None,
                    "company_name": rec.get("company_name"),
                    "status": raw_status,
                    "shortage_reason": fda_reason or None,
                    "availability": availability or None,
                    "initial_posting_date": rec.get("initial_posting_date"),
                    "update_date": rec.get("update_date"),
                },
            })
        except Exception:
            pass  # skip malformed records silently

    return normalised


# ─────────────────────────────────────────────────────────────────────────────
# Deep FDA backfill (with checkpoint/resume)
# ─────────────────────────────────────────────────────────────────────────────

def run_fda_deep_backfill(db: Any) -> dict[str, Any]:
    """Full FDA deep backfill with checkpoint/resume support.

    Phase 1: Fetch all FDA pages (checkpointed every 5 pages)
    Phase 2: Normalize (in-memory, fast)
    Phase 3: Upsert (checkpointed every 50 records)
    """
    summary: dict[str, Any] = {
        "name": "FDA (deep)",
        "status": "failed",
        "fetched": 0,
        "filtered": 0,
        "new": 0,
        "updated": 0,
        "skipped": 0,
    }

    print(f"\n{'=' * 60}")
    print(f"  FDA Deep Historical Backfill")
    print(f"  Range: {CUTOFF_DATE} -> {date.today().isoformat()}")
    print(f"{'=' * 60}")

    cp = load_checkpoint()
    if cp:
        phase = cp.get("phase", "fetch")
        print(f"  Checkpoint found — phase: {phase}")
    else:
        phase = "fetch"

    try:
        # ── Phase 1: Fetch ──────────────────────────────────────────
        print("\n  Phase 1: Fetching FDA records...")
        raw_records = fetch_fda_with_checkpoint(rate_delay=DEEP_RATE_DELAY)
        summary["fetched"] = len(raw_records)
        print(f"  Total fetched: {len(raw_records):,} records")

        # ── Phase 2: Normalize ──────────────────────────────────────
        print("\n  Phase 2: Normalizing records...")
        events = normalize_fda(raw_records, cutoff=CUTOFF_DATE)
        summary["filtered"] = len(events)
        print(f"  After date filter (>= {CUTOFF_DATE}): {len(events):,} records")

        if not events:
            print("  No records to upsert.")
            summary["status"] = "success"
            clear_checkpoint()
            return summary

        # ── Phase 3: Upsert (checkpointed) ─────────────────────────
        print(f"\n  Phase 3: Upserting {len(events):,} records...")

        # Resume from checkpoint if available
        cp = load_checkpoint() or {}
        start_index = cp.get("upsert_index", 0)
        running_counts = cp.get("counts")

        # Log to raw_scrapes
        backfill_tag = f"historical_backfill_{CUTOFF_DATE[:4]}"
        scrape_id = log_raw_scrape(db, FDA_SOURCE_ID, f"FDA Deep Backfill {CUTOFF_DATE}", summary["fetched"], backfill_tag)

        def _save_upsert_checkpoint(idx: int, counts: dict) -> None:
            ucp = load_checkpoint() or {
                "cutoff_date": CUTOFF_DATE,
                "fetch_complete": True,
            }
            ucp["phase"] = "upsert"
            ucp["upsert_index"] = idx
            ucp["counts"] = dict(counts)
            save_checkpoint(ucp)

        counts = upsert_shortage_batch(
            db, events, FDA_SOURCE_ID, "United States", "US", "FDA",
            start_index=start_index,
            running_counts=running_counts,
            checkpoint_fn=_save_upsert_checkpoint,
        )
        summary.update(counts)
        summary["status"] = "success"

        # Update raw_scrapes
        update_raw_scrape(db, scrape_id, "processed", len(events), counts["new"] + counts["updated"])

        # Clean up checkpoint — we're done
        clear_checkpoint()
        print(f"\n  Checkpoint cleared — backfill complete.")

    except KeyboardInterrupt:
        print("\n\n  Interrupted! Checkpoint saved — re-run to resume.")
        sys.exit(130)
    except Exception as exc:
        summary["error"] = str(exc)
        print(f"\n  FAILED: {exc}")
        print(f"  Checkpoint saved — re-run with same args to resume.")

    # Print summary
    print(f"\n  {'─' * 50}")
    print(f"  FDA Deep Backfill Summary")
    print(f"  {'─' * 50}")
    print(f"  Total fetched:     {summary['fetched']:,}")
    print(f"  After date filter: {summary['filtered']:,}")
    print(f"  New inserts:       {summary.get('new', 0):,}")
    print(f"  Updated existing:  {summary.get('updated', 0):,}")
    print(f"  Skipped/errors:    {summary.get('skipped', 0):,}")
    print(f"  {'─' * 50}")

    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Health Canada
# ─────────────────────────────────────────────────────────────────────────────

_HC_STATUS_MAP = {
    "Actual shortage": "active",
    "Anticipated shortage": "anticipated",
    "Avoided shortage": "resolved",
    "Resolved": "resolved",
}

_HC_REASON_MAP = {
    "Disruption of the manufacture of the drug.": "manufacturing_issue",
    "Demand increase for the drug.": "demand_surge",
    "Shortage of an active ingredient.": "raw_material",
    "Shortage of an inactive ingredient or component.": "raw_material",
    "Delay in shipping of the drug.": "supply_chain",
    "Requirements related to complying with good manufacturing practices.": "manufacturing_issue",
    "Other (Please describe in comments)": "unknown",
}


def _hc_as_date(raw: str | None) -> str | None:
    if not raw:
        return None
    stripped = raw.strip()
    if len(stripped) == 10 and stripped[4] == "-" and stripped[7] == "-":
        return stripped
    return None


def _hc_infer_severity(status: str, tier3: bool, route: str, atc_desc: str, generic_name: str) -> str:
    if status == "resolved":
        return "low"
    if tier3:
        return "critical"
    combined = f"{route} {atc_desc} {generic_name}".lower()
    if any(kw in combined for kw in ["intravenous", "parenteral", "infusion", "injection"]):
        return "high"
    if any(kw in combined for kw in [
        "insulin", "antidiabetic", "cardiac", "antineoplastic",
        "blood glucose", "immunosuppressant", "transplant",
        "antiinfective", "antibacterial", "antifungal",
    ]):
        return "high"
    return "medium"


def _fetch_hc_export(status_filter: str, timeout: float = 120.0) -> list[dict]:
    """POST to HC export endpoint, return parsed CSV rows."""
    form_data = {
        "filter_types[]": "shortages",
        "filter_statuses[]": status_filter,
        "export[filter_types]": "shortages",
        "export[filter_statuses]": status_filter,
    }
    resp = httpx.post(HC_EXPORT_URL, data=form_data, headers=HEADERS, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        csv_name = zf.namelist()[0]
        raw_csv = zf.read(csv_name).decode("utf-8-sig")

    lines = raw_csv.splitlines()
    csv_body = "\n".join(lines[1:])  # skip disclaimer row
    reader = csv.DictReader(io.StringIO(csv_body))
    return list(reader)


def fetch_health_canada() -> list[dict]:
    """Fetch HC exports for active, anticipated, and (attempt) resolved."""
    all_records: list[dict] = []

    for status_filter in ["active_confirmed", "anticipated_shortage"]:
        try:
            records = _fetch_hc_export(status_filter)
            print(f"  HC {status_filter}: {len(records)} records")
            all_records.extend(records)
        except Exception as exc:
            print(f"  HC {status_filter}: FAILED — {exc}")

    # Attempt resolved with longer timeout
    try:
        print("  HC resolved: fetching (300s timeout)...")
        records = _fetch_hc_export("resolved", timeout=300.0)
        print(f"  HC resolved: {len(records)} records")
        all_records.extend(records)
    except Exception as exc:
        print(f"  HC resolved: FAILED (expected — large dataset) — {exc}")

    return all_records


def normalize_health_canada(records: list[dict], cutoff: str | None = None) -> list[dict]:
    """Normalize HC records, filtering to start_date >= cutoff."""
    effective_cutoff = cutoff or CUTOFF_DATE
    normalised: list[dict] = []

    for rec in records:
        try:
            ingredients_raw = (rec.get("Ingredients") or "").strip()
            common_name = (rec.get("Common or Proper name") or "").strip()

            if ingredients_raw:
                first_ingredient = ingredients_raw.split(";")[0].strip()
                generic_name = first_ingredient.title()
            elif common_name:
                generic_name = common_name.title()
            else:
                continue

            brand_raw = (rec.get("Brand name") or "").strip()
            brand_names = [brand_raw.title()] if brand_raw else []

            hc_status = (rec.get("Shortage status") or "").strip()
            status = _HC_STATUS_MAP.get(hc_status, "active")

            actual_start = _hc_as_date(rec.get("Actual start date"))
            anticipated_start = _hc_as_date(rec.get("Anticipated start date"))
            estimated_end = _hc_as_date(rec.get("Estimated end date"))
            actual_end = _hc_as_date(rec.get("Actual end date"))

            start_date = actual_start or anticipated_start or _hc_as_date(rec.get("Date Created")) or date.today().isoformat()

            # Date filter
            if start_date < effective_cutoff:
                continue

            end_date = actual_end if status == "resolved" else None
            estimated_resolution_date = estimated_end if status in ("active", "anticipated") else None

            hc_reason = (rec.get("Reason") or "").strip()
            reason_category = _HC_REASON_MAP.get(hc_reason, "unknown")
            reason = hc_reason if hc_reason and hc_reason != "Other (Please describe in comments)" else None

            tier3 = (rec.get("Tier 3") or "No").strip().lower() == "yes"
            route = (rec.get("Route of administration") or "").upper()
            atc_desc = (rec.get("ATC description") or "").upper()
            severity = _hc_infer_severity(status, tier3, route, atc_desc, generic_name)

            atc_code = (rec.get("ATC Code") or "").strip()
            notes_parts = []
            if atc_code:
                notes_parts.append(f"ATC: {atc_code} — {atc_desc.title()}")
            if rec.get("Strength(s)"):
                notes_parts.append(f"Strength: {rec['Strength(s)']}")
            if route:
                notes_parts.append(f"Route: {route.title()}")
            if tier3:
                notes_parts.append("Tier 3: Yes (high clinical priority)")
            notes = "\n".join(notes_parts) or None

            report_id = (rec.get("Report ID") or "").strip()
            source_url = f"https://healthproductshortages.ca/shortage/{report_id}" if report_id else "https://healthproductshortages.ca"

            normalised.append({
                "generic_name": generic_name,
                "brand_names": brand_names,
                "status": status,
                "severity": severity,
                "reason": reason,
                "reason_category": reason_category,
                "start_date": start_date,
                "end_date": end_date,
                "estimated_resolution_date": estimated_resolution_date,
                "source_url": source_url,
                "notes": notes,
                "raw_record": {
                    "report_id": report_id or None,
                    "din": (rec.get("Drug Identification Number") or "").strip() or None,
                    "brand_name": brand_raw or None,
                    "ingredients": ingredients_raw or None,
                    "shortage_status": hc_status or None,
                    "reason": hc_reason or None,
                    "tier3": rec.get("Tier 3") or None,
                },
            })
        except Exception:
            pass

    return normalised


# ─────────────────────────────────────────────────────────────────────────────
# TGA
# ─────────────────────────────────────────────────────────────────────────────

_TGA_STATUS_MAP = {"C": "active", "R": "resolved", "D": "resolved"}

_TGA_REASON_RULES: list[tuple[str, list[str]]] = [
    ("discontinuation", ["discontinu", "ceased production", "no longer available", "withdrawn from market", "permanently"]),
    ("manufacturing_issue", ["manufactur", "production issue", "batch", "recall", "contamination", "gmp", "quality"]),
    ("raw_material", ["raw material", "api shortage", "active pharmaceutical ingredient", "active substance shortage"]),
    ("supply_chain", ["supply chain", "freight", "logistics", "import", "export", "distributor", "transport", "warehouse"]),
    ("demand_surge", ["demand", "increased use", "increase in orders", "pandemic", "seasonal", "surge"]),
    ("regulatory_action", ["regulatory", "tga action", "licence", "suspended", "cancelled", "compliance", "recall"]),
    ("distribution", ["wholesaler", "distribution centre", "supply agreement"]),
]

_TGA_CRITICAL_KEYWORDS = [
    "no alternative", "no suitable alternative", "life-saving",
    "life threatening", "critical medicine", "emergency",
    "insulin", "adrenaline", "epinephrine",
]
_TGA_HIGH_KEYWORDS = [
    "significant impact", "hospital", "intravenous", "injection",
    "parenteral", "limited alternative", "specialist",
]
_TGA_DIRECT_SEVERITY = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}

_TABULAR_DATA_RE = re.compile(r"tabularData\s*=\s*", re.IGNORECASE)


def _tga_parse_date(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    try:
        dt = dtparser.parse(raw.strip(), dayfirst=True)
        return dt.date().isoformat()
    except (ValueError, OverflowError):
        return None


def _tga_infer_severity(status: str, shortage_impact: str, patient_impact: str, generic_name: str) -> str:
    if status == "resolved":
        return "low"
    direct = shortage_impact.strip().lower()
    if direct in _TGA_DIRECT_SEVERITY:
        return _TGA_DIRECT_SEVERITY[direct]
    combined = f"{shortage_impact} {patient_impact} {generic_name}".lower()
    if any(kw in combined for kw in _TGA_CRITICAL_KEYWORDS):
        return "critical"
    if any(kw in combined for kw in _TGA_HIGH_KEYWORDS):
        return "high"
    return "medium"


def _tga_infer_reason_category(shortage_impact: str, patient_impact: str, mgmt_action: str) -> str:
    combined = f"{shortage_impact} {patient_impact} {mgmt_action}".lower()
    for category, keywords in _TGA_REASON_RULES:
        if any(kw in combined for kw in keywords):
            return category
    return "unknown"


def _tga_extract_brand_names(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[,;]", raw)
        return [p.strip() for p in parts if p.strip()]
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [str(raw).strip()]


def fetch_tga() -> dict:
    """GET TGA shortage page and extract embedded tabularData JSON."""
    resp = httpx.get(TGA_URL, params={"shortagetype": "All"}, headers=HEADERS, timeout=60.0, follow_redirects=True)
    resp.raise_for_status()
    html = resp.text

    match = _TABULAR_DATA_RE.search(html)
    if not match:
        raise ValueError("Could not locate 'tabularData' in TGA HTML — page structure may have changed.")

    decoder = json.JSONDecoder()
    payload, _ = decoder.raw_decode(html, match.end())
    return payload


def normalize_tga(payload: dict, cutoff: str | None = None) -> list[dict]:
    """Normalize TGA records, filtering to start_date >= cutoff."""
    effective_cutoff = cutoff or CUTOFF_DATE
    records = payload.get("records", [])
    normalised: list[dict] = []

    for rec in records:
        try:
            generic_name = (rec.get("active_joined") or rec.get("active_ingredients") or "").strip()
            if not generic_name:
                continue

            brand_names = _tga_extract_brand_names(rec.get("trade_names"))

            raw_status = (rec.get("status") or "C").upper().strip()
            status = _TGA_STATUS_MAP.get(raw_status, "active")

            start_date = _tga_parse_date(rec.get("shortage_start"))
            shortage_end = _tga_parse_date(rec.get("shortage_end"))
            if not start_date:
                start_date = _tga_parse_date(rec.get("last_updated"))
            if not start_date:
                start_date = date.today().isoformat()

            # Date filter
            if start_date < effective_cutoff:
                continue

            end_date = shortage_end if status == "resolved" else None
            estimated_resolution_date = shortage_end if status == "active" else None

            shortage_impact = (rec.get("shortage_impact") or "").strip()
            patient_impact = (rec.get("patient_impact") or "").strip()
            mgmt_action_raw = (rec.get("tga_shortage_management_action_raw") or "").strip()
            availability = (rec.get("availability") or "").strip()

            severity = _tga_infer_severity(status, shortage_impact, patient_impact, generic_name)

            si_is_label = shortage_impact.lower() in _TGA_DIRECT_SEVERITY
            if raw_status == "D":
                reason_category = "discontinuation"
                reason = patient_impact or mgmt_action_raw or "Product discontinued."
            else:
                reason_category = _tga_infer_reason_category(
                    "" if si_is_label else shortage_impact, patient_impact, mgmt_action_raw
                )
                reason = patient_impact or (None if si_is_label else shortage_impact) or None

            notes_parts = []
            if availability:
                notes_parts.append(f"TGA availability: {availability}")
            if patient_impact:
                notes_parts.append(f"Patient impact: {patient_impact}")
            if mgmt_action_raw:
                notes_parts.append(f"TGA guidance: {mgmt_action_raw}")
            notes = "\n\n".join(notes_parts) or None

            artg = rec.get("artg_numb")
            source_url = f"https://apps.tga.gov.au/Prod/msi/search?artgNumber={artg}" if artg else TGA_URL

            normalised.append({
                "generic_name": generic_name,
                "brand_names": brand_names,
                "status": status,
                "severity": severity,
                "reason": reason,
                "reason_category": reason_category,
                "start_date": start_date,
                "end_date": end_date,
                "estimated_resolution_date": estimated_resolution_date,
                "source_url": source_url,
                "notes": notes,
                "raw_record": {
                    "artg_numb": artg,
                    "trade_names": brand_names[0] if brand_names else None,
                    "sponsor": rec.get("Sponsor_Name"),
                    "dose_form": rec.get("dose_form"),
                    "atc_level1": rec.get("atc_level1"),
                    "status": raw_status,
                    "shortage_start": rec.get("shortage_start"),
                    "shortage_end": rec.get("shortage_end"),
                    "last_updated": rec.get("last_updated"),
                    "availability": rec.get("availability"),
                },
            })
        except Exception:
            pass

    return normalised


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator (for multi-source runs)
# ─────────────────────────────────────────────────────────────────────────────

def backfill_source(
    db: Any,
    name: str,
    source_id: str,
    country: str,
    country_code: str,
    fetch_fn,
    normalize_fn,
) -> dict[str, Any]:
    """Orchestrate backfill for a single source (simple mode, no checkpoint)."""
    print(f"\n{'=' * 50}")
    print(f"  {name}")
    print(f"{'=' * 50}")

    summary: dict[str, Any] = {"name": name, "status": "failed", "fetched": 0, "filtered": 0, "new": 0, "updated": 0, "skipped": 0}

    try:
        # Fetch
        raw = fetch_fn()
        summary["fetched"] = len(raw) if isinstance(raw, list) else len(raw.get("records", []))
        print(f"  Fetched: {summary['fetched']} total records")

        # Normalize (includes date filtering)
        events = normalize_fn(raw, cutoff=CUTOFF_DATE)
        summary["filtered"] = len(events)
        print(f"  After date filter (>= {CUTOFF_DATE}): {len(events)} records")

        if not events:
            print("  No records to upsert.")
            summary["status"] = "success"
            return summary

        # Log to raw_scrapes
        scrape_id = log_raw_scrape(db, source_id, f"{name} Historical Backfill", summary["fetched"])

        # Upsert
        counts = upsert_shortage_batch(db, events, source_id, country, country_code, name)
        summary.update(counts)
        summary["status"] = "success"

        # Update raw_scrapes
        update_raw_scrape(db, scrape_id, "processed", len(events), counts["new"] + counts["updated"])

    except Exception as exc:
        summary["error"] = str(exc)
        print(f"  FAILED: {exc}")

    # Print summary
    print(f"\n  --- {name} Summary ---")
    print(f"  Total fetched:     {summary['fetched']}")
    print(f"  After date filter: {summary['filtered']}")
    print(f"  New inserts:       {summary.get('new', 0)}")
    print(f"  Updated existing:  {summary.get('updated', 0)}")
    print(f"  Skipped/errors:    {summary.get('skipped', 0)}")

    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Mederti historical shortage backfill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  python backfill_historical.py                            # all sources, default cutoff
  python backfill_historical.py --source fda --from 2005-01-01  # deep FDA backfill
  python backfill_historical.py --source hc                # Health Canada only
""",
    )
    parser.add_argument(
        "--source",
        choices=["fda", "hc", "tga"],
        default=None,
        help="Run a single source (default: all three)",
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        default="2024-03-01",
        help="Cutoff date in YYYY-MM-DD format (default: 2024-03-01)",
    )
    args = parser.parse_args()

    # Set global cutoff
    global CUTOFF_DATE
    CUTOFF_DATE = args.from_date

    print("\n" + "=" * 60)
    print("  Mederti Historical Backfill")
    print(f"  Cutoff: {CUTOFF_DATE} -> {date.today().isoformat()}")
    print(f"  Source: {args.source or 'all (FDA, HC, TGA)'}")
    print(f"  Time:   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Init Supabase
    from backend.utils.db import get_supabase_client
    db = get_supabase_client()
    print("\n  Supabase connected.")

    # ── Single-source deep backfill (with checkpoint for FDA) ───────────
    if args.source == "fda":
        result = run_fda_deep_backfill(db)
        sys.exit(0 if result["status"] == "success" else 1)

    if args.source == "hc":
        result = backfill_source(db, "Health Canada", HC_SOURCE_ID, "Canada", "CA", fetch_health_canada, normalize_health_canada)
        sys.exit(0 if result["status"] == "success" else 1)

    if args.source == "tga":
        result = backfill_source(db, "TGA", TGA_SOURCE_ID, "Australia", "AU", fetch_tga, normalize_tga)
        sys.exit(0 if result["status"] == "success" else 1)

    # ── All sources (original behavior) ─────────────────────────────────
    sources = [
        ("FDA", FDA_SOURCE_ID, "United States", "US", fetch_fda, normalize_fda),
        ("Health Canada", HC_SOURCE_ID, "Canada", "CA", fetch_health_canada, normalize_health_canada),
        ("TGA", TGA_SOURCE_ID, "Australia", "AU", fetch_tga, normalize_tga),
    ]

    results = []
    for name, source_id, country, cc, fetch_fn, norm_fn in sources:
        result = backfill_source(db, name, source_id, country, cc, fetch_fn, norm_fn)
        results.append(result)

    # Final summary
    print("\n" + "=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)
    total_new = 0
    total_updated = 0
    any_failed = False
    for r in results:
        status_icon = "OK" if r["status"] == "success" else "FAIL"
        new = r.get("new", 0)
        updated = r.get("updated", 0)
        total_new += new
        total_updated += updated
        if r["status"] != "success":
            any_failed = True
        print(f"  [{status_icon}] {r['name']:20s}  {new:5d} new, {updated:5d} updated, {r.get('skipped', 0):4d} skipped")

    print(f"\n  Total: {total_new} new records, {total_updated} updated")
    print("=" * 60)

    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
