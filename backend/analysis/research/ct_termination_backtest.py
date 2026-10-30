"""
Clinical-trial termination precursor backtest
(docs/research/shortage-signal-backtest.md, part 2)
────────────────────────────────────────────────────────────────────────────────
Hypothesis (github.com/abhayrohilla68-sketch/pfie-signal-research, 2 of 11
drugs): a drug with a ClinicalTrials.gov trial going TERMINATED, SUSPENDED or
WITHDRAWN 3–18 months earlier is more likely to enter shortage.

Signal on month T for an INN unit:
    flag     ≥1 stopped study naming the INN with stop date in [T−18m, T−3m]
    stop date = completion date when CT.gov marks it ACTUAL, else the
                status-verified month. The 3-month minimum lag covers the
                30-day FDAAA status-update rule, so the signal was public by T.
    --strict  additionally requires the study's last update to be posted by T
              (a sufficient condition for the stopped status being public).
Outcome and population are the count-rule backtest's primary ones: units not
short in the market on T; positive = a shortage starts there in (T, T+90d].

Controls, because drugs with many trials are big, widely used drugs:
    supply-reason  stopped studies whose whyStopped mentions supply/manufacturing
    completed      ≥1 COMPLETED study in the same window (trial activity alone)
    MH risk ratio  flagged vs unflagged, within market, stratified by
                   count-rule score (0 / 1 / 2+), by trial volume (quintiles of
                   all registered studies), and jointly by volume × completed
                   flag × count score ("activity")
CIs: Wilson for proportions, unit-clustered bootstrap for ratios.

Usage:
    python3 -m backend.analysis.research.ct_termination_backtest DATA_DIR [--strict] [--json OUT]
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from datetime import date

import numpy as np

from backend.analysis.research.count_rule_backtest import PERIODS
from backend.analysis.research.signal_common import (
    MARKETS, Market, add_months, load, precision_at_k, wilson)

SUPPLY_WHY = re.compile(r"suppl|manufactur|shortage|availab|stock|production|procure", re.I)
LAG_MIN, LAG_MAX = 3, 18   # months, fixed before looking at any result
BOOT = 1000


def _pd(v: str | None) -> date | None:
    if not v:
        return None
    p = v.split("-")
    return date(int(p[0]), int(p[1]) if len(p) > 1 else 1, int(p[2]) if len(p) > 2 else 1)


def load_ct(data_dir: str, units: list[str]) -> dict[str, dict]:
    out = {}
    for u in units:
        path = os.path.join(data_dir, "ct", re.sub(r"[^a-z0-9]+", "_", u) + ".json")
        if not os.path.exists(path):
            continue
        j = json.load(open(path))
        stopped = []
        for s in j["stopped"]:
            stop = _pd(s["completion"]) if s.get("completion_type") == "ACTUAL" else _pd(s["verified"])
            if stop:
                stopped.append({"stop": stop, "posted": _pd(s["last_update"]),
                                "supply": bool(SUPPLY_WHY.search(s.get("why") or ""))})
        completed = [_pd(s["completion"]) for s in j["completed"] if s.get("completion_type") == "ACTUAL"]
        out[u] = {"stopped": stopped, "completed": [c for c in completed if c], "total": j["total_any_status"]}
    return out


def flags(ct: dict | None, t: date, strict: bool) -> dict[str, bool]:
    if ct is None:
        return {"stopped": False, "supply": False, "completed": False}
    lo, hi = add_months(t, -LAG_MAX), add_months(t, -LAG_MIN)
    hits = [s for s in ct["stopped"] if lo <= s["stop"] <= hi and (not strict or (s["posted"] and s["posted"] <= t))]
    return {"stopped": bool(hits), "supply": any(s["supply"] for s in hits),
            "completed": any(lo <= c <= hi for c in ct["completed"])}


def _cells(recs: list[dict], sig: str, strata) -> tuple[list, "np.ndarray"]:
    """Per-cluster 2×2 cells: array [cluster, stratum, (a, n1, c, n0)]."""
    cl_ix: dict[str, int] = {}
    st_ix: dict = {}
    for r in recs:
        cl_ix.setdefault(r["u"], len(cl_ix))
        st_ix.setdefault(strata(r), len(st_ix))
    arr = np.zeros((len(cl_ix), len(st_ix), 4))
    for r in recs:
        x = arr[cl_ix[r["u"]], st_ix[strata(r)]]
        if r[sig]:
            x[0] += r["y"]; x[1] += 1   # noqa: E702
        else:
            x[2] += r["y"]; x[3] += 1   # noqa: E702
    return list(cl_ix), arr


def _rr(cells: "np.ndarray") -> float:
    """Mantel–Haenszel risk ratio from summed [stratum, (a, n1, c, n0)] cells.
    With a single stratum it is the plain risk ratio."""
    a, n1, c, n0 = cells.T
    n = n1 + n0
    ok = n > 0
    num = (a[ok] * n0[ok] / n[ok]).sum()
    den = (c[ok] * n1[ok] / n[ok]).sum()
    return float(num / den) if den else float("nan")


def _boot(arr: "np.ndarray", stat, n: int = BOOT, seed: int = 7) -> tuple[float, float]:
    """95% percentile CI resampling whole clusters (market × drug): the same drug
    recurs every month, so unit-months are not independent."""
    rng = np.random.default_rng(seed)
    k = arr.shape[0]
    vals = []
    for _ in range(n):
        w = np.bincount(rng.integers(0, k, k), minlength=k)
        v = stat(np.tensordot(w, arr, axes=1))
        if v == v:
            vals.append(v)
    if not vals:
        return (float("nan"), float("nan"))
    return (float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5)))


def summarise(recs: list[dict], vol_cut: list[int]) -> dict:
    mkt = lambda r: r["u"].split(":")[0]  # noqa: E731
    vq = lambda r: sum(r["vol"] > c for c in vol_cut)  # noqa: E731
    strata = {
        "crude": mkt,
        "count": lambda r: (mkt(r), min(r["s"], 2)),
        "volume": lambda r: (mkt(r), vq(r)),
        # The decisive control: same market, same trial volume quintile, same
        # "had a trial complete in the window" status, same count-rule bucket.
        "activity": lambda r: (mkt(r), vq(r), r["completed"], min(r["s"], 2)),
    }
    pos = sum(r["y"] for r in recs)
    base = pos / len(recs) if recs else float("nan")
    res = {"n": len(recs), "positives": pos, "base_rate": base, "base_ci": wilson(pos, len(recs))}
    by_mt: dict = defaultdict(list)
    for r in recs:
        by_mt[(mkt(r), r["t"])].append(r)
    for sig in ("stopped", "supply", "completed"):
        fl = [r for r in recs if r[sig]]
        h = sum(r["y"] for r in fl)
        un = [r for r in recs if not r[sig]]
        x = {
            "flagged": len(fl), "hits": h,
            "precision": h / len(fl) if fl else float("nan"), "precision_ci": wilson(h, len(fl)),
            "recall": h / pos if pos else float("nan"), "recall_ci": wilson(h, pos),
            "unflagged_rate": sum(r["y"] for r in un) / len(un) if un else float("nan"),
            "lift": (h / len(fl)) / base if fl and base else float("nan"),
        }
        # Lift vs base = P(y|flag) / P(y); bootstrap it on crude cells.
        _, crude = _cells(recs, sig, lambda r: 0)
        lift = lambda c: (c[0, 0] / c[0, 1]) / ((c[0, 0] + c[0, 2]) / (c[0, 1] + c[0, 3])) if c[0, 1] and c[0, 0] + c[0, 2] else float("nan")  # noqa: E731
        x["lift_ci"] = _boot(crude, lift)
        for name, fn in strata.items():
            _, arr = _cells(recs, sig, fn)
            x[f"rr_{name}"] = _rr(arr.sum(axis=0))
            x[f"rr_{name}_ci"] = _boot(arr, _rr)
        # Count rule at the same alert budget: per market-month, top-k where
        # k = how many the signal flagged that market-month.
        num = den = 0.0
        for rs in by_mt.values():
            k = sum(r[sig] for r in rs)
            if k:
                num += precision_at_k([(r["s"], r["y"]) for r in rs], k) * k
                den += k
        x["count_rule_precision_same_k"] = num / den if den else float("nan")
        # Incremental value: the signal as a tie-breaker inside count-rule ranks
        # (score = count + 0.5 × flag) vs the count rule alone, mean P@k per market-month.
        for k in (10, 25, 50):
            a = [precision_at_k([(r["s"], r["y"]) for r in rs], k) for rs in by_mt.values()]
            b = [precision_at_k([(r["s"] + 0.5 * r[sig], r["y"]) for r in rs], k) for rs in by_mt.values()]
            x[f"p@{k}_count"], x[f"p@{k}_count_plus"] = sum(a) / len(a), sum(b) / len(b)
            diff = np.array(b) - np.array(a)
            rng = np.random.default_rng(7)
            boots = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(BOOT)]
            x[f"p@{k}_delta_ci"] = (float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5)))
        res[sig] = x
    return res


def main(argv: list[str]) -> int:
    data_dir = argv[1]
    strict = "--strict" in argv
    out_path = argv[argv.index("--json") + 1] if "--json" in argv else None
    data = load(data_dir)
    ct = load_ct(data_dir, data["units"])
    units = [u for u in data["units"] if u in ct]
    print(f"CT data for {len(units)}/{len(data['units'])} INN units; strict={strict}")
    vols = sorted(ct[u]["total"] for u in units)
    vol_cut = [vols[i * len(vols) // 5] for i in range(1, 5)]   # quintiles of all-status study count
    results: dict = {}
    pooled: dict[str, list[dict]] = defaultdict(list)
    for cc in MARKETS:
        mk = Market(data["rows"], cc)
        for period, months in PERIODS.items():
            recs = []
            for t in months:
                for u in units:
                    if mk.short(u, t):
                        continue
                    f = flags(ct[u], t, strict)
                    recs.append({"u": f"{cc}:{u}", "t": t, "y": mk.new_start(u, t) is not None,
                                 "s": mk.prior_count(u, t), "vol": ct[u]["total"], **f})
            pooled[period] += recs
            results[f"{cc}|{period}"] = r = summarise(recs, vol_cut)
            s = r["stopped"]
            print(f"{cc} {period:7s} base {100*r['base_rate']:.2f}% | stopped-flag {s['flagged']} unit-months, "
                  f"precision {100*s['precision']:.1f}% [{100*s['precision_ci'][0]:.1f}–{100*s['precision_ci'][1]:.1f}] "
                  f"lift {s['lift']:.2f} [{s['lift_ci'][0]:.2f}–{s['lift_ci'][1]:.2f}] "
                  f"recall {100*s['recall']:.0f}% | count rule same k {100*s['count_rule_precision_same_k']:.1f}% | "
                  f"completed lift {r['completed']['lift']:.2f}")
    # Pooled across markets: unit ids carry the market, so clusters stay market × drug;
    # MH strata add the market so a high-base-rate market cannot fake an effect.
    for period, recs in pooled.items():
        r = summarise(recs, vol_cut)
        results[f"ALL|{period}"] = r
        for sig in ("stopped", "supply", "completed"):
            x = r[sig]
            print(f"ALL {period:7s} {sig:9s} flagged {x['flagged']:6d} precision {100*x['precision']:.2f}% "
                  f"[{100*x['precision_ci'][0]:.2f}–{100*x['precision_ci'][1]:.2f}] vs unflagged {100*x['unflagged_rate']:.2f}% "
                  f"lift {x['lift']:.2f} [{x['lift_ci'][0]:.2f}–{x['lift_ci'][1]:.2f}] "
                  f"RR|mkt {x['rr_crude']:.2f} [{x['rr_crude_ci'][0]:.2f}–{x['rr_crude_ci'][1]:.2f}] "
                  f"RR|count {x['rr_count']:.2f} [{x['rr_count_ci'][0]:.2f}–{x['rr_count_ci'][1]:.2f}] "
                  f"RR|volume {x['rr_volume']:.2f} [{x['rr_volume_ci'][0]:.2f}–{x['rr_volume_ci'][1]:.2f}] "
                  f"RR|activity {x['rr_activity']:.2f} [{x['rr_activity_ci'][0]:.2f}–{x['rr_activity_ci'][1]:.2f}] "
                  f"recall {100*x['recall']:.0f}% | count rule same k {100*x['count_rule_precision_same_k']:.1f}% | "
                  + " ".join(f"P@{k} count {100*x[f'p@{k}_count']:.1f}% → +{sig} {100*x[f'p@{k}_count_plus']:.1f}% "
                           f"(Δ CI {100*x[f'p@{k}_delta_ci'][0]:+.1f}…{100*x[f'p@{k}_delta_ci'][1]:+.1f})" for k in (10, 25, 50)))
    if out_path:
        json.dump(results, open(out_path, "w"), default=str, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
