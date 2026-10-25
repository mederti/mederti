"""
ClinicalTrials.gov fetch for the trial-termination precursor backtest
(docs/research/shortage-signal-backtest.md, part 2). Read-only, public API.

The dormant backend/scrapers/clinicaltrials_scraper.py is not usable here: it
filters to RECRUITING/ACTIVE/COMPLETED/UNKNOWN Phase 3–4 trials, i.e. it drops
exactly the TERMINATED / SUSPENDED / WITHDRAWN trials this test needs.

Per INN unit (from the shortage snapshot) this stores:
    stopped    TERMINATED | SUSPENDED | WITHDRAWN studies last updated 2023-01-01+
    completed  COMPLETED studies last updated 2023-01-01+  (activity control)
    total      count of all registered studies, any status (volume control)
A study is kept only if one of its DRUG / BIOLOGICAL / COMBINATION_PRODUCT
interventions names the INN as whole words (name or otherNames). CT.gov's own
query.intr search expands synonyms, so its raw hits are post-filtered.

Results cache to OUT_DIR/ct/<inn>.json, so the run is resumable.

Usage:
    python3 -m backend.analysis.research.fetch_ct_trials DATA_DIR
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from backend.analysis.research.signal_common import load

API = "https://clinicaltrials.gov/api/v2/studies"
FIELDS = ",".join([
    "protocolSection.identificationModule.nctId",
    "protocolSection.statusModule.overallStatus",
    "protocolSection.statusModule.whyStopped",
    "protocolSection.statusModule.statusVerifiedDate",
    "protocolSection.statusModule.startDateStruct",
    "protocolSection.statusModule.primaryCompletionDateStruct",
    "protocolSection.statusModule.completionDateStruct",
    "protocolSection.statusModule.lastUpdatePostDateStruct",
    "protocolSection.armsInterventionsModule.interventions",
    "protocolSection.designModule.phases",
    "protocolSection.sponsorCollaboratorsModule.leadSponsor",
])
SINCE = "2023-01-01"
DRUG_TYPES = {"DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT"}


def _get(client: httpx.Client, params: dict) -> dict:
    for attempt in range(5):
        try:
            r = client.get(API, params=params)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
        except httpx.TransportError:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"CT.gov failed: {params}")


def _pages(client: httpx.Client, inn: str, status: str) -> list[dict]:
    params = {"query.intr": inn, "filter.overallStatus": status, "pageSize": 1000, "fields": FIELDS,
              "filter.advanced": f"AREA[LastUpdatePostDate]RANGE[{SINCE},MAX]"}
    out = []
    while True:
        j = _get(client, params)
        out += j.get("studies", [])
        if not j.get("nextPageToken"):
            return out
        params["pageToken"] = j["nextPageToken"]


def names_inn(study: dict, pat: re.Pattern) -> bool:
    for iv in study.get("protocolSection", {}).get("armsInterventionsModule", {}).get("interventions", []) or []:
        if iv.get("type") not in DRUG_TYPES:
            continue
        for n in [iv.get("name") or ""] + (iv.get("otherNames") or []):
            if pat.search(n.lower()):
                return True
    return False


def slim(study: dict) -> dict:
    p = study["protocolSection"]
    s = p["statusModule"]
    g = lambda k: (s.get(k) or {}).get("date"), lambda k: (s.get(k) or {}).get("type")  # noqa: E731
    return {
        "nct": p["identificationModule"]["nctId"], "status": s.get("overallStatus"),
        "why": s.get("whyStopped"), "verified": s.get("statusVerifiedDate"),
        "start": g[0]("startDateStruct"), "completion": g[0]("completionDateStruct"),
        "completion_type": g[1]("completionDateStruct"),
        "primary_completion": g[0]("primaryCompletionDateStruct"),
        "last_update": g[0]("lastUpdatePostDateStruct"),
        "phases": (p.get("designModule") or {}).get("phases"),
        "sponsor_class": ((p.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}).get("class"),
    }


def fetch_one(inn: str, out_dir: str) -> str:
    path = os.path.join(out_dir, re.sub(r"[^a-z0-9]+", "_", inn) + ".json")
    if os.path.exists(path):
        return "cached"
    pat = re.compile(r"(?<![a-z0-9])" + re.escape(inn) + r"(?![a-z0-9])")
    with httpx.Client(timeout=60, headers={"User-Agent": "MedertiResearch/1.0 (+https://mederti.com)"}) as c:
        stopped = [slim(s) for s in _pages(c, inn, "TERMINATED|SUSPENDED|WITHDRAWN") if names_inn(s, pat)]
        completed = [slim(s) for s in _pages(c, inn, "COMPLETED") if names_inn(s, pat)]
        total = _get(c, {"query.intr": inn, "pageSize": 1, "countTotal": "true",
                         "fields": "protocolSection.identificationModule.nctId"}).get("totalCount", 0)
    tmp = path + ".tmp"
    json.dump({"inn": inn, "stopped": stopped, "completed": completed, "total_any_status": total}, open(tmp, "w"))
    os.replace(tmp, path)
    return f"{len(stopped)} stopped / {len(completed)} completed / {total} total"


def main(data_dir: str) -> int:
    out_dir = os.path.join(data_dir, "ct")
    os.makedirs(out_dir, exist_ok=True)
    units = load(data_dir)["units"]
    print(f"{len(units)} INN units")
    done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for inn, res in zip(units, ex.map(lambda u: _safe(u, out_dir), units)):
            done += 1
            if done % 50 == 0 or not res.startswith(("cached", "0 ")):
                print(f"[{done}/{len(units)}] {inn}: {res}", flush=True)
    return 0


def _safe(u: str, out_dir: str) -> str:
    try:
        return fetch_one(u, out_dir)
    except Exception as exc:  # noqa: BLE001 — logged, retried on the next run
        return f"ERROR {exc}"


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
