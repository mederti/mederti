"""Concise data_sources dump."""
import os
import httpx

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

r = httpx.get(
    f"{URL}/rest/v1/data_sources",
    headers=H,
    params={"select": "country_code,abbreviation,name,is_active,last_scraped_at,scrape_frequency_hours"},
    timeout=60,
)
r.raise_for_status()
rows = r.json()

print(f"{'cc':<4} {'abbr':<10} {'active':<7} last_scraped_at              freq_h  name")
print("-" * 130)
for s in sorted(rows, key=lambda x: ((x.get("country_code") or "ZZ"), x.get("abbreviation") or "")):
    cc = s.get("country_code") or "??"
    abbr = (s.get("abbreviation") or "")[:10]
    active = str(s.get("is_active"))[:5]
    last = s.get("last_scraped_at") or "NEVER"
    freq = s.get("scrape_frequency_hours") or "-"
    name = (s.get("name") or "")[:65]
    print(f"{cc:<4} {abbr:<10} {active:<7} {last:<28} {str(freq):<7} {name}")

# Now also check recalls source map
r2 = httpx.get(
    f"{URL}/rest/v1/data_sources",
    headers=H,
    params={"select": "id,abbreviation,country_code,name",
            "id": "in.(10000000-0000-0000-0000-000000000025,10000000-0000-0000-0000-000000000026,10000000-0000-0000-0000-000000000027,10000000-0000-0000-0000-000000000028,10000000-0000-0000-0000-000000000029,10000000-0000-0000-0000-000000000031,10000000-0000-0000-0000-000000000032)"},
    timeout=60,
)
print()
print("RECALL source_id resolution:")
for s in r2.json():
    print(f"  {s['id']}  cc={s.get('country_code')}  abbr={s.get('abbreviation')}  name={s.get('name')}")
