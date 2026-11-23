"""
Shared loading and evaluation helpers for the signal backtests
(count_rule_backtest.py, ct_termination_backtest.py). Read-only: works on the
local JSON snapshot written by extract_shortage_history.py.

Drug identity
─────────────
A shortage row's drug is resolved to an INN by exact string identity only:
    1. drugs.resolved_inn, lower-cased;
    2. else the drug's own generic name, if it equals some drug's resolved_inn;
    3. else the drug's generic name, if it equals a drug_synonyms entry whose
       drug has a resolved_inn.
No prefix, stem or fuzzy matching, and canonical_drug_id is never followed.
Rows that do not resolve are dropped and counted (see coverage()).

Events
──────
Only each market's primary national shortage feed is used. shortage_events
also holds rows from other feeds for some markets (US: 228 rows from "FDA Drug
Enforcement — Foreign Manufacturer Recalls", not flagged synthetic), which
are recalls, not shortages. Synthetic rows are excluded at extract time;
anticipated rows are excluded here (they are not shortage starts).
"""
from __future__ import annotations

import json
import math
import os
import random
import re
from collections import defaultdict
from datetime import date

# Primary national shortage feed per market (data_sources.id suffix).
PRIMARY_SOURCE = {
    "US": "10000000-0000-0000-0000-000000000001",  # FDA Drug Shortages
    "CA": "10000000-0000-0000-0000-000000000002",  # Drug Shortages Canada
    "AU": "10000000-0000-0000-0000-000000000003",  # TGA MSI
    "GB": "10000000-0000-0000-0000-000000000006",  # MHRA
    "FR": "10000000-0000-0000-0000-000000000007",  # ANSM
    "DE": "10000000-0000-0000-0000-000000000008",  # BfArM
    "IT": "10000000-0000-0000-0000-000000000009",  # AIFA
    "ES": "10000000-0000-0000-0000-000000000010",  # AEMPS
}
MARKETS = list(PRIMARY_SOURCE)
HORIZON_DAYS = 90


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().replace("\xa0", " ")).strip()


def d(v) -> date | None:
    return date.fromisoformat(str(v)[:10]) if v else None


def load(data_dir: str) -> dict:
    j = lambda n: json.load(open(os.path.join(data_dir, f"{n}.json")))  # noqa: E731
    drugs, syns, events = j("drugs"), j("drug_synonyms"), j("shortage_events")

    inn_of_drug = {r["id"]: norm(r["resolved_inn"]) for r in drugs if r.get("resolved_inn")}
    inns = set(inn_of_drug.values())
    syn_to_inn: dict[str, set[str]] = defaultdict(set)
    for s in syns:
        if s["drug_id"] in inn_of_drug:
            syn_to_inn[norm(s.get("synonym_normalised") or s["synonym"])].add(inn_of_drug[s["drug_id"]])
    unit: dict[str, str] = {}
    how = defaultdict(int)
    for r in drugs:
        if r["id"] in inn_of_drug:
            unit[r["id"]] = inn_of_drug[r["id"]]
            how["resolved_inn"] += 1
            continue
        name = norm(r.get("generic_name_normalised") or r.get("generic_name"))
        if name in inns:
            unit[r["id"]] = name
            how["name_equals_inn"] += 1
        elif len(syn_to_inn.get(name, ())) == 1:
            unit[r["id"]] = next(iter(syn_to_inn[name]))
            how["exact_synonym"] += 1

    rows, dropped = [], defaultdict(lambda: defaultdict(int))
    for e in events:
        cc = e.get("country_code")
        if cc not in PRIMARY_SOURCE or e["status"] == "anticipated":
            continue
        if e.get("data_source_id") != PRIMARY_SOURCE[cc]:
            dropped[cc]["other_feed"] += 1
            continue
        u = unit.get(e["drug_id"])
        sd = d(e.get("start_date"))
        if u is None or sd is None:
            dropped[cc]["unresolved_drug" if u is None else "no_start"] += 1
            continue
        rows.append({"cc": cc, "unit": u, "start": sd, "end": d(e.get("end_date")),
                     "status": e["status"], "created": d(e.get("created_at"))})
        dropped[cc]["kept"] += 1
    return {"rows": rows, "units": sorted(inns), "coverage": dropped, "resolution": dict(how)}


def month_starts(first: date, last: date) -> list[date]:
    out, y, m = [], first.year, first.month
    while date(y, m, 1) <= last:
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def add_days(t: date, n: int) -> date:
    return date.fromordinal(t.toordinal() + n)


def add_months(t: date, n: int) -> date:
    y, m = divmod(t.month - 1 + n, 12)
    return date(t.year + y, m + 1, 1)


def short_on(r: dict, t: date) -> bool:
    """Short on day t: started by then and not yet ended. A resolved row with no
    end date has an unknown end, so it is not counted as short."""
    if r["start"] > t:
        return False
    if r["end"] is None:
        return r["status"] != "resolved"
    return r["end"] > t


class Market:
    """Per-market index of rows by unit, for point-in-time queries."""

    def __init__(self, rows: list[dict], cc: str) -> None:
        self.cc = cc
        self.by_unit: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            if r["cc"] == cc:
                self.by_unit[r["unit"]].append(r)

    def prior_count(self, u: str, t: date, months: int = 12, known_by: bool = False) -> int:
        lo = add_months(t, -months)
        return sum(1 for r in self.by_unit.get(u, ())
                   if lo <= r["start"] <= t and (not known_by or (r["created"] or r["start"]) <= t))

    def short(self, u: str, t: date) -> bool:
        return any(short_on(r, t) for r in self.by_unit.get(u, ()))

    def new_start(self, u: str, t: date, horizon: int = HORIZON_DAYS) -> date | None:
        hi = add_days(t, horizon)
        s = [r["start"] for r in self.by_unit.get(u, ()) if t < r["start"] <= hi]
        return min(s) if s else None


# ── Statistics ───────────────────────────────────────────────────────────────
def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, c - h), min(1.0, c + h))


def precision_at_k(scores: list[tuple[float, bool]], k: int, zero_neg: int = 0) -> float:
    """Expected precision@k under random tie-breaking: ties straddling the
    cut-off contribute their mean hit rate, so ties never flatter a rule.
    `zero_neg` adds that many score-0 negatives without materialising them."""
    if not scores and not zero_neg:
        return float("nan")
    k = min(k, len(scores) + zero_neg)
    by: dict[float, list[int]] = defaultdict(lambda: [0, 0])   # score → [n, hits]
    for s, y in scores:
        by[s][0] += 1
        by[s][1] += y
    by[0.0][0] += zero_neg
    taken = hits = 0.0
    for s in sorted(by, reverse=True):
        n, h = by[s]
        if not n:
            continue
        if taken + n <= k:
            hits += h
            taken += n
        else:
            hits += (k - taken) * h / n
            taken = k
        if taken >= k:
            break
    return hits / k


def bootstrap(stat, clusters: list, n: int = 1000, seed: int = 7) -> tuple[float, float]:
    """95% percentile CI, resampling whole clusters (drug units) with replacement,
    because the same drug recurs across months and is not independent."""
    rnd = random.Random(seed)
    vals = []
    for _ in range(n):
        sample = [clusters[rnd.randrange(len(clusters))] for _ in clusters]
        v = stat(sample)
        if v == v:  # not NaN
            vals.append(v)
    vals.sort()
    if not vals:
        return (float("nan"), float("nan"))
    return (vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1])
