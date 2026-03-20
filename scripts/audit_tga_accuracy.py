#!/usr/bin/env python3
"""
Daily TGA data accuracy audit.
──────────────────────────────
Randomly samples active AU shortage records from Supabase,
fetches live status from TGA Medicine Shortages Information (MSI),
diffs the results, and logs discrepancies.

Run:      python scripts/audit_tga_accuracy.py
Schedule: Weekly via Railway cron (Monday 8am UTC)
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

SAMPLE_SIZE = 50
RATE_DELAY = 0.8  # seconds between TGA requests
TGA_DETAIL_URL = "https://apps.tga.gov.au/Prod/msi/Search/Details/{name}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MedertiAudit/1.0; +https://mederti.com)",
}

# ── DB ────────────────────────────────────────────────────────────────────────

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend.utils.db import get_supabase_client

db = get_supabase_client()


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_sample() -> list[dict]:
    """Pull all active AU shortage records, join drug name, and sample."""
    # Get all active AU events
    rows = []
    offset = 0
    while True:
        r = db.table("shortage_events").select(
            "id, drug_id, status, severity, availability_status, "
            "start_date, end_date, shortage_id, source_url, updated_at"
        ).eq("country_code", "AU").eq("status", "active").range(offset, offset + 499).execute()
        if not r.data:
            break
        rows.extend(r.data)
        if len(r.data) < 500:
            break
        offset += 500

    # Collect unique drug_ids and fetch names
    drug_ids = list({r["drug_id"] for r in rows if r.get("drug_id")})
    drug_names: dict[str, str] = {}
    for i in range(0, len(drug_ids), 50):
        batch = drug_ids[i : i + 50]
        for did in batch:
            dr = db.table("drugs").select("id, generic_name").eq("id", did).execute()
            if dr.data:
                drug_names[dr.data[0]["id"]] = dr.data[0]["generic_name"]

    # Attach drug name
    for row in rows:
        row["_drug_name"] = drug_names.get(row.get("drug_id"), None)

    # Filter to those with a drug name (needed for TGA lookup)
    with_name = [r for r in rows if r.get("_drug_name")]
    print(f"Total active AU records: {len(rows)}")
    print(f"With drug name: {len(with_name)}")

    sample_size = min(SAMPLE_SIZE, len(with_name))
    sample = random.sample(with_name, sample_size)
    print(f"Sampled {sample_size} records for audit\n")
    return sample


def fetch_tga_live(generic_name: str) -> list[dict]:
    """
    Fetch live TGA MSI detail page for a generic name.
    Returns list of product-level records with status/availability.
    """
    url = TGA_DETAIL_URL.format(name=generic_name.lower())
    try:
        r = httpx.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        if r.status_code != 200:
            return [{"_error": f"HTTP {r.status_code}", "_url": url}]

        soup = BeautifulSoup(r.text, "html.parser")
        table = soup.find("table")
        if not table:
            return [{"_error": "no_table", "_url": url}]

        records = []
        for row in table.find_all("tr")[1:]:  # skip header
            cells = row.find_all("td")
            if len(cells) < 3:
                continue

            product_text = cells[0].get_text(strip=True)
            dates_text = cells[1].get_text(strip=True)
            details_text = cells[2].get_text(strip=True)

            # Extract status
            status_match = re.search(r"Shortage status:\s*(\w+)", details_text)
            avail_match = re.search(r"Availability:\s*(\w+)", details_text)
            reason_match = re.search(r"Reason:\s*([^M]+?)(?:Management|$)", details_text)

            records.append({
                "product": product_text[:100],
                "tga_status": status_match.group(1) if status_match else None,
                "tga_availability": avail_match.group(1) if avail_match else None,
                "tga_reason": reason_match.group(1).strip() if reason_match else None,
                "dates": dates_text[:80],
            })

        return records

    except Exception as e:
        return [{"_error": str(e), "_url": url}]


def diff_record(our: dict, tga_records: list[dict]) -> list[dict]:
    """Compare our stored record against live TGA data."""
    discrepancies: list[dict] = []
    drug = our.get("_drug_name", "Unknown")

    # Check for fetch errors
    if tga_records and tga_records[0].get("_error"):
        err = tga_records[0]["_error"]
        if err == "no_table":
            discrepancies.append({
                "type": "no_tga_data",
                "drug": drug,
                "message": f"No shortage records on TGA for '{drug}' — may be resolved or delisted",
                "severity": "high",
            })
        return discrepancies

    if not tga_records:
        discrepancies.append({
            "type": "no_tga_data",
            "drug": drug,
            "message": f"No TGA records found for '{drug}'",
            "severity": "medium",
        })
        return discrepancies

    # Check if ALL TGA products for this drug are resolved/discontinued
    tga_statuses = [r.get("tga_status", "").lower() for r in tga_records]
    active_on_tga = any(s in ("current", "anticipated") for s in tga_statuses)
    all_resolved = all(s in ("resolved", "discontinued", "") for s in tga_statuses)

    our_status = our.get("status", "active")

    if our_status == "active" and all_resolved and tga_statuses:
        discrepancies.append({
            "type": "status_mismatch",
            "drug": drug,
            "message": f"We show ACTIVE but all {len(tga_records)} TGA products show resolved/discontinued",
            "our_status": our_status,
            "tga_statuses": tga_statuses,
            "severity": "critical",
        })

    # Check availability mismatch
    our_avail = (our.get("availability_status") or "").lower()
    tga_avails = [r.get("tga_availability", "").lower() for r in tga_records if r.get("tga_availability")]

    if our_avail and tga_avails:
        # If we show "available" but TGA shows "unavailable" for any product → flag
        if our_avail == "available" and "unavailable" in tga_avails:
            discrepancies.append({
                "type": "availability_mismatch",
                "drug": drug,
                "message": f"We show '{our_avail}' but TGA shows 'Unavailable' for some products",
                "our_value": our_avail,
                "tga_values": tga_avails,
                "severity": "medium",
            })

    return discrepancies


def run_audit():
    """Main audit runner."""
    print("=" * 60)
    print(f"TGA Data Accuracy Audit — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60 + "\n")

    sample = get_sample()
    all_discrepancies: list[dict] = []
    checked = 0

    for i, record in enumerate(sample):
        drug = record.get("_drug_name", "Unknown")
        print(f"[{i + 1}/{len(sample)}] {drug}...", end=" ")

        tga_live = fetch_tga_live(drug)
        diffs = diff_record(record, tga_live)

        if diffs:
            for d in diffs:
                print(f"\n  ⚠️  {d['type']}: {d['message']}")
                all_discrepancies.append(d)
        else:
            print("✓")

        checked += 1
        time.sleep(RATE_DELAY)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print("AUDIT COMPLETE")
    print(f"{'=' * 60}")
    print(f"Records checked:     {checked}")
    print(f"Discrepancies found: {len(all_discrepancies)}")

    critical = [d for d in all_discrepancies if d.get("severity") == "critical"]
    high = [d for d in all_discrepancies if d.get("severity") == "high"]
    medium = [d for d in all_discrepancies if d.get("severity") == "medium"]

    print(f"  Critical: {len(critical)}")
    print(f"  High:     {len(high)}")
    print(f"  Medium:   {len(medium)}")

    if critical:
        print(f"\n🚨 CRITICAL — Active in Mederti but resolved on TGA:")
        for d in critical:
            print(f"  • {d['drug']}: {d['message']}")

    if high:
        print(f"\n⚠️  HIGH — No TGA data found:")
        for d in high:
            print(f"  • {d['drug']}: {d['message']}")

    # ── Store audit results ───────────────────────────────────────────────────
    summary = {
        "audit_date": datetime.now(timezone.utc).isoformat(),
        "source": "TGA",
        "sample_size": checked,
        "discrepancy_count": len(all_discrepancies),
        "critical_count": len(critical),
        "high_count": len(high),
        "discrepancies": json.dumps(all_discrepancies, default=str),
    }

    try:
        db.table("audit_logs").insert({
            "action": "tga_accuracy_audit",
            "details": json.dumps(summary, default=str),
        }).execute()
        print(f"\nAudit results stored in audit_logs")
    except Exception as e:
        print(f"\nCould not store audit results: {e}")

    return all_discrepancies


if __name__ == "__main__":
    discrepancies = run_audit()
    sys.exit(1 if any(d.get("severity") == "critical" for d in discrepancies) else 0)
