"""
Risk score backtest (Phase 2, docs/portfolio-risk-score-scope.md §4)
────────────────────────────────────────────────────────────────────────────────
Scores every molecule AS OF a past date T using only shortage and recall data
from before T, then checks the outcome over the next HORIZON days:

    onset = a shortage STARTS in a country where the molecule was not already
            short on T (distinct countries; start_date from the regulator)

Reported per fold: onset rate by band and lift over the base rate, precision
of the top 25 by supply vulnerability, and the same for two baselines —
"already short in the most countries on T" (breadth alone) and the base rate
(random). The score only earns a predictive claim if it beats breadth, not
just random.

Known leak, stated in every report: supplier inputs (FDA DMF, DECRS, approvals)
and list membership are today's snapshot; there is no history of them.
inn_risk_score_history removes this leak going forward.

Usage:
    python3 -m backend.analysis.risk_backtest            # prints + writes docs/risk-score-backtest.md
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import date, timedelta
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.analysis.risk_score import (  # noqa: E402
    MODEL_VERSION, TODAY, assemble, build_universe, score,
)
from backend.utils.db import get_supabase_client  # noqa: E402

HORIZON = 180
FOLDS = [TODAY - timedelta(days=HORIZON), TODAY - timedelta(days=2 * HORIZON)]
TOP_N = 25
BANDS = ("high_risk", "risk", "caution", "low")
LEAD_MARKETS = ("US", "AU", "GB", "CA")


def fold(db, molecules, as_of: date) -> dict:
    end = as_of + timedelta(days=HORIZON)
    data = assemble(db, molecules, as_of=as_of)
    out = []
    for m in molecules:
        d = data[id(m)]
        r = score(m, d, today=as_of)
        if r["supply_vulnerability"] is None:
            continue
        short_at_t = set(r["short_countries"])
        onsets = {}
        for cc, _status, sd, _ed in d["rows"]:
            if as_of < sd <= end and cc not in short_at_t:
                onsets[cc] = min(onsets.get(cc, sd), sd)
        out.append({"inn": r["inn"], "band": r["band"], "sv": r["supply_vulnerability"],
                    "breadth": len(short_at_t), "onsets": onsets})

    n = len(out)
    hit = lambda rows: sum(1 for x in rows if x["onsets"])  # noqa: E731
    base = hit(out) / n if n else 0.0

    by_band = {}
    for b in BANDS:
        rows = [x for x in out if x["band"] == b]
        rate = hit(rows) / len(rows) if rows else None
        by_band[b] = {"n": len(rows), "rate": rate,
                      "lift": (rate / base) if rate is not None and base else None,
                      "mean_new_countries": (sum(len(x["onsets"]) for x in rows) / len(rows)) if rows else None}

    top_score = sorted(out, key=lambda x: -x["sv"])[:TOP_N]
    top_breadth = sorted(out, key=lambda x: (-x["breadth"], -x["sv"]))[:TOP_N]

    # Lead time: molecules banded high_risk/risk on T that then started a
    # shortage in a major market — days from our flag to that market's start.
    leads = {}
    for x in out:
        if x["band"] in ("high_risk", "risk"):
            for cc in LEAD_MARKETS:
                if cc in x["onsets"]:
                    leads.setdefault(cc, []).append((x["onsets"][cc] - as_of).days)

    return {
        "as_of": as_of, "end": end, "n": n, "base_rate": base,
        "by_band": by_band,
        "precision_top_score": hit(top_score) / len(top_score) if top_score else None,
        "precision_top_breadth": hit(top_breadth) / len(top_breadth) if top_breadth else None,
        "leads": {cc: {"n": len(v), "median_days": median(v)} for cc, v in leads.items()},
        "band_counts": Counter(x["band"] for x in out),
    }


def pct(v: float | None) -> str:
    return "—" if v is None else f"{100 * v:.0f}%"


def render(results: list[dict]) -> str:
    lines = [
        "# Risk score backtest",
        "",
        f"Generated {TODAY.isoformat()} by `backend/analysis/risk_backtest.py`, model {MODEL_VERSION}.",
        "",
        f"Each fold scores every molecule as of date T using only shortage and recall data from before T, then checks whether a shortage **started in a new country** in the following {HORIZON} days. Molecules with `insufficient_data` are excluded.",
        "",
        "**Known leak:** supplier inputs (FDA DMF, DECRS, approvals) and list membership are today's snapshot, since no history of them exists. Results are an upper bound on what the structural inputs contribute. `inn_risk_score_history` removes this leak from 2026-10-25 on.",
        "",
    ]
    for r in results:
        lines += [
            f"## Fold: as of {r['as_of']} → {r['end']}",
            "",
            f"{r['n']} molecules scored. Base rate (any new-country onset): **{pct(r['base_rate'])}**.",
            "",
            "| Band | Molecules | With onset | Lift vs base | Mean new countries |",
            "|---|---|---|---|---|",
        ]
        for b in BANDS:
            x = r["by_band"][b]
            lift = "—" if x["lift"] is None else f"{x['lift']:.2f}×"
            mnc = "—" if x["mean_new_countries"] is None else f"{x['mean_new_countries']:.1f}"
            lines.append(f"| {b} | {x['n']} | {pct(x['rate'])} | {lift} | {mnc} |")
        lines += [
            "",
            f"| Top {TOP_N} ranked by | Share with a new-country onset |",
            "|---|---|",
            f"| Supply vulnerability (our score) | {pct(r['precision_top_score'])} |",
            f"| Breadth alone (most countries short on T) | {pct(r['precision_top_breadth'])} |",
            f"| Random (base rate) | {pct(r['base_rate'])} |",
            "",
        ]
        if r["leads"]:
            lines.append("Lead time, high_risk/risk on T then a new shortage in a major market:")
            lines.append("")
            for cc, v in sorted(r["leads"].items()):
                lines.append(f"- {cc}: {v['n']} molecules, median {v['median_days']:.0f} days after the flag")
            lines.append("")
    return "\n".join(lines)


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
    except ImportError:
        pass
    db = get_supabase_client()
    molecules = build_universe(db)
    results = [fold(db, molecules, t) for t in FOLDS]
    report = render(results)
    print(report)
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                        "docs", "risk-score-backtest.md")
    with open(path, "w") as fh:
        fh.write(report + "\n")
    print(f"\n→ {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
