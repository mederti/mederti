# Two cheap forward signals: count-rule baseline and trial terminations

Research only, run 2026-10-26. Nothing in the product changed and nothing was written to prod tables. Scripts are in `backend/analysis/research/`.

## Verdict

**Neither signal should be shown to users as a forecast.**

1. **The count rule is the baseline, not a feature.** Rank drugs by shortages in a market over the prior 12 months. Among drugs not short today, top-25 precision for "a new shortage starts within 90 days" is **25–38% in AU, IT and ES** (5–7× the base rate, hold-out). In CA and FR it is 5–10%. In **US and DE it equals random**, because those feeds hold almost no resolved history. Any risk score has to beat this per market. The fact underneath it ("N shortages here in the last 12 months") is already a fact we can show. Labelling it a prediction would overstate it in half our markets.
2. **Trial termination is not worth showing.** A trial stopped 3–18 months earlier is followed by a new shortage within 90 days in 4.7% of cases, against 2.3% for drugs without one (hold-out; base rate 2.9%). Most of that comes from the drug being big and heavily studied, not from the stopped trial:
   - Drugs with a *completed* trial in the same window show the same lift (risk ratio 2.38 vs 2.10).
   - Matched on trial volume, completed-trial status, market and count score, the risk ratio falls to **1.29 (95% CI 1.11–1.49)**.
   - The flag fires on 26–29% of drugs every month, and 95% of flagged drugs don't go short within 90 days.
   - Added to the count rule as a tie-breaker, it raises pooled top-25 precision from 14.0% to 15.1% (Δ CI +0.5 to +1.7 pts).
   - Terminations whose stated reason mentions supply or manufacturing show **no** effect once activity is controlled (RR 1.14, CI 0.79–1.51).

The earlier claim (pfie-signal-research, 2 of 11 drugs flagged, "100% precision") studied only drugs that went short, with no non-shortage drugs for comparison. Our recall is similar or higher: 41–49% of new shortages had a stopped trial 3–18 months earlier. But 26–29% of all drugs have one, so recall alone shows nothing.

## Data used, and what was excluded

| Step | Detail |
|---|---|
| Source | `shortage_events`, pulled read-only on 2026-10-26 to a local snapshot (`extract_shortage_history.py`) |
| Synthetic rows | Excluded (`synthetic = true`, 4,179 rows at extract time) |
| Anticipated rows | Excluded. They are not shortage starts. |
| Other feeds | Only each market's primary national shortage feed is used. **US: 228 rows from "FDA Drug Enforcement — Foreign Manufacturer Recalls" sit in `shortage_events` unflagged.** They are recalls tagged `[SUPPLY-SIDE SIGNAL]`, not shortages. *Follow-up: flag them synthetic.* |
| Drug identity | Exact matches only, in order: `drugs.resolved_inn`; else the drug's name equals some `resolved_inn`; else an exact `drug_synonyms` hit. No prefix or fuzzy matching, and `canonical_drug_id` is never followed. That gives 1,778 INN units (4,535 drug rows via resolved_inn, 151 via name, 31 via synonym). |
| Rows kept / dropped (unresolved drug) | US 785 / 59 · CA 3,011 / 132 · AU 1,903 / 73 · GB 54 / 53 · FR 341 / 134 · DE 772 / 276 · IT 3,954 / 1,397 · ES 2,458 / 1,641 |

### Data limits that shape every number below

- **The history is back-filled.** Every row was first stored on or after Feb 2026. Earlier start dates are whatever the feeds still listed then, so short shortages that were resolved and dropped before Feb 2026 are missing. **The hold-out (T = Jan–Jul 2026, outcomes observed while the scrapers ran) is the trustworthy period.** The dev period (T = 2025) is shown for stability only.
- **Some feeds carry little or no resolved history.** US has 817 active rows and 27 resolved. DE has 1,048 active and 0 resolved. CA has 3,020 active and 123 resolved, all without end dates. In these markets every drug with a recent shortage is still "short" on every later date, so it can never have a *new* episode. The count rule is therefore inert on the new-episode outcome, which is a property of the data, not of the drugs.
- **GB is too thin** (54 resolvable rows, about 2 new starts a month) to test anything.

## Part 1 — Count-rule baseline

Method (`count_rule_backtest.py`):
- On the 1st of each month T, rank every INN unit by its shortage rows in the market whose start date falls in (T−12m, T].
- **New episode** (primary outcome): only drugs not short in the market on T are ranked. A positive is a shortage starting in (T, T+90d].
- **Any start** (secondary outcome): all drugs are ranked, and any new row counts, including another strength of a drug that is already short.
- Precision@k is the mean over months, with ties at the cut-off split at their mean hit rate, so ties never flatter the rule.
- CIs are 95% bootstraps that resample whole drugs (300 draws).
- The rule has no parameters, so nothing was fitted. The time split exists so that later models can be compared on the same hold-out.

### New episode: drugs not short on T (primary)

| Market | Period | Base rate | New starts / month | P@10 | P@25 | P@50 | Lift @25 |
|---|---|---|---|---|---|---|---|
| US | hold-out | 1.6% | 25 | 2% | 2% | 2% | 1.0× (inert, see data limits) |
| CA | hold-out | 4.4% | 56 | 14% (5–24) | 10% (5–16) | 7% (5–10) | 2.4× |
| AU | hold-out | 4.9% | 73 | 28% (17–41) | 25% (18–33) | 23% (18–29) | 5.1× |
| GB | hold-out | 0.1% | 2 | 7% (0–16) | 3% (0–6) | 1% (0–3) | too thin |
| FR | hold-out | 1.5% | 24 | 7% (2–11) | 5% (2–7) | 4% (2–6) | 3.1× |
| DE | hold-out | 2.3% | 37 | 2% | 2% | 2% | 1.0× (inert) |
| IT | hold-out | 4.3% | 60 | 31% (19–49) | 28% (20–37) | 24% (16–30) | 6.6× |
| ES | hold-out | 5.5% | 84 | 45% (28–58) | 38% (28–47) | 34% (27–39) | 6.9× |
| US | dev | 1.9% | 31 | 2% | 2% | 2% | 1.0× |
| CA | dev | 2.5% | 35 | 10% (3–20) | 8% (3–13) | 5% (3–8) | 3.0× |
| AU | dev | 3.3% | 54 | 4% (2–5) | 3% (3–4) | 3% (3–4) | 1.0× |
| FR | dev | 1.4% | 24 | 1% | 1% | 1% | 1.0× |
| DE | dev | 1.4% | 23 | 1% | 1% | 1% | 1.0× |
| IT | dev | 3.2% | 50 | 30% (19–39) | 27% (20–32) | 22% (18–27) | 8.2× |
| ES | dev | 4.3% | 70 | 14% (10–19) | 14% (11–17) | 11% (10–14) | 3.2× |

The AU and FR dev rows are near random because the back-filled 2024–25 TGA and ANSM history barely contains resolved episodes, so there is little recurrence to see.

### Any start: all drugs, any new row (secondary)

| Market | Hold-out P@10 | P@25 | P@50 | Base | Lift @25 |
|---|---|---|---|---|---|
| US | 12% (4–23) | 12% (6–20) | 9% (4–15) | 2.1% | 5.8× |
| CA | 84% (69–96) | 79% (70–87) | 76% (70–82) | 13.4% | 5.9× |
| AU | 94% (78–100) | 84% (75–90) | 77% (68–84) | 10.3% | 8.1× |
| FR | 37% (18–55) | 31% (21–43) | 26% (18–34) | 2.5% | 12.4× |
| DE | 60% (41–78) | 54% (40–65) | 44% (35–54) | 5.0% | 10.8× |
| IT | 91% (81–100) | 91% (84–97) | 85% (78–92) | 13.5% | 6.8× |
| ES | 91% (78–99) | 84% (75–91) | 78% (69–85) | 10.3% | 8.2× |

These high figures mostly reflect **regulators listing one episode as many rows**, one per strength or pack, added over a few weeks. That is not forecasting. It shows why "any start" must not be used to sell a model.

**Comparison with PickettAnalytics** (CA + US, LightGBM vs count rule, 10-month hold-out): their count rule scored P@10 0.43 and P@25 0.34 on the unannounced watchlist, and their best blend scored 0.58 and 0.40. Their outcome is defined per drug, not per presentation, and they observe Health Canada's full history. Our CA new-episode numbers are lower because our CA rows lack end dates (see data limits).

**Leak check** (`--known-by`: count a prior event only if Mederti had stored it by T): hold-out P@25 is AU 21%, IT 22%, ES 22%, CA 7%, FR 5%, US/DE 2%. That is lower but the same shape, because Jan–Feb 2026 have almost nothing stored.

## Part 2 — Trial-termination precursor

Method (`fetch_ct_trials.py`, `ct_termination_backtest.py`):

- **Source.** The ClinicalTrials.gov v2 API, queried per INN on 2026-10-26 (1,768 of 1,778 units; 10 malformed stereo-INN strings such as `fluvastatin, (3r` return HTTP 400). The dormant `clinicaltrials_scraper.py` was not usable: it filters to RECRUITING/ACTIVE/COMPLETED/UNKNOWN Phase 3–4, which drops exactly the trials this test needs.
- **Study filter.** A study counts only if a DRUG, BIOLOGICAL or COMBINATION_PRODUCT intervention names the INN as whole words. CT.gov's own synonym expansion is post-filtered.
- **Flag.** At least one TERMINATED, SUSPENDED or WITHDRAWN study whose stop date falls in [T−18m, T−3m]. The stop date is the ACTUAL completion date if CT.gov has one, else the status-verified month. The window was fixed before looking at results. The 3-month minimum lag covers FDAAA's 30-day status-update rule.
  - `--strict` also requires the study's last update to have been posted by T. That is enough to prove the stop was public by T.
- **Outcome.** Same as Part 1, new episode.
- **Controls.**
  - **Supply-reason flag:** `whyStopped` mentions supply, manufacturing, shortage, availability, stock, production or procurement.
  - **Completed-trial flag:** a study COMPLETED in the same window, i.e. trial activity alone.
  - **Mantel–Haenszel risk ratios**, all within market, stratified by:
    - count score (0, 1, 2+);
    - trial volume (quintiles of all registered studies);
    - jointly, volume × completed flag × count score ("activity-matched").
- **CIs.** Wilson for proportions; risk ratios use a bootstrap that resamples market × drug clusters (1,000 draws).

### Pooled across the 8 markets

| | Hold-out (T = Jan–Jul 2026) | Dev (T = 2025) |
|---|---|---|
| Drug-months / positives (base rate) | 85,577 / 2,504 (2.93%) | 155,978 / 3,415 (2.19%) |
| Flagged (stopped trial 3–18m earlier) | 22,337 (26%; about 400 drugs per market per month) | 45,968 (29%) |
| Precision when flagged | **4.65%** (4.38–4.93) | 3.65% (3.48–3.83) |
| Rate when not flagged | 2.32% | 1.58% |
| Recall | 41% | 49% |
| Crude risk ratio (within market) | 2.10 (1.86–2.38) | 2.37 (2.12–2.66) |
| … same for a **completed** trial in the window | 2.38 (2.08–2.71) | 2.57 (2.27–2.91) |
| RR controlling for count-rule score | 1.87 (1.66–2.11) | 2.25 (2.02–2.52) |
| RR controlling for trial volume | 1.53 (1.32–1.77) | 1.51 (1.34–1.72) |
| **RR, activity-matched** | **1.29 (1.11–1.49)** | **1.25 (1.11–1.43)** |
| Supply-reason subset, activity-matched | 1.14 (0.79–1.51), recall 5% | 1.05 (0.83–1.30), recall 6% |
| Count rule at the same alert volume | 4.1% precision | 2.5% |
| Count-rule P@25 → with stopped-trial tie-break | 14.0% → 15.1% (Δ CI +0.5…+1.7 pts) | 7.0% → 8.2% (Δ CI +1.0…+1.6 pts) |
| Same with completed-trial tie-break | 14.0% → 14.5% (Δ CI +0.0…+0.9 pts) | 7.0% → 7.8% |

`--strict` (public-by-T) leaves this unchanged: activity-matched RR is 1.34 (1.16–1.54) in hold-out and 1.23 (1.09–1.40) in dev.

### Per market, hold-out

| Market | Base | Flagged / month | Precision when flagged | Crude lift vs base | Count rule P@25 → with tie-break |
|---|---|---|---|---|---|
| US | 1.6% | 411 | 3.0% (2.4–3.6) | 1.84 | 1.6% → 2.9% |
| CA | 4.4% | 290 | 6.4% (5.5–7.6) | 1.46 | 10.5% → 11.3% |
| AU | 4.9% | 377 | 8.1% (7.2–9.2) | 1.68 | 24.8% → 23.6% |
| GB | 0.1% | 511 | 0.3% (0.1–0.5) | — | too thin |
| FR | 1.4% | 460 | 2.0% (1.6–2.6) | 1.43 | 4.6% → 6.1% |
| DE | 2.3% | 418 | 4.5% (3.8–5.3) | 1.94 | 2.3% → 4.4% |
| IT | 4.3% | 329 | 7.9% (6.9–9.1) | 1.85 | 27.8% → 31.1% |
| ES | 5.5% | 394 | 7.9% (6.9–8.9) | 1.44 | 37.4% → 38.2% |

### Reading

- **The raw association is real but explained mostly by confounding.** Widely used drugs have more trials, so more of their trials stop, and they also have more presentations that can go short. The completed-trial control shows this: completion predicts shortage as well as termination does.
- **The residual 1.2–1.3× is statistically clear, but too small to act on.** Each month the flag marks about 400 drugs per market, and fewer than 1 in 20 go short within 90 days.
- **The mechanism the hypothesis implies is absent.** Terminations stopped for supply or manufacturing reasons are rare (5% recall) and don't beat other terminations once activity is matched.
- **In US and DE the tie-break looks useful only because the count rule is inert there.** In those markets the trial flag works as a crude "big drug" prior, which a volume-of-use field could provide more cheaply and more honestly.

## Reproduce

```bash
python3 -m backend.analysis.research.extract_shortage_history DATA_DIR      # read-only Supabase pull
python3 -m backend.analysis.research.count_rule_backtest DATA_DIR [--known-by] [--json OUT]
python3 -m backend.analysis.research.fetch_ct_trials DATA_DIR               # public CT.gov API, ~35 min, resumable
python3 -m backend.analysis.research.ct_termination_backtest DATA_DIR [--strict] [--json OUT]
```

`DATA_DIR` is a local scratch folder and is not committed. Bootstrap seeds are fixed. Re-running against a later snapshot will move the numbers as the live-scraped period grows.

## Follow-ups this surfaced

- **Data:** flag the 228 US "FDA Drug Enforcement — Foreign Manufacturer Recalls" rows in `shortage_events` as synthetic, or move them out. They are recalls, and the product currently counts them as US shortages.
- **Data:** US, DE and CA feeds rarely close rows (no end dates, almost no `resolved`), so "short now" is overstated and recurrence can't be measured. Capturing resolution from those feeds would unlock any forecast work there.
- **Method:** re-run Part 1 in early 2027, when the hold-out has 12+ months of live-observed starts. That is the test set for any future risk model.
