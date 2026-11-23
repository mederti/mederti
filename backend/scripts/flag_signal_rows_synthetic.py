#!/usr/bin/env python3
"""
Flag recall- and transfer-derived rows in shortage_events as synthetic.

The FDA Drug Enforcement scrapers (data sources ...0024 Foreign Manufacturer
Recalls, ...0025 Full Recall Database) write recalls into shortage_events as
"[SUPPLY-SIDE SIGNAL]" rows. repair_inflated_active_counts flagged the MedWatch
copies synthetic; these two sources were missed, so 41 open rows still counted
as US shortages, e.g. a 2014 propofol recall shown as an "Anticipated shortage"
(2026-11-10). Recalls live in `recalls`; here they are signals, not shortages.

Dry run by default; --execute writes. Only rows still open and not yet
synthetic are touched; the ids are written to a revert file first.
"""
import json
import os
import sys
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
SOURCES = ("10000000-0000-0000-0000-000000000024", "10000000-0000-0000-0000-000000000025")
EXECUTE = "--execute" in sys.argv


def req(method, path, body=None):
    r = urllib.request.Request(URL + "/rest/v1/" + path, method=method,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={**H, "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []


# Every open row derived from a non-shortage record: FDA enforcement recalls,
# recall auto-creates, and HSA Singapore licence transfers (HSA publishes no
# shortage list; a change of registrant is not a shortage).
FILTER = ("status=in.(active,anticipated)"
          "&and=(or(synthetic.is.null,synthetic.eq.false),"
          "or(notes.like.%5BSUPPLY-SIDE%20SIGNAL%5D*,notes.like.Auto-generated%20from%20Class%20I%20recall*))")
rows = req("GET", f"shortage_events?select=id,country_code,status,start_date,drug_id,notes&{FILTER}&limit=1000")
print(f"{'EXECUTE' if EXECUTE else 'DRY RUN'}: {len(rows)} open enforcement-recall rows not flagged synthetic")
for r in rows[:10]:
    print(f"  {r['country_code']} {r['status']:11s} {r['start_date']}  {((r['notes'] or '').splitlines() or [''])[0][:60]}")
from collections import Counter
print("  by country/kind:", dict(Counter((r["country_code"], ((r["notes"] or "").splitlines() or [""])[0][:33]) for r in rows)))
if not EXECUTE or not rows:
    sys.exit(0)
with open("flag_enforcement_recall_manifest.json", "w") as f:
    json.dump([r["id"] for r in rows], f)
ids = [r["id"] for r in rows]
done = 0
for i in range(0, len(ids), 100):
    out = req("PATCH", f"shortage_events?id=in.({','.join(ids[i:i+100])})&or=(synthetic.is.null,synthetic.eq.false)",
              {"synthetic": True})
    done += len(out)
print(f"flagged {done} rows synthetic; revert ids in flag_enforcement_recall_manifest.json")
