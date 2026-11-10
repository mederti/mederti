"""
Peer-market early-warning backtest
────────────────────────────────────────────────────────────────────────────────
Tests the claim behind the Intelligence radar and the dashboard's "short in
peers, not reported here" figure: when an essential medicine is short in two
or more of a market's peers but not in the market itself, how often is it then
reported short there, and how soon?

For each fold date T and market M (peer sets mirror /api/predictive-signals):
    flagged  = essential molecules short in ≥2 of M's peers on T, not short in M
    outcome  = a shortage in M starting in (T, T+180d]
Reported against the same outcome for every other molecule not short in M on T.

Universe and as-of reconstruction come from risk_score.py (WHO Model List ∪ EU
Union list; shortage state rebuilt from start/end dates as of T).

First run, 2026-10-25 (quoted in site copy; re-run before changing that copy):
    flagged → reported in M within 180d: AU 28–36%, CA 29–39%, US 13–15%
    everything else, same window:        AU 7–11%,  CA 5–11%,  US 3–5%
    within 90d: AU 20–22%, CA 18–19%, US 9–15%; median lag 45–100 days
    GB: ~0% either way — too little published UK shortage data to test.

Usage:
    python3 -m backend.analysis.peer_signal_backtest
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.analysis.risk_score import assemble, build_universe  # noqa: E402
from backend.utils.db import get_supabase_client                 # noqa: E402

HORIZON = 180
PEERS = {
    "AU": ["NZ", "GB", "US", "CA", "SG"],
    "US": ["CA", "GB", "EU", "FR", "DE"],
    "CA": ["US", "GB", "EU", "FR", "DE", "AU"],
    "GB": ["IT", "DE", "FR", "ES", "BE", "NL", "IE", "PT", "GR", "AT", "CH", "FI", "NO", "SE", "DK", "EU"],
}


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
    except ImportError:
        pass
    db = get_supabase_client()
    molecules = build_universe(db)
    today = date.today()
    for as_of in (today - timedelta(days=HORIZON), today - timedelta(days=2 * HORIZON)):
        data = assemble(db, molecules, as_of=as_of)
        end = as_of + timedelta(days=HORIZON)
        for market, peers in PEERS.items():
            flagged = hit90 = hit180 = base_n = base_hit = 0
            lags: list[int] = []
            for m in molecules:
                d = data[id(m)]
                if market in d["short_now"]:
                    continue
                starts = [sd for cc, _st, sd, _ed in d["rows"] if cc == market and as_of < sd <= end]
                first = min(starts) if starts else None
                if len(d["short_now"] & set(peers)) >= 2:
                    flagged += 1
                    if first:
                        hit180 += 1
                        lag = (first - as_of).days
                        lags.append(lag)
                        hit90 += lag <= 90
                else:
                    base_n += 1
                    base_hit += first is not None
            pct = lambda a, b: f"{100 * a / b:.0f}%" if b else "—"  # noqa: E731
            print(f"{as_of} {market}: flagged {flagged} → reported within 90d {pct(hit90, flagged)}, "
                  f"180d {pct(hit180, flagged)}, median lag {median(lags) if lags else '—'}d | "
                  f"others {pct(base_hit, base_n)} of {base_n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
