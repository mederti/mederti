"""One-off audit: recall + shortage coverage by country, ingestion freshness."""
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json"}

def get_all(table, select, params=None, page=1000):
    rows = []
    offset = 0
    while True:
        h = dict(HEADERS)
        h["Range"] = f"{offset}-{offset+page-1}"
        h["Range-Unit"] = "items"
        h["Prefer"] = "count=exact"
        p = {"select": select}
        if params:
            p.update(params)
        r = httpx.get(f"{URL}/rest/v1/{table}", headers=h, params=p, timeout=60)
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows

now = datetime.now(timezone.utc)
d7 = (now - timedelta(days=7)).isoformat()
d30 = (now - timedelta(days=30)).isoformat()
d90 = (now - timedelta(days=90)).isoformat()

# 1. recalls — get the full table (id, country, source, created_at, announced_date)
print("=" * 80)
print("RECALLS TABLE — coverage by country_code + source_id")
print("=" * 80)
recalls = get_all("recalls", "id,country_code,source_id,created_at,announced_date")
print(f"total rows: {len(recalls)}")

by_country = defaultdict(lambda: {"total": 0, "max_created": None, "max_announced": None,
                                    "d7": 0, "d30": 0, "d90": 0})
for r in recalls:
    cc = r.get("country_code") or "(null)"
    b = by_country[cc]
    b["total"] += 1
    ca = r.get("created_at") or ""
    an = r.get("announced_date") or ""
    if ca > (b["max_created"] or ""):
        b["max_created"] = ca
    if an > (b["max_announced"] or ""):
        b["max_announced"] = an
    if ca >= d7: b["d7"] += 1
    if ca >= d30: b["d30"] += 1
    if ca >= d90: b["d90"] += 1

print()
print(f"{'cc':<6} {'total':>7} {'d7':>5} {'d30':>5} {'d90':>5}  max_created                  max_announced")
print("-" * 100)
for cc in sorted(by_country, key=lambda c: -by_country[c]["total"]):
    b = by_country[cc]
    print(f"{cc:<6} {b['total']:>7} {b['d7']:>5} {b['d30']:>5} {b['d90']:>5}  "
          f"{(b['max_created'] or '-')[:24]:<28} {(b['max_announced'] or '-')[:10]}")

# 2. source_id distribution
print()
print("=" * 80)
print("RECALLS by source_id")
print("=" * 80)
by_src = defaultdict(int)
for r in recalls:
    by_src[r.get("source_id") or "(null)"] += 1
for s in sorted(by_src, key=lambda s: -by_src[s]):
    print(f"  {s:<60} {by_src[s]:>6}")

# 3. shortage_events — same cut
print()
print("=" * 80)
print("SHORTAGE_EVENTS by country_code")
print("=" * 80)
events = get_all("shortage_events", "id,country_code,country,created_at,start_date,status")
print(f"total rows: {len(events)}")
by_country2 = defaultdict(lambda: {"total": 0, "active": 0, "max_created": None,
                                    "d7": 0, "d30": 0, "d90": 0})
for e in events:
    cc = e.get("country_code") or e.get("country") or "(null)"
    b = by_country2[cc]
    b["total"] += 1
    if e.get("status") == "active":
        b["active"] += 1
    ca = e.get("created_at") or ""
    if ca > (b["max_created"] or ""):
        b["max_created"] = ca
    if ca >= d7: b["d7"] += 1
    if ca >= d30: b["d30"] += 1
    if ca >= d90: b["d90"] += 1

print()
print(f"{'cc':<8} {'total':>7} {'active':>7} {'d7':>5} {'d30':>5} {'d90':>5}  max_created")
print("-" * 90)
for cc in sorted(by_country2, key=lambda c: -by_country2[c]["total"]):
    b = by_country2[cc]
    print(f"{cc:<8} {b['total']:>7} {b['active']:>7} {b['d7']:>5} {b['d30']:>5} {b['d90']:>5}  {(b['max_created'] or '-')[:24]}")

# 4. data_sources table — last_scraped_at
print()
print("=" * 80)
print("DATA_SOURCES table")
print("=" * 80)
sources = get_all("data_sources", "*")
print(f"total rows: {len(sources)}")
if sources:
    print(f"columns: {sorted(sources[0].keys())}")
for s in sources:
    print(" ", {k: v for k, v in s.items() if k != "id"} | {"id": s.get("id")})
