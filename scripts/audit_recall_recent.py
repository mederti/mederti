"""Did the live recall run add rows?"""
import os, httpx
from datetime import datetime, timedelta, timezone

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=exact", "Range": "0-0", "Range-Unit": "items"}

cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
for cc in ["IT", "FR", "ES", "DE"]:
    r = httpx.get(f"{URL}/rest/v1/recalls", headers=H,
                  params={"select": "id", "country_code": f"eq.{cc}", "created_at": f"gte.{cutoff}"}, timeout=30)
    n = r.headers.get("content-range", "0/0").split("/")[-1]
    print(f"{cc}: {n} recalls created in last 30 min")
