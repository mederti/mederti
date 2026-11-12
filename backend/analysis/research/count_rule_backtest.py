"""
Count-rule baseline backtest  (docs/research/shortage-signal-backtest.md, part 1)
────────────────────────────────────────────────────────────────────────────────
The rule from github.com/PickettAnalytics/drug-shortage-forecast: at the start
of each month T, rank drugs in a market by how many shortage events they had
there in the prior 12 months. Outcome: a new shortage starts in that market in
(T, T+90d]. Any future risk score has to beat this.

Two outcome definitions:
    new_episode  only drugs NOT short in the market on T are ranked; positive =
                 a shortage starts in (T, T+90d]  (primary: "what goes short next")
    any_start    every drug ranked; positive = any shortage row starts in the
                 window, including a further presentation of one already short

The rule has no parameters, so nothing is fitted. Periods are still split in
time and reported separately:
    dev      T = 2025-01 … 2025-12  outcome reconstructed from back-filled history
    holdout  T = 2026-01 … 2026-07  outcome observed while the scrapers were live
History before Feb 2026 is back-filled from what each feed still lists, so
resolved shortages that a feed has since dropped are missing (survivorship).
The holdout is the trustworthy number.

Leak check: --known-by counts a prior event only if Mederti had stored it by T
(created_at ≤ T), i.e. what the product itself could have shown on T.

Usage:
    python3 -m backend.analysis.research.count_rule_backtest DATA_DIR [--known-by] [--json OUT]
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date

from backend.analysis.research.signal_common import (
    MARKETS, Market, add_days, bootstrap, load, month_starts, precision_at_k, wilson)

PERIODS = {
    "dev": month_starts(date(2025, 1, 1), date(2025, 12, 1)),
    "holdout": month_starts(date(2026, 1, 1), date(2026, 7, 1)),
}
KS = (10, 25, 50)
DATA_END = date(2026, 10, 25)   # snapshot date; every outcome window must close by then


def panel(mk: Market, units: list[str], months: list[date], outcome: str, known_by: bool) -> list[dict]:
    """One record per (unit, month): score, label. Units with no history in this
    market and no outcome are all-zero negatives; they are kept as a count."""
    out = []
    for t in months:
        assert add_days(t, 90) <= DATA_END
        for u in units:
            if outcome == "new_episode" and mk.short(u, t):
                continue
            y = mk.new_start(u, t) is not None
            out.append({"u": u, "t": t, "s": mk.prior_count(u, t, known_by=known_by), "y": y})
    return out


def evaluate(recs: list[dict]) -> dict:
    by_t: dict[date, list[tuple[float, bool]]] = defaultdict(list)
    for r in recs:
        by_t[r["t"]].append((r["s"], r["y"]))
    res = {"months": len(by_t), "eligible_per_month": round(len(recs) / max(1, len(by_t)))}
    pos = sum(r["y"] for r in recs)
    res["base_rate"] = pos / len(recs) if recs else float("nan")
    res["positives_per_month"] = pos / max(1, len(by_t))
    scored = [r for r in recs if r["s"] > 0]
    res["scored_per_month"] = len(scored) / max(1, len(by_t))
    res["p_scored"] = sum(r["y"] for r in scored) / len(scored) if scored else float("nan")
    res["p_scored_ci"] = wilson(sum(r["y"] for r in scored), len(scored))
    unscored = [r for r in recs if r["s"] == 0]
    res["p_unscored"] = sum(r["y"] for r in unscored) / len(unscored) if unscored else float("nan")
    res["recall_scored"] = sum(r["y"] for r in scored) / pos if pos else float("nan")
    for k in KS:
        p = [precision_at_k(v, k) for v in by_t.values()]
        res[f"p@{k}"] = sum(p) / len(p)
        res[f"lift@{k}"] = res[f"p@{k}"] / res["base_rate"] if res["base_rate"] else float("nan")
    return res


def with_ci(recs: list[dict]) -> dict:
    res = evaluate(recs)
    clusters_d: dict[str, list[dict]] = defaultdict(list)
    for r in recs:
        clusters_d[r["u"]].append(r)
    # All-zero, never-positive units only add to the tied bottom; resample the rest.
    active = [v for v in clusters_d.values() if any(r["s"] or r["y"] for r in v)]
    inert: dict[date, int] = defaultdict(int)
    for v in clusters_d.values():
        if not any(r["s"] or r["y"] for r in v):
            for r in v:
                inert[r["t"]] += 1
    for k in KS:
        def stat(sample, k=k):
            return evaluate_k([r for c in sample for r in c], k, inert)
        res[f"p@{k}_ci"] = bootstrap(stat, active, n=300)
    hits = sum(r["y"] for r in recs)
    res["base_rate_ci"] = wilson(hits, len(recs))
    return res


def evaluate_k(recs: list[dict], k: int, inert: dict[date, int]) -> float:
    by_t: dict[date, list[tuple[float, bool]]] = {t: [] for t in inert}
    for r in recs:
        by_t.setdefault(r["t"], []).append((r["s"], r["y"]))
    p = [precision_at_k(v, k, inert.get(t, 0)) for t, v in by_t.items()]
    return sum(p) / len(p) if p else float("nan")


def main(argv: list[str]) -> int:
    data_dir = argv[1]
    known_by = "--known-by" in argv
    out_path = argv[argv.index("--json") + 1] if "--json" in argv else None
    data = load(data_dir)
    units = data["units"]
    print(f"INN units: {len(units):,}; drug resolution: {data['resolution']}")
    for cc in MARKETS:
        print(f"  {cc} rows: {dict(data['coverage'][cc])}")
    results: dict = {}
    for cc in MARKETS:
        mk = Market(data["rows"], cc)
        for outcome in ("new_episode", "any_start"):
            for period, months in PERIODS.items():
                recs = panel(mk, units, months, outcome, known_by)
                r = with_ci(recs)
                results[f"{cc}|{outcome}|{period}"] = r
                print(f"   [{outcome}] scored>0 {r['scored_per_month']:.0f}/mo hit {100*r['p_scored']:.1f}% vs "
                      f"unscored {100*r['p_unscored']:.2f}%; recall of scored {100*r['recall_scored']:.0f}%")
                if True:
                    print(f"{cc} {period:7s} base {100*r['base_rate']:.2f}% ({r['positives_per_month']:.1f}/mo of "
                          f"{r['eligible_per_month']})  " + "  ".join(
                              f"P@{k} {100*r[f'p@{k}']:.0f}% [{100*r[f'p@{k}_ci'][0]:.0f}–{100*r[f'p@{k}_ci'][1]:.0f}]"
                              for k in KS))
    if out_path:
        json.dump(results, open(out_path, "w"), default=str, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
