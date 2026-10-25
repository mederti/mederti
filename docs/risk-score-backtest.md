# Risk score backtest

Generated 2026-10-25 by `backend/analysis/risk_backtest.py`, model 1.0.

Each fold scores every molecule as of date T using only shortage and recall data from before T, then checks whether a shortage **started in a new country** in the following 180 days. Molecules with `insufficient_data` are excluded.

**Known leak:** supplier inputs (FDA DMF, DECRS, approvals) and list membership are today's snapshot, since no history of them exists. Results are an upper bound on what the structural inputs contribute. `inn_risk_score_history` removes this leak from 2026-10-25 on.

## Fold: as of 2026-04-28 → 2026-10-25

362 molecules scored. Base rate (any new-country onset): **70%**.

| Band | Molecules | With onset | Lift vs base | Mean new countries |
|---|---|---|---|---|
| high_risk | 6 | 83% | 1.18× | 2.2 |
| risk | 105 | 58% | 0.82× | 1.4 |
| caution | 46 | 76% | 1.08× | 1.8 |
| low | 205 | 75% | 1.07× | 1.6 |

| Top 25 ranked by | Share with a new-country onset |
|---|---|
| Supply vulnerability (our score) | 64% |
| Breadth alone (most countries short on T) | 96% |
| Random (base rate) | 70% |

Lead time, high_risk/risk on T then a new shortage in a major market:

- AU: 14 molecules, median 60 days after the flag
- CA: 11 molecules, median 70 days after the flag
- US: 4 molecules, median 72 days after the flag

## Fold: as of 2025-10-30 → 2026-04-28

362 molecules scored. Base rate (any new-country onset): **76%**.

| Band | Molecules | With onset | Lift vs base | Mean new countries |
|---|---|---|---|---|
| high_risk | 2 | 0% | 0.00× | 0.0 |
| risk | 86 | 72% | 0.95× | 1.6 |
| caution | 46 | 70% | 0.92× | 2.4 |
| low | 228 | 79% | 1.04× | 2.3 |

| Top 25 ranked by | Share with a new-country onset |
|---|---|
| Supply vulnerability (our score) | 72% |
| Breadth alone (most countries short on T) | 96% |
| Random (base rate) | 76% |

Lead time, high_risk/risk on T then a new shortage in a major market:

- AU: 17 molecules, median 68 days after the flag
- CA: 10 molecules, median 80 days after the flag
- US: 2 molecules, median 68 days after the flag


## Conclusion: the gate fails, so the score ships as risk factors

**What the folds show**
- The scope's gate required High-band lift of 2× or more. The bands show no lift over base in either fold, and the top 25 by supply vulnerability do no better than random.
- **Breadth predicts spread; fragility doesn't.** Ranking by "already short in the most countries" reaches 96% in both folds. A shortage already in several markets is the strongest forward signal. `/api/predictive-signals` and the Intelligence radar already use it.
- **The outcome is easy and favours ubiquity.** A 70–76% base rate means almost every essential medicine starts a shortage somewhere new within six months, across 50 countries. Widely made, widely sold drugs have more markets to go short in, which works against a score built on how few makers a drug has.

**Decisions**
- **Copy:** the UI says "supply risk factors", never "predicted" or "forecast".
- **What the score is for:** it says how hard a shortage would be to recover from (few makers, concentrated geography, clinically essential). It doesn't say when one will start.
- **Pair it with spread:** surfaces show the band together with the spread signal, i.e. countries short now and peers short but not yet here.
- **Model unchanged:** I didn't retune it against these two folds, to avoid overfitting.

**Next test (Phase 2b)**
- **Per market:** for each molecule × major market not short on T, does it go short there? This has a lower base rate and is closer to the question a buyer actually asks.
- **Severity and duration:** does fragility predict *longer* shortages once one starts? That's the claim the structure is meant to support.
- **Leak-free re-run:** once `inn_risk_score_history` has 6+ months of data.

### Duration check (same day)
Resolved shortage episodes since 2023, with each molecule's median duration grouped by fragility tertile:

| Fragility tertile | Molecules | Median duration | Episodes |
|---|---|---|---|
| Low | 88 | 70 days | 1,266 |
| Mid | 88 | 92 days | 632 |
| High | 88 | 70 days | 456 |

Fragility doesn't predict duration either.

### Resulting product decision
Neither test supports a "High risk" verdict, so the UI shows the facts the score is built from, labelled as what they are. There's no combined risk verdict.
- **Supply concentration:** API makers, finished-dose firms, and the top manufacturing country's share. Shown as *Highly concentrated / Concentrated / Broad / Unknown*, from `fragility`.
- **Essential-medicine status:** WHO core / complementary, EU critical.
- **Spread now:** countries short now, and peers short but not yet in the user's market.

`inn_risk_scores.band` stays in the database for the Phase 2b tests and isn't shown to users.

## Peer-market early warning (2026-10-25)

`backend/analysis/peer_signal_backtest.py` tests the signal the Intelligence radar and the dashboard use: an essential medicine short in two or more of a market's peers, but not short in the market itself.

| Market | Flagged → reported here within 180 days | Everything else, same window | Within 90 days | Median lag |
|---|---|---|---|---|
| AU | 28–36% | 7–11% | 20–22% | 55–77 days |
| CA | 29–39% | 5–11% | 18–19% | 65–98 days |
| US | 13–15% | 3–5% | 9–15% | 43–48 days |
| GB | ~0% | 0% | ~0% | — |

**Reading:** the signal works. Flagged medicines are 2.5–6× more likely to be reported short in the market, but most are not. The old radar copy claimed shortages "typically reach the remaining markets within 60–90 days", which the data doesn't support, so it was replaced with these figures. GB can't be tested because the UK publishes too little shortage data.
