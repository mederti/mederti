"""Revert catalogue_inn_backfill writes using the manifest.
Only nulls rows that STILL hold exactly the drug_id we wrote (guards against
clobbering any legitimate link set since)."""
import os, json, sys, urllib.request
from collections import defaultdict

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

manifest = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "catalogue_inn_backfill_manifest.json"))
by_drug = defaultdict(list)
for r in manifest:
    by_drug[r["drug_id"]].append(r["catalogue_id"])
print(f"reverting {len(manifest)} rows across {len(by_drug)} drugs")

def patch(path):
    req = urllib.request.Request(URL + "/rest/v1/" + path, data=json.dumps({"drug_id": None}).encode(),
                                 headers={**H, "Prefer": "return=minimal"}, method="PATCH")
    urllib.request.urlopen(req, timeout=120).read()

done = 0
for did, cids in by_drug.items():
    for i in range(0, len(cids), 100):
        chunk = ",".join(cids[i:i+100])
        patch(f"drug_catalogue?id=in.({chunk})&drug_id=eq.{did}")
        done += len(cids[i:i+100])
print(f"reverted {done} rows to drug_id=NULL")
