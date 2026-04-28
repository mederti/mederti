"""Verify latanoprost fix end-to-end."""
from __future__ import annotations
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.utils.db import get_supabase_client

db = get_supabase_client()
TGA_SOURCE_ID = "10000000-0000-0000-0000-000000000003"

sep = "=" * 60

for artg in ["291496", "291499", "304898"]:
    print(f"\n{sep}")
    print(f"  AUST R: {artg}")
    print(sep)
    resp = (
        db.table("shortage_events")
        .select("id, severity, status, availability_status, management_action, product_registration_id, notes, raw_data")
        .eq("data_source_id", TGA_SOURCE_ID)
        .eq("product_registration_id", artg)
        .execute()
    )
    if resp.data:
        for rec in resp.data:
            print(f"  severity:                {rec['severity']}")
            print(f"  status:                  {rec['status']}")
            print(f"  availability_status:     {rec['availability_status']}")
            ma = rec.get("management_action") or "NULL"
            print(f"  management_action:       {ma[:100]}")
            print(f"  product_registration_id: {rec['product_registration_id']}")
            raw = rec.get("raw_data") or {}
            print(f"  raw shortage_impact:     {raw.get('shortage_impact', 'N/A')}")
            print(f"  raw availability:        {raw.get('availability', 'N/A')}")
    else:
        print("  NOT FOUND")

print(f"\n{sep}")
print("  TGA SEVERITY DISTRIBUTION (after backfill)")
print(sep)
for sev in ["critical", "high", "medium", "low"]:
    resp = (
        db.table("shortage_events")
        .select("id", count="exact")
        .eq("data_source_id", TGA_SOURCE_ID)
        .eq("severity", sev)
        .execute()
    )
    print(f"  {sev:10s}: {resp.count or 0}")
