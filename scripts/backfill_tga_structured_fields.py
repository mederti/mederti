"""
Backfill availability_status, management_action, product_registration_id
from existing notes TEXT and raw_data JSONB for TGA shortage_events.

Also recomputes severity using the new availability-aware logic.

Usage:
    cd /path/to/mederti
    source .env
    python scripts/backfill_tga_structured_fields.py
"""

from __future__ import annotations

import os
import re
import sys

# Add project root to path so we can import backend modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.utils.db import get_supabase_client


# ── Availability normalisation (same logic as TGAScraper._normalise_availability)
_AVAIL_MAP = {
    "unavailable":                 "unavailable",
    "not available":               "unavailable",
    "available":                   "available",
    "limited":                     "limited",
    "very limited":                "limited",
    "sourcing alternative supply": "sourcing",
    "reduction in supply":         "limited",
    "currently being sourced":     "sourcing",
}

def normalise_availability(raw: str) -> str | None:
    clean = (raw or "").strip().lower()
    for key, val in _AVAIL_MAP.items():
        if key in clean:
            return val
    return None


# ── Severity recompute (same logic as updated TGAScraper._infer_severity)
_DIRECT_SEV = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}
_SEV_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

_AVAIL_FLOOR = {
    "unavailable":   "high",
    "not available":  "high",
    "limited":       "medium",
    "very limited":  "high",
    "sourcing":      "medium",
    "available":     "",
}

_CRITICAL_KW = [
    "no alternative", "no suitable alternative", "life-saving",
    "life threatening", "critical medicine", "emergency",
    "insulin", "adrenaline", "epinephrine",
]
_HIGH_KW = [
    "significant impact", "hospital", "intravenous", "injection",
    "parenteral", "limited alternative", "specialist",
]


def recompute_severity(
    status: str,
    shortage_impact: str,
    patient_impact: str,
    generic_name: str,
    availability: str,
) -> str:
    """Recompute severity with availability floor."""
    if status == "resolved":
        return "low"

    direct = (shortage_impact or "").strip().lower()
    if direct in _DIRECT_SEV:
        base = _DIRECT_SEV[direct]
    else:
        combined = f"{shortage_impact} {patient_impact} {generic_name}".lower()
        if any(kw in combined for kw in _CRITICAL_KW):
            base = "critical"
        elif any(kw in combined for kw in _HIGH_KW):
            base = "high"
        else:
            base = "medium"

    # Availability floor
    avail_clean = (availability or "").strip().lower()
    avail_floor = ""
    for key, val in _AVAIL_FLOOR.items():
        if key in avail_clean:
            avail_floor = val
            break

    if avail_floor and _SEV_RANK.get(avail_floor, 0) > _SEV_RANK.get(base, 0):
        return avail_floor

    return base


TGA_SOURCE_ID = "10000000-0000-0000-0000-000000000003"


def main():
    db = get_supabase_client()

    # Fetch all TGA shortage events
    print("Fetching TGA shortage events...")
    page = 0
    page_size = 500
    all_records = []

    while True:
        resp = (
            db.table("shortage_events")
            .select("id, notes, raw_data, severity, status")
            .eq("data_source_id", TGA_SOURCE_ID)
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        batch = resp.data or []
        all_records.extend(batch)
        if len(batch) < page_size:
            break
        page += 1

    print(f"Found {len(all_records)} TGA records to process")

    updated = 0
    severity_changed = 0
    errors = 0

    for r in all_records:
        notes = r.get("notes") or ""
        raw_data = r.get("raw_data") or {}
        old_severity = r.get("severity")
        status = r.get("status") or "active"

        update: dict = {}

        # 1. Extract availability from notes: "TGA availability: Unavailable"
        avail_raw = ""
        avail_match = re.search(r"TGA availability:\s*(.+?)(?:\n|$)", notes, re.IGNORECASE)
        if avail_match:
            avail_raw = avail_match.group(1).strip()
            avail_normalised = normalise_availability(avail_raw)
            if avail_normalised:
                update["availability_status"] = avail_normalised
        # Also check raw_data
        if not avail_raw:
            avail_raw = raw_data.get("availability", "")
            avail_normalised = normalise_availability(avail_raw)
            if avail_normalised:
                update["availability_status"] = avail_normalised

        # 2. Extract management action from notes: "TGA guidance: ..."
        action_match = re.search(r"TGA guidance:\s*(.+?)(?:\n\n|$)", notes, re.IGNORECASE | re.DOTALL)
        if action_match:
            action_text = action_match.group(1).strip()
            if action_text:
                update["management_action"] = action_text

        # 3. Extract ARTG number from raw_data
        artg = raw_data.get("artg_numb") or raw_data.get("artgNumber") or raw_data.get("aust_r")
        if artg:
            update["product_registration_id"] = str(artg).strip()

        # 4. Recompute severity with availability awareness
        shortage_impact = raw_data.get("shortage_impact", "")
        patient_impact = ""
        # Try to extract patient_impact from notes
        pi_match = re.search(r"Patient impact:\s*(.+?)(?:\n|$)", notes, re.IGNORECASE)
        if pi_match:
            patient_impact = pi_match.group(1).strip()

        # We need generic_name for keyword scan but don't have it in this query
        # Use empty string — the main severity comes from shortage_impact and availability
        new_severity = recompute_severity(status, shortage_impact, patient_impact, "", avail_raw)

        if new_severity != old_severity:
            update["severity"] = new_severity
            severity_changed += 1

        # 5. Apply update if anything changed
        if update:
            try:
                db.table("shortage_events").update(update).eq("id", r["id"]).execute()
                updated += 1
            except Exception as e:
                print(f"  ERROR updating {r['id']}: {e}")
                errors += 1

        if (updated + errors) % 100 == 0 and (updated + errors) > 0:
            print(f"  Processed {updated + errors}/{len(all_records)} — {updated} updated, {severity_changed} severity changes, {errors} errors")

    print(f"\n{'='*60}")
    print(f"  Backfill complete")
    print(f"  Total TGA records:     {len(all_records)}")
    print(f"  Records updated:       {updated}")
    print(f"  Severity recalculated: {severity_changed}")
    print(f"  Errors:                {errors}")
    print(f"{'='*60}")

    # Spot-check latanoprost AUST R 291496
    print("\n--- Spot check: Latanoprost AUST R 291496 ---")
    check = (
        db.table("shortage_events")
        .select("id, severity, status, availability_status, management_action, product_registration_id, notes")
        .eq("data_source_id", TGA_SOURCE_ID)
        .eq("product_registration_id", "291496")
        .execute()
    )
    if check.data:
        for rec in check.data:
            print(f"  ID:                      {rec['id']}")
            print(f"  severity:                {rec['severity']}")
            print(f"  status:                  {rec['status']}")
            print(f"  availability_status:     {rec['availability_status']}")
            print(f"  management_action:       {rec['management_action'][:80] if rec.get('management_action') else 'NULL'}...")
            print(f"  product_registration_id: {rec['product_registration_id']}")
    else:
        print("  NOT FOUND — try querying by notes content")
        # Fallback: search by notes containing 291496
        check2 = (
            db.table("shortage_events")
            .select("id, severity, status, availability_status, management_action, product_registration_id, notes")
            .eq("data_source_id", TGA_SOURCE_ID)
            .ilike("notes", "%291496%")
            .execute()
        )
        if check2.data:
            for rec in check2.data:
                print(f"  ID:                      {rec['id']}")
                print(f"  severity:                {rec['severity']}")
                print(f"  availability_status:     {rec['availability_status']}")
                print(f"  product_registration_id: {rec['product_registration_id']}")
        else:
            print("  Still not found — ARTG may be in raw_data only")


if __name__ == "__main__":
    main()
