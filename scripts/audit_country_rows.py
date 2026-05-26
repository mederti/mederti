"""Targeted check: confirm zero-row countries for each cron-scheduled scraper."""
import os
import httpx

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}",
     "Prefer": "count=exact", "Range": "0-0", "Range-Unit": "items"}

CRON_SCRAPERS = [
    # (scraper_key_in_cron, country_code)
    ("tga", "AU"), ("fda", "US"), ("health_canada", "CA"), ("mhra", "GB"),
    ("ema", "EU"), ("bfarm", "DE"), ("ansm", "FR"), ("aifa", "IT"),
    ("aemps", "ES"), ("fda_enforcement", "US"), ("hsa", "SG"), ("pharmac", "NZ"),
    ("medsafe", "NZ"), ("cbg_meb", "NL"), ("dkma", "DK"), ("fimea", "FI"),
    ("hpra", "IE"), ("lakemedelsverket", "SE"), ("sukl", "CZ"), ("ogyei", "HU"),
    ("swissmedic", "CH"), ("noma", "NO"), ("ages", "AT"),
    ("anvisa", "BR"), ("pmda", "JP"), ("mfds", "KR"), ("cofepris", "MX"),
    ("sahpra", "ZA"), ("nafdac", "NG"), ("sfda", "SA"),
    # recalls
    ("tga_recalls", "AU"), ("fda_recalls", "US"), ("health_canada_recalls", "CA"),
    ("ema_recalls", "EU"), ("mhra_recalls", "GB"), ("fda_medwatch", "US"),
]

def count(table, cc):
    r = httpx.get(f"{URL}/rest/v1/{table}",
                  headers=H, params={"select": "id", "country_code": f"eq.{cc}"}, timeout=30)
    if r.status_code >= 400:
        return f"ERR{r.status_code}"
    cr = r.headers.get("content-range", "0/0")
    return cr.split("/")[-1]

print(f"{'scraper':<22} {'cc':<4} {'shortage_events':>16} {'recalls':>10}")
print("-" * 60)
for sc, cc in CRON_SCRAPERS:
    s_n = count("shortage_events", cc)
    r_n = count("recalls", cc)
    print(f"{sc:<22} {cc:<4} {s_n:>16} {r_n:>10}")
