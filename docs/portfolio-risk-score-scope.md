# Portfolio risk score — scope

**Status:** scope only, nothing built. Written 2026-10-25.
**Trigger:** MaaTrx's At-RiskRx module ranks ~1,350 Canadian drugs on two axes, *clinical importance* × *supply chain vulnerability*, into High Risk / Risk / Caution bands. Mederti has richer supply-side inputs across 51 countries, but only shows them drug-by-drug (`/api/drug-resilience`). We have no ranked, portfolio-wide view.

**Goal:** one ranked, explainable risk score per molecule (INN). It powers four surfaces:
- an `/insights` risk board (scatter + table)
- a drug-page tile
- a "forward risk" column on the existing watchlist risk board
- a chat tool

Every number must trace back to a cited source (see `feedback-absolute-data-accuracy`).

---

## 1. What we have today (prod, counted 2026-10-25)

| Signal | Table / column | Prod coverage | Usable? |
|---|---|---|---|
| API makers (DMF holders) | `api_suppliers` | 14,548 rows, 9,221 linked to a drug | **Yes.** Strongest structural signal. |
| API maker country | `api_suppliers.country` | ~76% filled (DECRS match) | Yes → geographic concentration (HHI). |
| WHO-prequalified APIs | `api_suppliers.who_pq` | ~166 substances | Yes, as a resilience credit. |
| Finished-dose firms | `drug_approvals` (3,697) ∪ `recalls.manufacturer` (24,156) | Coarse, FDA-heavy, repackagers inflate it | Partial. Needs a better `norm_firm`. |
| Shortage history and breadth | `shortage_events` | 89,750 "active" rows, **of which 60,171 are JP+CH phantoms** | **Only once deduped.** See blocker B1. |
| Anticipated shortages | `shortage_events.status='anticipated'` | 3,466 | Yes. A forward signal. |
| Peer-market breadth | logic in `/api/watchlist/risk-board` + `/api/predictive-signals` | — | Yes. Reuse the `PEER_GROUPS` sets. |
| Price stress | `drug_pricing_history` | 614k rows (GB/US/FR/IT/ES) | Later. NHS price concessions are a known UK leading signal. |
| Verified alternatives | `verified_alternatives` view | 714 pairs | Yes, as a clinical-impact modifier. |
| WHO Essential Medicine flag | `drugs.who_essential_medicine` | **81 drugs** (real list ≈ 460) | **No, not yet.** Migration 051 is not applied (`who_essential_medicines` → 404) and the full importer was never run. See B2. |
| EU critical medicine flag | `drugs.critical_medicine_eu` | **0 drugs** | **No.** The column exists but was never populated. See B3. |
| ATC code | `drugs.atc_code` | 1,105 / 21,074 (5%) | Too sparse to drive the score. Display only. |
| Health Canada Tier 3 | `shortage_events.tier_3` | Column exists; sampled rows are null | Verify the HC scraper populates it before use. |
| Manufacturing compliance (OAI) | `manufacturing_facilities` | Contaminated; 5 genuine OAI sites | **Do not use.** Defamation risk (see `fda-dmf-api-suppliers` memory). |

**Takeaway:** the *supply-vulnerability* axis is ~70% buildable today; the prototype already exists at `backend/analysis/inn_vulnerability.py`. The *clinical-importance* axis is essentially dark. That axis is MaaTrx's real edge (Tadrous's critical-drug-list research), and we close it by importing published authoritative lists, not by inventing weights.

---

## 2. Blockers (Phase 0, must land first)

- **B1. JP/CH phantom rows.** `backend/scripts/dedupe_snapshot_shortages.py --execute` was never run. The permission classifier blocked it, so it needs a manual run. The phantoms have grown to 60k. Any shortage-history or breadth input computed on rows would be garbage. Even after the dedupe, compute pressure on **distinct (drug, country) pairs**, never row counts.
- **B2. WHO EML.** Apply migration 051 in the SQL editor, then run `backend/importers/who_eml_importer.py` to completion (several hours, `--resume`-safe; run on a server, not the laptop).
- **B3. EU Union List of Critical Medicines.** Write an importer for the EMA/HERA Union list (an xlsx of a few hundred active substances, updated annually). Populate `drugs.critical_medicine_eu` and keep a raw, citable table, as 051 does for WHO.
- **B4. INN grain.** Score at molecule level, not per `drugs` row (21k rows, badly fragmented). Use the `inn-resolution` pipeline's resolved INN where present; otherwise use the prototype's prefix-token grouping with combo exclusion. Do **not** group via `canonical_drug_id` heads, which are contaminated (see `verified-alternatives` memory).

### Phase 0 runbook

Run these in order, from the repo root with `.env` loaded.

1. **B1, JP/CH dedupe** (manual):
   - `python3 -m backend.scripts.dedupe_snapshot_shortages`: dry run; check the counts.
   - `python3 -m backend.scripts.dedupe_snapshot_shortages --execute`
   - Verify: JP + CH active rows drop from ~60k to ~1.7k.
2. **B2, WHO EML**:
   - Apply `supabase/migrations/051_who_essential_medicines.sql` in the SQL editor.
   - Run `python3 -m backend.importers.who_eml_importer`. Takes ~1h at current eEML speed and writes every 50 medicines.
   - If it stops part-way, rerun with `--resume`.
   - Verify with the queries at the bottom of migration 051.
3. **B3, EU Union list**:
   - Apply `supabase/migrations/072_eu_critical_medicines.sql` in the SQL editor.
   - `MEDERTI_DRY_RUN=1 python3 -m backend.importers.eu_critical_medicines_importer`: expect 299 entries, 194 resolved.
   - `python3 -m backend.importers.eu_critical_medicines_importer`
   - Verify with the queries at the bottom of migration 072.

**Status (2026-10-25): all three done in prod.**

| Step | Result |
|---|---|
| B1 dedupe | Active rows went 89,750 → 31,261. JP 37,826 → 1,495; CH 22,345 → 187. Backup: `logs/dedupe_snapshot_shortages_20261025T004249Z.json`. |
| B2 WHO | 1,100 eEML records. Only **541** are on the current list: removed and rejected applications, AWaRe-only antibiotics and square-box alternatives are not (see migration 073, `on_current_list`). **305** drugs flagged, every one backed by a current listing. 174 bad flags cleared; backup at `logs/who_unflag_backup_20261025.json`, plus 4 stale hand-seeds. |
| B3 EU | 299 entries; **182** drugs flagged. 115 drugs are on both lists. |

**Rule for every consumer:** a WHO-essential input means `who_essential_medicines.on_current_list`, never "has a row in the table".

Neither importer is in cron. Both lists change at most yearly; rerun them when EMA or WHO publish a new version.

## 3. The model

Keep the prototype's key insight: **multiplicative structure, not a flat weighted sum**. A flat sum ranked atorvastatin above cisplatin, because ubiquitous drugs rack up shortage rows in 30+ countries.

### Axis A — Supply vulnerability (0–10)
`SV = 10 × fragility × (0.5 + 0.5 × pressure)`

- **fragility** (structural) is the weakest link of:
  - API layer: `e^-((n_api_makers-1)/8)`, amplified ≤30% by country HHI. Credit for WHO-PQ makers.
  - Finished-dose layer: the same curve on de-duplicated filler firms.
- **pressure** (current instability) is a 0–1 blend of:
  - distinct countries currently short (log-scaled)
  - declared anticipated shortages
  - peer-market breadth (short in ≥2 peers of a market)
  - recalls. Weight these low: the prototype measured only 1.05–1.14× lift as a leading indicator, so don't oversell them.
- **Missing data ≠ safe.** Zero DMF rows means *unknown*, not "many makers". Such INNs get `SV = null` with reason "insufficient supply data". They are never scored low.

### Axis B — Clinical importance (0–10)
Make this a transparent, list-based count, not a black box:

| Input | Points | Source |
|---|---|---|
| WHO EML core list | 3 | WHO eEML (CC BY 3.0 IGO) |
| WHO EML complementary list only | 2 | WHO eEML |
| EU Union List of Critical Medicines | 3 | EMA |
| US FDA Essential Medicines List (EO 13944, 2020) | 2 | FDA. Licence/format to verify. |
| No regulator-authorised alternative in `verified_alternatives` | +1 | Mederti, cited |
| Sterile injectable only (no oral form) | +1 | Derived from dosage forms |

Cap at 10. The UI shows *which* lists a drug is on ("Essential in: WHO core, EU critical"), not just the number. Candidate later inputs, each needing licence and availability verification first: the US ARMI/ASPR essential-medicines list, and Health Canada's critical drug list.

### Bands
- **High risk:** CI ≥ 6 and SV ≥ 6
- **Risk:** CI ≥ 4 and SV ≥ 4
- **Caution:** either axis ≥ 4
- **Low:** everything else
- **Insufficient data:** either axis null

Display decimals to one place at most, with the band as the headline. Every score carries `computed_at`, `inputs_used / inputs_possible`, and links to the underlying rows.

### Universe
Phase 1 scores **only the clinically-important universe**: the union of the lists above, ~600–700 INNs. That's where the data is densest and the decisions matter. MaaTrx scores ~1,350. Widen once the backtest passes.

### Per-market view (our edge over MaaTrx)
SV and CI are global. Add a **market overlay**:
- "short in your market now"
- "short in N peer markets, not yet yours" (the existing `early_warning` logic)

A pharmacist in GB sees the same molecule's global fragility plus its local trajectory. A Canada-only tool can't build this.

### Phase 1 as built (2026-10-25)

`backend/analysis/risk_score.py` → `inn_risk_scores` + `inn_risk_score_history` (migration 074). Applied to prod and first run written. The module docstring is the source of truth; below are the changes from the design above, all found by checking the first dry runs against real data.

**Universe and clinical importance**
- **Universe:** 563 molecules, from WHO entries with `on_current_list` plus current EU entries. Entries sharing a name or ATC level-5 code are merged; combinations are skipped.
- **Clinical importance** uses only the WHO and EU lists, normalised over the inputs available: CI = 10 × points / 6.
  - The FDA EO 13944 list isn't imported.
  - "No alternative" isn't scored: with only 714 verified pairs, absence would mean "no data".
  - "Injectable only" isn't scored: `drugs` has no routes, and EMA's route column has errors.

**Name matching**
- **Exact-prefix only**, including foreign endings like "cisplatino".
- **INN↔USAN aliases** (aciclovir/acyclovir and others) are needed, otherwise US data is lost.
- **Parenthesised list names and class names** ("insulin", "ALBUMIN (Technetium…)") match exactly only.
- **Upstream eEML error:** "mannitol hexanitrate" means mannitol (B05BC01) and is corrected in code.

**Supply evidence (all the supply data is US)**
- US repackagers and compounders aren't counted as manufacturers.
- The finished-dose layer is ignored when there are 10+ API makers (dolutegravir, dabigatran).
- Medical gases use the finished layer only.
- No score unless at least one layer shows 3+ firms.
- Result: 201 molecules (36%) are `insufficient_data`, mostly biologics, vaccines, classes and non-US products.

**Bands:** caution requires a supply signal (SV ≥ 4, or CI ≥ 6 with SV ≥ 2.5), because every molecule in the universe is clinically important by construction.

**First run:** 13 high_risk, 112 risk, 47 caution, 190 low, 201 insufficient_data.

| Molecule | Band | Supply score |
|---|---|---|
| Morphine | high_risk | 7.2 (3 API makers) |
| Vincristine | risk | 5.3 |
| Cisplatin | risk | 5.2 |
| Carboplatin | low | 2.3 |
| Amoxicillin | low | 1.8 |
| Metformin | low | 0.3 |
| Dolutegravir | low | 0.3 |

**Access and schedule:** the tables are service-role only (anon access is denied, verified). Cron runs daily at 16:00 local.

## 4. Backtest gate (before anything ships publicly)
- Reconstruct the score **as of past dates** T, using only shortage and recall data before T.
  - Caveat: DMF/DECRS are current snapshots only, so structural inputs leak. State this in the write-up.
- Outcome: a new shortage start for that INN in any covered market during T → T+180d.
- Report:
  - precision@50 and lift vs base rate, by band
  - median lead time between our High-risk flag and the first US (FDA) / AU (TGA) report. This produces a claim like Quva's "N shortages predicted ahead of ASHP".
- **Ship gate:** High band lift meaningfully > 1 (target ≥ 2×). If it fails, ship as "risk factors" (no predictive claim). Never call it a prediction without the backtest.

## 5. Build plan

| Phase | Work | Size |
|---|---|---|
| 0 | B1 dedupe execute (manual), B2 migration 051 + full WHO run, B3 EU Union List importer, B4 INN grouping choice | 2–3 days + manual steps |
| 1 | Productionise `inn_vulnerability.py` → `backend/analysis/risk_score.py`. New migration: `inn_risk_scores` table (inn, ci, sv, band, components JSONB, inputs_used, computed_at). Nightly job after the shortage scrapers. Clinical-importance list importers. | 3–4 days |
| 2 | Backtest harness + write-up (`docs/risk-score-backtest.md`) | 2 days |
| 3 | UI: `/insights/risk` scatter (CI × SV) + sortable table + band filter. Drug-page tile with an expandable "why" (each component cited). Forward-risk column on `WatchlistRiskBoard`. | 3 days |
| 4 | Chat tool `get_risk_score` with component citations; system-prompt rule to quote band + reasons, never a bare number | 1 day |

## 6. Non-goals / guardrails
- No manufacturer-quality (OAI/warning-letter) input until a clean inspection source exists.
- No ATC-class weighting while ATC coverage is 5%.
- No score for INNs whose inputs are missing; show "insufficient data" instead.
- Don't brand individual scores as predictions until the §4 gate passes.

## 7. Open decisions for the CEO
1. Public or logged-in only? The metered-free-views model suggests the board itself is login-gated, with a teaser on drug pages.
2. Should the per-market overlay default to the user's profile country?
3. Is it OK to start Phase 0 now? It needs you to run the B1 `--execute` and apply 051 in the SQL editor.

---

## Phases 2–4 as built (2026-10-25)

**Phase 2, backtest:** the gate failed. See `docs/risk-score-backtest.md`.
- The risk band shows no lift over base, and its top 25 do no better than random (64–72% vs a 70–76% base).
- Ranking by "already short in the most countries" reaches 96%.
- Fragility doesn't predict shortage duration either.

**The decision this forced:** no "risk" verdict anywhere in the product. Surfaces show the facts the score is built from, labelled as what they are:
- **Supply concentration:** Highly concentrated / Concentrated / Broad / Unknown, from `fragility`.
- **Essential status:** WHO Model List, EU Union list.
- **Spread:** countries short now, and short in peers but not reported here.

`inn_risk_scores.band` stays internal, for Phase 2b.

**Phase 3, surfaces.** There's no separate `/insights/risk` page. Instead:
- **National Shortage Dashboard:** rebuilt on live data via `lib/insights/dashboard-data.ts`. It previously rendered sample figures from an HTML mockup, including invented upstream events naming a real company.
  - Live KPIs, essential medicines short here, a concentration × spread chart, short in peers / not reported here, peers, and where APIs are made.
  - The AI read uses exact totals and is barred from counting examples, inferring causes or trends, or forecasting.
- **Drug page:** the API supply tile uses the molecule profile and the same tiers. Its old "concentration risk" label is gone.
- **Watchlist risk board:** EU-critical and concentrated-supply chips.

**Phase 4, chat:**
- New `get_supply_profile` tool.
- `get_class_concentration_risk` rebuilt on `inn_risk_scores`. It previously read a view that doesn't exist in prod.
- System-prompt rule: concentration is never a forecast.

**Phase 2b (open):**
- per-market onset test
- severity test
- leak-free re-run from `inn_risk_score_history` once it holds 6+ months
