# Mederti — Persona Coverage Audit (Unified LLM + DB)

**Audit date:** 2026-05-27
**Auditor scope:** read-only inspection of Supabase schema, AI layer code, scraper coverage, and `/chat` tool surface — graded against a 150-question / 5-persona bank under the strict "unified system" product standard.
**Output type:** roadmap-grade audit; no remediation in this pass.

> **Headline:** the platform is much closer to the product standard than the question bank implies, but the published surface (chat) is using a fraction of the data already in Supabase. The dominant gap is **tool plumbing**, not data. Forecasting, hospital-network operational data, and demand telemetry are the only true RED/BLACK clusters.

---

## 1. Executive summary

### 1.1 Coverage by persona (strict "no gap on six dimensions" standard)

| Persona | 🟢 GREEN | 🟡 YELLOW | 🟠 ORANGE | 🔴 RED | ⚫ BLACK | Notes |
|---|---|---|---|---|---|---|
| **SUP** — Importer / exporter | 2 (6.7%) | 11 | 9 | 5 | 3 | Single biggest unlock cluster: typed tools for arbitrage, sole-source, concentration, demand telemetry |
| **HCL** — Hospital clinical pharmacy | 3 (10%) | 10 | 11 | 3 | 3 | Heavily blocked on missing per-hospital formulary, network stock visibility |
| **GOV** — Government / regulator | 2 (6.7%) | 18 | 6 | 3 | 1 | Best YELLOW conversion ratio — almost everything is in the DB; needs comparison + sole-source tools |
| **RET** — Retail / community pharmacist | 8 (26.7%) | 12 | 8 | 0 | 2 | Highest GREEN — the existing chat persona-default is pharmacist; substitutes + reason tools already exist |
| **HPR** — Hospital procurement | 1 (3.3%) | 9 | 12 | 6 | 2 | Worst GREEN — needs supplier-contract, fill-rate, hospital-network data to ever clear the bar |
| **Overall** | **16 / 150 (10.7%)** | 60 (40%) | 46 (30.7%) | 17 (11.3%) | 11 (7.3%) | |

**Important nuance on "GREEN":** under the strict standard (correct + sourced + confidence-calibrated + clean refusal + persona-aware + synthesised), only 16 questions clear the bar today. Under a softer "the LLM can give a useful answer with some caveats" reading, the number is closer to 70–80, because the live `/chat` route already handles many YELLOW questions acceptably through web_search fallback. The strict reading is what drives the roadmap.

### 1.2 % by status code overall

```
🟢 GREEN     10.7%   ████
🟡 YELLOW    40.0%   ████████████████
🟠 ORANGE    30.7%   ████████████
🔴 RED       11.3%   ████
⚫ BLACK      7.3%   ███
```

### 1.3 Top 3 highest-leverage gap clusters

1. **Typed-tool plumbing for data we already have** (YELLOW cluster, ~60 questions). The chat route has 9 tools. The schema has 51 tables. Most YELLOW questions are answerable today with `summarize_shortage_landscape`-style aggregations against existing rows — but the LLM has no callable to reach them. Examples: sole-source detection, peer-country comparison, class-level concentration risk, recurrence/duration stats, brand availability by sponsor, predictive-signals wrapping, time-series trend. Effort to close: a coherent push of ~12 new typed tools backed by existing tables. Unlocks roughly 35–45 of the 60 YELLOW.
2. **Hospital and procurement operational substrate** (ORANGE cluster on HPR + most of HCL, ~25 questions). Per-hospital formulary, contracted-supplier list, fill-rate signal, sister-hospital / LHD inventory, safety-stock cover. None of this exists; HPR / HCL questions silently assume it does. Closing requires either commercial partnerships (GPO data, wholesaler stock feeds) or a user-driven formulary upload primitive (CSV upload, watchlist-as-formulary) + a hospital-network entity model.
3. **Forecasting + confidence calibration as first-class outputs** (BLACK cluster, ~11 questions plus quiet hallucination risk on another ~10). `estimated_resolution_date` is whatever a regulator typed in a field; no time-series model, no peer-set inferred ETA, no confidence percentage. The product standard explicitly requires confidence-calibrated answers — today they are vibes from the prompt. Needs: rules-based confidence v1 (freshness × source reliability × signal count → low/med/high) shipped immediately as plumbing; an ML/heuristic resolution-time model v2 over the next quarter.

### 1.4 Top 5 quickest wins (YELLOW → GREEN in < 1 day each)

These are graded by `coverage_delta_per_engineering_hour`. All five are pure tool-plumbing over existing data:

| # | New tool | Backing data | Unlocks |
|---|---|---|---|
| 1 | `get_sole_source_essentials(country, who_only?)` | `drugs.who_essential_medicine` + `drug_products` count per drug × country | SUP-02, GOV-02, GOV-19, GOV-11, GOV-18 (already partial) |
| 2 | `compare_shortage_burden(country, peer_set?)` | `shortage_events` GROUP BY country + status + severity | GOV-13, GOV-14, GOV-15, GOV-05, SUP-05 |
| 3 | `get_class_concentration_risk(atc_prefix, country?)` | `v_drug_manufacturer_concentration` aggregated by ATC | SUP-24, GOV-03, GOV-04, GOV-27, HCL-08 |
| 4 | `get_resolution_time_stats(drug_id \| atc_prefix, country?)` | `shortage_events` resolved-event durations from `start_date` → `end_date` | HCL-12, HCL-20, HPR-10, GOV-21, SUP-22, RET-23 (deepens existing recurrence count) |
| 5 | `get_predictive_signals(country, drug_ids?)` — wrap existing `/api/predictive-signals` route as a chat tool | already-built peer-set lead-time analysis across 16 EU peers | SUP-25, GOV-28, HCL-05, RET-16 |

Each is < 1 day of engineering. Combined they move ~20 questions from YELLOW to GREEN and unlock partial credit on another ~10. They share zero infrastructure with the bigger gaps, so they can ship today without blocking the larger forecast/hospital push.

### 1.5 Hallucination risk

**12 questions are flagged ⚠ HALLUCINATION RISK** (data partial enough that the model might confabulate). The highest-stakes three:

- **Dose conversion / clinical equivalence** (HCL-15, RET-12, RET-11) — `drug_alternatives.dose_conversion_notes` is sparse (~100 drugs); model is one prompt-drift away from filling gaps from clinical priors. Risk for retail pharmacist: prescribing-style answer with no source.
- **Section 19A / SSP / shortage-provision eligibility** (SUP-16, RET-08, RET-27, HPR-18) — no DB table; system prompt mentions the schemes; web_search may return outdated or country-mismatched results. Risk: stating a drug is "eligible" when no formal listing exists.
- **Forecast ETAs presented with implied confidence** (SUP-19, RET-22, HPR-27, HCL-17) — `estimated_resolution_date` is regulator-supplied free text; restating it as "Mederti forecast" inherits authority the data does not earn.

Refusal templates for each are in §11.

---

## 2. Per-persona matrix

Status code is the *dominant* gap. Secondary codes appear in the Root cause column. Fix type buckets: **Tool/function**, **Data source**, **Schema legibility**, **Citation plumbing**, **Confidence model**, **Forecast model**, **Refusal template**, **Partnership**.

### 2.1 SUP — Pharma importer / exporter

| ID | Question (truncated) | Status | Dominant gap | Root cause | Fix type |
|----|---|---|---|---|---|
| SUP-01 | Drugs short in country + duration | 🟢 | — | `list_active_shortages` + `start_date` already plumbed | — |
| SUP-02 | Essential meds with zero / single supply | 🟡 | Tool function | WHO flag + `drug_products` count derivable; no tool | Tool/function |
| SUP-03 | Active shortages overlapping my catalogue | 🟡 | Tool function | `supplier_portfolios` exists but no portfolio-join tool | Tool/function |
| SUP-04 | APIs I manufacture in downstream shortage formulations | 🟠 | Data sparse + tool | `api_manufacturers` ingest uneven; no user→API mapping | Tool/function + Data source |
| SUP-05 | Country A surplus while B short (arbitrage) | 🟠 | Data model | "Surplus" not a status; needs derivation rule | Schema legibility + Tool/function |
| SUP-06 | Gap size — patients, units/month, $ | 🔴 | Data missing | Patient impact / volume not in schema | Data source + Partnership |
| SUP-07 | Price during shortage vs baseline | 🟡 | Tool function | `drug_pricing_history` exists; no shortage-correlated tool | Tool/function |
| SUP-08 | Pharmacist/wholesaler queries received | 🔴 | Data missing | No demand telemetry table | Data source |
| SUP-09 | Highest unmet-demand drugs this quarter | 🔴 | Data missing | Same | Data source |
| SUP-10 | Most underserved therapeutic classes globally | 🟢 | — | `summarize_shortage_landscape` with atc_prefix | — |
| SUP-11 | Who supplies this drug in [country] at what doses | 🟡 | Tool function | `drug_products` + `sponsors` queryable; no exposed tool | Tool/function |
| SUP-12 | Competitor sites: recalls, warning letters, GMP | 🟡 | Tool function + join | `recalls.manufacturer` is text, not FK to `manufacturing_facilities` | Tool/function + Schema legibility |
| SUP-13 | Major supplier just discontinued/deregistered | 🟡 | Tool function | `drug_products.cancellation_date` + `registry_status` exist | Tool/function |
| SUP-14 | Products heading to single-source risk | 🟡 | Tool function | Derivable from `drug_status_snapshots` over time | Tool/function |
| SUP-15 ⚠ | Fastest legal import pathway | 🔴 | Data missing | No country-specific regulatory-rules DB | Data source + Refusal template |
| SUP-16 ⚠ | Eligible for Section 19A / 503B / Art 5(2) / SSP | 🟠 | Data missing | Mentioned in system prompt; no structured eligibility table | Data source + Refusal template |
| SUP-17 ⚠ | Countries accepting overseas dossiers during shortage | 🟠 | Data missing | Web-search dependent, no DB | Data source |
| SUP-18 ⚠ | Regulator requirements for alt supplier registration | 🟠 | Data missing | Web-search dependent | Data source |
| SUP-19 ⚠ | Forecast end + confidence | ⚫ | Forecast model | No model; `estimated_resolution_date` is regulator guess | Forecast model + Confidence model |
| SUP-20 ⚠ | Risk it resolves before my product lands | ⚫ | Forecast model | Same + pathway-duration data missing | Forecast model |
| SUP-21 | Shortages likely to extend > 6 / 12 mo | ⚫ | Forecast model | Historical baseline queryable; prediction needs model | Forecast model |
| SUP-22 | Recurring / structurally undersupplied | 🟢 | — | Drug card surfaces recurrence count | — (deepen with stats tool — quick win #4) |
| SUP-23 ⚠ | Indian / Chinese API sites in distress | 🟠 | Data + scraper | India CDSCO broken; China NMPA low yield; no distress monitor | Data source |
| SUP-24 | Drug classes most exposed to upstream concentration | 🟡 | Tool function | `v_drug_manufacturer_concentration` exists; no class aggregation tool | Tool/function (quick win #3) |
| SUP-25 | Early shortage signals not yet declared | 🟡 | Tool function | `/api/predictive-signals` exists; not exposed to chat | Tool/function (quick win #5) |
| SUP-26 | Buyers actively searching for my products | 🔴 | Data missing | No buyer-search telemetry | Data source |
| SUP-27 | Anonymous demand signals by region | 🔴 | Data missing | Same | Data source |
| SUP-28 | Watchlist subscribers for drugs I stock | 🟡 | Tool function + privacy | `user_watchlists` table aggregable with k-anonymity | Tool/function |
| SUP-29 | Alert when any drug in catalogue enters shortage | 🟡 | Tool function | Per-drug watchlist exists; portfolio-watch alert type missing | Tool/function |
| SUP-30 | Alert when competitor enters/exits market | 🟡 | Tool function | `drug_products` registration deltas detectable; no alert wired | Tool/function |

### 2.2 HCL — Hospital clinical pharmacy

| ID | Question | Status | Dominant gap | Root cause | Fix type |
|----|---|---|---|---|---|
| HCL-01 | Active shortages affecting drugs we dispense | 🟠 | Data missing | No per-hospital formulary | Data source (user-driven CSV upload viable) |
| HCL-02 | Of those, which have no clinical substitute | 🟡 | Tool function | Combine HCL-01 with `find_substitutes` empty | Tool/function + Data source |
| HCL-03 | Critical care / oncology / paediatrics / anaesthesia | 🟢 | — | ATC prefix routing exists in `summarize_shortage_landscape` | — (paediatrics needs dosage-form keyword join — minor) |
| HCL-04 ⚠ | Patients at risk if [drug] short > 30 days | 🔴 | Data missing | No patient population / indication-prevalence data | Data source + Refusal template |
| HCL-05 | Formulary drugs at risk in next 90 days | 🟠 | Data + tool | Predictive-signals route exists; formulary missing | Data source + Tool/function (quick win #5 partial) |
| HCL-06 | Preferred suppliers with multiple active shortages | 🟠 | Data missing | No hospital→supplier relationship table | Data source |
| HCL-07 | Should we add a backup product to formulary | 🟡 | Synthesis | `find_substitutes` + shortage history; needs framing | Tool/function |
| HCL-08 | Drug classes with most fragile global supply | 🟡 | Tool function | Same as SUP-24 | Tool/function (quick win #3) |
| HCL-09 | Alt suppliers TGA/FDA/MHRA-registered for [drug] | 🟡 | Tool function | `drug_approvals` + `drug_products` derivable | Tool/function |
| HCL-10 | Wholesalers reporting stock of [shortage drug] | 🟠 | Data sparse | `supplier_inventory` sparse; no wholesaler feeds | Data source + Partnership |
| HCL-11 ⚠ | Pricing during recent shortages | 🟡 | Tool function | Same as SUP-07 | Tool/function |
| HCL-12 | Buffer stock based on historical resolution times | 🟠 | Data + tool | Resolution stats tool needed; consumption data needed | Tool/function (quick win #4 partial) + Data source |
| HCL-13 ⚠ | Clinically equivalent substitutes for [drug] | 🟠 | Data sparse | `drug_alternatives` ~100 drugs covered | Data source (curation effort) |
| HCL-14 | Substitutes themselves at risk | 🟢 | — | `find_substitutes` returns active_shortage_count | — |
| HCL-15 ⚠ | Dose conversions when switching | 🟠 | Data sparse | `dose_conversion_notes` sparse; high-stakes for retail | Data source + Refusal template |
| HCL-16 | Evidence base for substitution | 🟢 | — | `clinical_evidence_level` (A–E) exposed | — (where data exists) |
| HCL-17 ⚠ | Forecast back in supply + confidence | ⚫ | Forecast model | — | Forecast + Confidence |
| HCL-18 | Shortages likely to extend beyond stock holdings | ⚫ | Forecast model + data | — | Forecast + Data source |
| HCL-19 | Recurring shortage patterns we use | 🟠 | Data missing | Recurrence queryable; formulary missing | Data source + Tool/function |
| HCL-20 | Historical resolution time distribution per class | 🟡 | Tool function | — | Tool/function (quick win #4) |
| HCL-21 | Monthly hospital shortage exposure report | 🟠 | Data missing | Synthesis OK if formulary present | Data source |
| HCL-22 | Escalations for D&T Committee | 🟡 | Synthesis | Severity + duration + clinical impact composable | Tool/function |
| HCL-23 | Total clinical risk score across formulary | 🟠 | Data + model | Risk score model + formulary | Data source + Confidence model |
| HCL-24 | Board-ready summary of trends | 🟠 | Data missing | Synthesis OK if formulary present | Data source |
| HCL-25 | Sister hospitals / LHDs with stock | 🔴 | Data missing | No hospital-network inventory | Data source + Partnership |
| HCL-26 | Other hospitals in network with same shortage | 🔴 | Data missing | Same | Data source + Partnership |
| HCL-27 | Coordinate group purchasing | 🔴 | Data missing | No GPO membership data | Partnership |
| HCL-28 | Alert when formulary drug enters shortage | 🟡 | Data + tool | `user_watchlists` infra exists; formulary upload missing | Tool/function + Data source |
| HCL-29 ⚠ | Alert 30 days before forecast resolution | ⚫ | Forecast model | — | Forecast |
| HCL-30 | Alert when clinically critical drug loses last supplier | 🟡 | Tool function | Sponsor-count delta detection | Tool/function |

### 2.3 GOV — Government / national health system / regulator

| ID | Question | Status | Dominant gap | Root cause | Fix type |
|----|---|---|---|---|---|
| GOV-01 | Essential medicines in shortage in our country | 🟢 | — | `summarize_shortage_landscape` returns `who_essential_overlap` | — |
| GOV-02 | Essential meds with only one national supplier | 🟡 | Tool function | — | Tool/function (quick win #1) |
| GOV-03 | Therapeutic classes with highest concentration risk | 🟡 | Tool function | — | Tool/function (quick win #3) |
| GOV-04 | National supply dependent on single API source | 🟡 | Tool function | `api_supply_summary` + `drug_products` per country | Tool/function |
| GOV-05 | Shortage durations: us vs peers | 🟡 | Tool function | — | Tool/function (quick win #2 + #4) |
| GOV-06 | Compliance with mandatory shortage reporting | 🔴 | Data missing | No compliance metadata | Data source |
| GOV-07 | Suppliers with late / missing notifications | 🟠 | Schema legibility | No separate `first_reported_date` field on `shortage_events` | Schema legibility + Data source |
| GOV-08 | National shortage rate YoY | 🟡 | Tool function | `drug_status_snapshots` + `shortage_events.start_date` | Tool/function |
| GOV-09 | National formulary drugs at risk next tender cycle | 🟠 | Data missing | Formulary + tender cycle data | Data source |
| GOV-10 | Tender-awarded products currently in shortage | 🟠 | Data sparse | `price_type='tender'` exists; tender-award detail missing | Data source + Partnership |
| GOV-11 | Sole-supplier contracts to diversify | 🟡 | Tool function | Sole-source detection + supply risk | Tool/function (quick win #1) |
| GOV-12 ⚠ | Tender pricing expectation given supply pressure | ⚫ | Forecast model | Tender pricing model | Forecast + Data source |
| GOV-13 | Shortages unique to our country vs global | 🟡 | Tool function | — | Tool/function (quick win #2) |
| GOV-14 | Shortage burden vs AU / UK / CA / US / EU | 🟡 | Tool function | — | Tool/function (quick win #2) |
| GOV-15 | Peer countries that resolved what we still have | 🟡 | Tool function | — | Tool/function (quick win #2) |
| GOV-16 | Countries with surplus of what we lack | 🟠 | Data model | "Surplus" not modelled | Schema legibility |
| GOV-17 | Disproportionate paediatric / oncology / remote | 🟠 | Data partial | ATC OK; "remote" undefined | Schema legibility + Data source |
| GOV-18 | WHO EML drugs short here | 🟢 | — | WHO flag + country filter | — |
| GOV-19 | Low-cost generics at risk of disappearing | 🟡 | Tool function | `is_generic` flag + `drug_pricing_history` + `cancellation_date` | Tool/function |
| GOV-20 | Drugs to add to national reserve | 🟡 | Synthesis | Composable from shortage risk + WHO EML + sole-source | Tool/function |
| GOV-21 | Optimal reserve holding period | 🟡 | Tool function | Historical duration stats | Tool/function (quick win #4) |
| GOV-22 | Stockpiled products approaching expiry while short | 🔴 | Data missing | No stockpile inventory | Data source |
| GOV-23 | Shortages that would compound if supplier exited | 🟡 | Tool function | Counterfactual from sponsor counts | Tool/function |
| GOV-24 | Worst-case impact of 3-mo India/China API disruption | 🟡 | Tool function | `api_manufacturers` + concentration view | Tool/function |
| GOV-25 | Products needing emergency import pathway now | 🟡 | Synthesis | Severity + alt count + criticality | Tool/function |
| GOV-26 ⚠ | Indian / Chinese sites supplying us at risk | 🟠 | Scraper / data | India CDSCO broken; partial signal via `api_manufacturers` | Data source |
| GOV-27 | Drug classes with most concentrated upstream exposure | 🟡 | Tool function | — | Tool/function (quick win #3) |
| GOV-28 | Early signals of new shortages next quarter | 🟡 | Tool function | — | Tool/function (quick win #5) |
| GOV-29 | Quarterly national shortage report | 🟡 | Synthesis | Synthesis from existing data | Tool/function |
| GOV-30 | Alert when PBS/essential medicine enters shortage | 🟡 | Tool function | WHO flag + `pbs_listed` already on `drug_products`; alert type missing | Tool/function |

### 2.4 RET — Retail / community pharmacist

| ID | Question | Status | Dominant gap | Root cause | Fix type |
|----|---|---|---|---|---|
| RET-01 | Actually short or just my wholesaler out? | 🟢 | — | `get_drug_details` distinguishes national signal | — |
| RET-02 | Wholesalers with stock in my region | 🟠 | Data sparse | `supplier_inventory` sparse; no wholesaler integration | Data source + Partnership |
| RET-03 | Different brand / sponsor right now | 🟡 | Tool function | `drug_products` by sponsor + status | Tool/function |
| RET-04 | What pack sizes are still available | 🟡 | Tool function | `drug_products` pack info; no exposed tool | Tool/function |
| RET-05 | Closest available substitute at same dose | 🟢 | — | `find_substitutes` | — |
| RET-06 | Therapeutically equivalent or need prescriber approval | 🟡 | Tool function | `te_code` (Orange Book) + `equivalence_type` | Tool/function |
| RET-07 ⚠ | Regulator stance on generic substitution | 🟠 | Data partial | `te_code` US-only; per-country sub rules absent | Data source |
| RET-08 ⚠ | SSSI / Section 19A / SSP active for this drug | 🟠 | Data missing | Same as SUP-16 | Data source + Refusal template |
| RET-09 ⚠ | When available again | 🟠 | Confidence model | `estimated_resolution_date` partial + no confidence | Confidence model |
| RET-10 | Why short — for patient | 🟢 | — | `shortage_events.reason` + `reason_category` | — |
| RET-11 ⚠ | Safe to switch stable patient | 🟡 | Tool function | `requires_monitoring` + `monitoring_notes` exposed | Tool/function + Refusal template |
| RET-12 ⚠ | Counselling points when switching | 🟡 | Tool function + data | `dose_conversion_notes` sparse | Tool/function + Data source |
| RET-13 | Right alternative to suggest to GP | 🟢 | — | `find_substitutes` | — |
| RET-14 | Prescriber note for the shortage + substitute | 🟢 | — | Synthesis from existing tool outputs | — |
| RET-15 | Is prescriber already aware | 🟠 | Data missing | Inferable from severity/duration; not deterministic | Schema legibility |
| RET-16 | Drugs in my regular order at risk next 30 days | 🟡 | Tool function | `user_watchlists` + predictive-signals | Tool/function (quick win #5) |
| RET-17 ⚠ | Stock up before forecast shortage | ⚫ | Forecast model | — | Forecast |
| RET-18 | Slow-moving lines at risk of permanent discontinue | 🟡 | Tool function | `cancellation_date` + `registry_status` | Tool/function |
| RET-19 | Alt brands to add to standing order | 🟡 | Tool function | `drug_products` by sponsor + alternatives | Tool/function |
| RET-20 ⚠ | How long to hold an owe-med | ⚫ | Forecast model | — | Forecast |
| RET-21 ⚠ | Drugs back within 7 / 14 / 30 days | 🟠 | Confidence model | `estimated_resolution_date` partial | Confidence model + Forecast |
| RET-22 ⚠ | When back + confidence | 🟠 | Confidence model | Same | Confidence model |
| RET-23 | Recurring shortage to plan around | 🟢 | — | Drug card recurrence count | — |
| RET-24 | Class-level risk | 🟢 | — | `get_class_summary` trend | — |
| RET-25 ⚠ | Legal substitutions w/o prescriber contact | 🟠 | Data missing | Country sub rules not in DB | Data source + Refusal template |
| RET-26 | Shortage-specific guidance issued | 🟡 | Tool function | `management_action` on `shortage_events` (TGA) | Tool/function |
| RET-27 ⚠ | Approved overseas alt under shortage provisions | 🟠 | Data missing | Same as SUP-16 | Data source |
| RET-28 | Alert when available again | 🟢 | — | Watchlist + status_log infra exists | — |
| RET-29 | Alert when commonly-dispensed drug enters shortage | 🟡 | Tool function | Formulary upload pattern needed | Tool/function |
| RET-30 | Alert when shortage guidance changes | 🟡 | Tool function | Diff detection on `management_action` | Tool/function |

### 2.5 HPR — Hospital procurement pharmacist

| ID | Question | Status | Dominant gap | Root cause | Fix type |
|----|---|---|---|---|---|
| HPR-01 | Contracted suppliers with worst 12-mo shortage record | 🟠 | Data missing | No contracted-supplier set per hospital | Data source |
| HPR-02 | Suppliers who fail to notify ahead | 🟠 | Schema legibility | `first_reported_date` not separate from `start_date` | Schema legibility + Data source |
| HPR-03 | Fill rate of [supplier] across our SKUs | 🔴 | Data missing | No fill-rate / order-fulfilment data | Data source + Partnership |
| HPR-04 | Suppliers improved/deteriorated QoQ | 🟡 | Tool function | `shortage_events` by `manufacturer_id` over time | Tool/function |
| HPR-05 | Tender-renewal products with supply risk | 🟠 | Data missing | Tender-renewal calendar missing | Data source |
| HPR-06 | Sole-source contracts most exposed | 🟠 | Data missing | Contract layer missing; supply risk derivable | Data source + Tool/function |
| HPR-07 | Approved alt suppliers for at-risk products | 🟡 | Tool function | — | Tool/function |
| HPR-08 | Contract clauses to strengthen | 🟡 | Synthesis | Web_search composition acceptable | Tool/function |
| HPR-09 | Below safety stock given forecast | 🟠 | Data missing | Hospital stock + forecast | Data source + Forecast |
| HPR-10 | Buffer to hold based on historical duration | 🟡 | Tool function | — | Tool/function (quick win #4) |
| HPR-11 | Active shortages within current stock cover | 🟠 | Data missing | Hospital stock | Data source |
| HPR-12 | Products to expedite ordering on | 🟠 | Data + forecast | Severity + forecast + stock | Multi |
| HPR-13 ⚠ | Cost premium for emergency channels right now | 🔴 | Data missing | Emergency-channel pricing not captured | Data source + Partnership |
| HPR-14 | Total budget impact of active shortages this Q | 🟠 | Data missing | Volume + price | Data source |
| HPR-15 | Shortages forcing most expensive substitutions | 🟡 | Tool function | `drug_pricing_history` + `find_substitutes` | Tool/function |
| HPR-16 ⚠ | Price elevated vs baseline contract rate | 🟠 | Data missing | No contract baseline | Data source |
| HPR-17 | Registered alt suppliers fulfilling today | 🟡 | Tool function | — | Tool/function |
| HPR-18 ⚠ | Overseas-registered products under shortage provisions | 🟠 | Data missing | Same as SUP-16 | Data source + Refusal template |
| HPR-19 | Compounders that can supply | 🔴 | Data missing | No compounder registry | Data source |
| HPR-20 | Other hospitals/networks with stock for transfer | 🔴 | Data missing | Same as HCL-25 | Data source + Partnership |
| HPR-21 | Hospital-approved substitutes for [drug] | 🟠 | Data missing | Hospital-specific approval list | Data source |
| HPR-22 | Switching-trap substitutes themselves at risk | 🟢 | — | `find_substitutes` returns `active_shortage_count` | — |
| HPR-23 ⚠ | Cost differential of switch across patient volume | 🔴 | Data missing | Patient volume + pricing | Data source + Partnership |
| HPR-24 | Aggregate exposure across our network | 🔴 | Data missing | Hospital network | Data source + Partnership |
| HPR-25 | Stock concentrated vs depleted in network | 🔴 | Data missing | Same | Data source + Partnership |
| HPR-26 | Redistribute stock between sites | 🔴 | Data missing | Same | Data source + Partnership |
| HPR-27 ⚠ | Forecast return + confidence | ⚫ | Forecast model | — | Forecast |
| HPR-28 | Shortages extending past 90 days | ⚫ | Forecast model | — | Forecast |
| HPR-29 | Monthly supplier-performance + exposure report | 🟠 | Synthesis | Formulary + contract data | Data source |
| HPR-30 | Alert: contracted product enters shortage with pre-loaded options | 🟡 | Tool function | Formulary + alert composition | Tool/function + Data source |

---

## 3. LLM ↔ DB integration architecture recommendation

### 3.1 Options evaluated

| Approach | Latency | Schema/prompt drift risk | Cost/query | Citation/provenance | Read-only safety | Scale (tool count) |
|---|---|---|---|---|---|---|
| **Text-to-SQL** (LLM writes SQL against Supabase) | Medium — round-trip planning + execute | **High** — schema legibility issues (`drug_catalogue` missing, ambiguous timestamps, dual status enums) will cause silent wrong queries | Medium — fewer tool defs, but more retries on bad SQL | Hard — must teach the LLM to include provenance columns in every SELECT, easy to drop them | Risky — needs hard guardrails (row-limit, read-only role, query parser) | Excellent — no tool list |
| **Tool-use / function-calling** (current approach, 9 tools) | Low — one API call per typed call, no SQL planning | **Low** — typed signatures freeze contracts; schema changes contained to tool implementation | Low — small per-call cost | Excellent — tools compute `sources_consulted` and return it as a structured block (already shipped) | Excellent — only callables exposed; service-role key never visible to LLM | Concern — Anthropic supports many tools but context cost + ambiguity rise above ~25 |
| **MCP server** (Supabase as MCP) | Medium — extra hop | Medium — similar to text-to-SQL once tool surface auto-derived, but better separation | Medium | Medium — depends on how MCP exposes provenance | Good — RLS still enforced | Excellent — discoverable surface |
| **Semantic / metrics layer** (Cube, dbt-metrics) | Medium | Low — metrics are versioned contracts | Medium | Excellent — provenance can be modelled as a dimension | Excellent — read-only by construction | Excellent — metrics ≠ tools, both surfaces co-exist |
| **RAG over materialised views** | Lowest — pure lookup | High — views must stay in sync; chunking obscures structure | Lowest — no LLM reasoning over rows | Medium — provenance must be embedded in view rows | Excellent | Excellent |

### 3.2 Recommendation — **stay tool-use, add discipline; defer MCP and metrics layer**

Mederti is already on the tool-use path and the path is the right one for this product. The audit confirms three things that make text-to-SQL the wrong pivot:

1. **Schema legibility is uneven.** `drug_catalogue` is referenced but not created (migration 026 adds columns to a non-existent table). `shortage_events` has four overlapping timestamp fields (`start_date`, `end_date`, `estimated_resolution_date`, `last_verified_at`, plus `created_at`/`updated_at`) with subtle semantics that the schema agent flagged repeatedly. `drug_availability.status` and `shortage_events.status` use different enums for overlapping concepts. A text-to-SQL agent will write wrong-looking-right queries against these.
2. **Citation/provenance plumbing already lives in tools.** The `computeSourcesConsulted()` helper in [frontend/lib/chat/tools.ts](frontend/lib/chat/tools.ts) builds the `<sources>` chip data from `data_sources.last_scraped_at` + per-row counts. Moving that into raw SQL means re-implementing it in every query. Keeping it in tools means the provenance contract is one function.
3. **Coverage gates are encoded in code** ([frontend/lib/chat/coverage.ts](frontend/lib/chat/coverage.ts) — live vs stale vs not_indexed country sets). Text-to-SQL would have no way to refuse cleanly for not-indexed countries; the LLM would silently SELECT zero rows and pretend "no data" means "no shortage."

The right move is to **scale the tool surface from 9 to ~25 typed callables** (see §4), with three pieces of infrastructure added around them:

1. **Confidence as a tool-output contract.** Every tool that returns a number or a forecast must also return `{value, confidence: "low"|"medium"|"high", confidence_basis: string}`. Implement v1 as a rules-based scoring function (`freshness × source_reliability × signal_count`) shared across tools.
2. **Refusal templates as first-class returns.** When a tool can't answer (not-indexed country, missing data, missing eligibility table), it must return `{status: "unanswerable", reason: <enum>, hint: <human>}` rather than empty rows. The system prompt is already 90% there; the contract makes it deterministic.
3. **An eval harness over the 150 questions** that runs after every system-prompt change. See §6.

When the tool count crosses ~20 and persona-specific tool surfaces start to drift, **then** introduce an MCP server to expose them — but as a multiplexer over the existing typed callables, not as a Supabase-direct-query mechanism. MCP gives discovery and tool-set scoping per persona; it doesn't change the underlying contracts.

A **semantic / metrics layer (Cube or dbt-metrics)** is the right destination if a public API tier ships — at that point shortages-burden-by-country, recurrence-rate, concentration-risk become versioned metrics consumed by both the LLM and external customers. Not needed now.

**Do not pursue:**
- **Pure RAG over materialised views.** It would hide structure and force re-chunking on every schema change. Use materialised views as inputs to typed tools, not as the LLM's primary surface.
- **Text-to-SQL** until schema legibility (§5) is fixed. Even then, keep it as a fallback for unanticipated queries — not the default path.

### 3.3 The current `/chat` architecture, in one diagram

```
User question
    ↓
/api/chat (Claude Opus 4-7, adaptive thinking, 16k output, max 12 tool iterations)
    ├── system-prompt.ts          ← persona JTBD routing, coverage honesty, refusal rules
    ├── coverage.ts               ← live/stale/not-indexed country sets
    ├── tools.ts (9 tools)        ← all typed; all return sources_consulted block
    │     ├── search_drugs
    │     ├── get_drug_details
    │     ├── find_substitutes
    │     ├── list_active_shortages
    │     ├── summarize_shortage_landscape
    │     ├── get_class_summary
    │     ├── get_trade_prices
    │     ├── search_recalls
    │     └── query_intelligence_sources
    ├── web_search_20250305       ← Anthropic server tool, max 5 uses
    └── computeSourcesConsulted() ← regulator + freshness label, drives <sources> chip
              ↓
        <drug_card />, <class_card />, <sub_card />, <kpis>, <sources>, <followups>
              ↓
        Chat2Client renders, Markdown tables for >2 items
```

This architecture is fundamentally sound. The audit's job is to expand the **tool list** to match the **table list**, not change the architecture.

---

## 4. Tool / function inventory needed

Existing 9 tools cover roughly 35% of the question bank well. The list below is the **target surface** to reach the product standard. New tools marked **(NEW)**; existing tools marked **(EXISTS)** with notes on what to extend.

### 4.1 Shortage retrieval & filtering

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| `search_drugs` (EXISTS) | `(query, country?, limit?)` | `drugs`, FTS | foundational |
| `get_drug_details` (EXISTS) | `(drug_id)` | `drugs`, `shortage_events`, `data_sources`, external_ids | foundational |
| `list_active_shortages` (EXISTS) | `(country?, severity?, atc_prefix?, manufacturer?, limit?)` | `shortage_events`, `drugs`, `sponsors`, `drug_products` | SUP-01, SUP-10, HCL-03, GOV-01, RET-01 |
| `summarize_shortage_landscape` (EXISTS) | `(atc_prefix?, country?, severity?, top_n?)` | `shortage_events`, `drugs` | GOV-01, GOV-18, HCL-03, SUP-10 |
| **`get_country_unique_shortages`** (NEW) | `(country, vs_countries?)` | `shortage_events` diff | GOV-13, SUP-05 |
| **`compare_shortage_burden`** (NEW, quick win #2) | `(country, peer_set?)` → per-country count/sev/who_eml/top_drugs | `shortage_events` GROUP BY | GOV-13, GOV-14, GOV-15, GOV-05, SUP-05 |
| **`get_recurring_shortages`** (NEW) | `(drug_id? \| atc_prefix?, country?, since?)` | `shortage_events` recurrence count | SUP-22, RET-23, HCL-19 (deepens drug card data) |
| **`get_shortage_history`** (NEW) | `(drug_id, country?)` | `shortage_events` time series | SUP-22, RET-23 |

### 4.2 Substitute lookup

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| `find_substitutes` (EXISTS) | `(drug_id, country?, limit?)` returns evidence, monitoring, dose_conv | `drug_alternatives`, `drugs`, `shortage_events` | RET-05, RET-13, HCL-13, HCL-14 |
| **`get_therapeutic_equivalents`** (NEW) | `(drug_id, country)` — Orange Book / WHO EML grade | `therapeutic_equivalents`, `drug_approvals.te_code` | RET-06, HPR-17 |
| **`get_dose_conversion`** (NEW) | `(from_drug_id, to_drug_id)` — returns notes + monitoring + refusal if missing | `drug_alternatives` | HCL-15, RET-12 (with refusal template; high hallucination risk) |
| **`get_available_brands`** (NEW) | `(drug_id, country)` — sponsor × strength × pack | `drug_products`, `sponsors` | RET-03, RET-04, RET-19, SUP-11 |

### 4.3 Forecasting & confidence

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| **`get_resolution_time_stats`** (NEW, quick win #4) | `(drug_id \| atc_prefix, country?)` — median/p25/p75 days | `shortage_events` resolved | HCL-12, HCL-20, HPR-10, GOV-21, SUP-22 |
| **`get_predictive_signals`** (NEW, quick win #5) | `(country, drug_ids?)` — wrap `/api/predictive-signals` | peer-set lead-time analysis (16 EU peers) | SUP-25, GOV-28, HCL-05, RET-16 |
| **`get_resolution_forecast`** (NEW, BLACK) | `(drug_id, country)` → `{eta_date, confidence_pct, method, basis_count}` | needs new model | SUP-19, SUP-20, HCL-17, HCL-29, HPR-27, HPR-28, RET-17, RET-20, RET-21, RET-22 — gated on forecast model |

### 4.4 Supplier & competitor intelligence

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| `get_trade_prices` (EXISTS) | `(drug_id, countries?)` | `supplier_inventory` | sparse; HCL-10 partial |
| `search_recalls` (EXISTS) | `(query, country?, since?, limit?)` | `recalls` | SUP-12 partial |
| **`get_supplier_shortage_record`** (NEW) | `(manufacturer_or_sponsor, since?, country?)` | `shortage_events.manufacturer_id`, `sponsors` | HPR-01, HPR-04, GOV-07 |
| **`get_recent_deregistrations`** (NEW) | `(drug_id?, country?, since?)` | `drug_products.cancellation_date`, `registry_status` | SUP-13, RET-18 |
| **`get_facility_distress_signals`** (NEW) | `(country?, drug_id?)` — recent OAI / warning letters / import alerts | `manufacturing_facilities` | SUP-12, SUP-23, GOV-26 (partial — coverage of US/EU only) |
| **`get_price_around_shortage`** (NEW) | `(drug_id, country, ±days)` | `drug_pricing_history`, `shortage_events` | SUP-07, HCL-11, HPR-15, HPR-16 |

### 4.5 Peer-country comparison

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| `compare_shortage_burden` (NEW, listed above) | — | — | GOV-14, GOV-13, GOV-15, GOV-05 |
| **`get_peer_resolved_shortages`** (NEW) | `(drug_id, our_country, peer_countries)` — drugs peers have resolved that we haven't | `shortage_events` cross-country | GOV-15 |

### 4.6 Sole-source / concentration

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| **`get_sole_source_essentials`** (NEW, quick win #1) | `(country, who_only?)` | `drugs.who_essential_medicine` + active `drug_products` count | SUP-02, GOV-02, GOV-19, GOV-11 |
| **`get_class_concentration_risk`** (NEW, quick win #3) | `(atc_prefix, country?)` | `v_drug_manufacturer_concentration` aggregated | SUP-24, GOV-03, GOV-04, GOV-27, HCL-08 |
| **`get_api_concentration`** (NEW) | `(drug_id)` — manufacturer count + DMF/CEP/PQ counts + country mix | `api_supply_summary`, `api_manufacturers` | SUP-23, GOV-24, GOV-26 (partial) |

### 4.7 Recall & regulatory event lookup

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| `search_recalls` (EXISTS) | — | `recalls` | foundational |
| **`get_recall_links`** (NEW) | `(drug_id)` — recall→shortage causal links | `recall_shortage_links` | strengthens SUP-12, HPR/HCL provenance |
| **`get_regulatory_events`** (NEW) | `(drug_id?, since?, until?, authority?)` | `regulatory_events` | indirectly unlocks HPR-12, HCL-22 |
| **`get_management_guidance`** (NEW) | `(drug_id, country?)` — surface `management_action` text | `shortage_events.management_action` | RET-26, RET-30 (diff detection) |

### 4.8 Alert & subscription management (authenticated user tools)

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| **`get_my_portfolio_status`** (NEW, auth) | `()` — for logged-in user, return shortage status of every drug in watchlist + portfolio | `user_watchlists`, `supplier_portfolios`, `shortage_events` | SUP-03, RET-16, HCL-01 (partial — needs formulary upload pattern) |
| **`set_portfolio_alert`** (NEW, auth) | `(scope, channel)` | `user_watchlists` extension | SUP-29, RET-29, HCL-28, HPR-30 |
| **`get_watchlist_demand`** (NEW, auth-supplier) | `(drug_ids?, country?)` — anonymized count of users watching | `user_watchlists` aggregation, k-anonymity ≥ 5 | SUP-28 (privacy-safe partial demand signal) |

### 4.9 Report & document generation

| Tool | Signature | Backing tables | Unlocks |
|---|---|---|---|
| **`generate_shortage_brief`** (NEW) | `(scope: country \| atc_prefix \| drug_id, period, audience)` | composes existing tools | GOV-29, HCL-21, HCL-24, HPR-29 |
| **`generate_prescriber_note`** (NEW) | `(drug_id, substitute_drug_id?)` | drug + substitute + reason + policy | RET-14 (already implicit) |

**Total new tools:** ~16. **Existing:** 9. **Target surface:** ~25 typed callables. Anthropic tool-use comfortably handles this count.

---

## 5. Schema legibility audit

The schema is well-named and FK-clean overall (7.5/10). The high-value `COMMENT ON COLUMN` work is the cheapest possible LLM-quality lift — text-to-SQL agents would benefit immediately, and even typed-tool authors lean on these comments when adding new tools.

### 5.1 Critical issues (must fix before scaling tool surface)

1. ~~**`drug_catalogue` table is referenced but never created.**~~ **Correction (Sprint 1 Step 2, 2026-05-27):** the table exists in production — 160,977 rows, 26 columns, referenced by 7+ backend scripts. The audit's schema agent only inspected `supabase/migrations/` and didn't find a `CREATE TABLE` statement, but the table was created outside the migration sequence (Supabase dashboard or a squashed migration). Migration 026's `ALTER TABLE drug_catalogue` was always valid against production. **Resolution:** migration `036_schema_legibility.sql` adds a documenting `CREATE TABLE IF NOT EXISTS drug_catalogue (...)` that retroactively codifies the production schema for fresh-clone reproducibility. The original audit finding was wrong about the impact, but right about the audit-trail gap.
2. **Dual-status enums for the same product reality.** `shortage_events.status` (active/resolved/anticipated/stale) and `drug_availability.status` (available/shortage/limited/discontinued/recalled). Both can be authoritative for "is X available right now?" An LLM doesn't know which to query. **Action:** add table-level comments documenting the authoritative-for relationship.
3. **Timestamp semantics on `shortage_events`.** Six time fields — `start_date`, `end_date`, `estimated_resolution_date`, `last_verified_at`, `created_at`, `updated_at`. The chat answer for "how long has this drug been short?" needs to know **which one** is the answer (it's `start_date`, but the LLM can't tell that without help). **Action:** add column comments per §5.4 below.

### 5.2 High-value issues (fix when convenient)

4. **`source_confidence_score` vs `reliability_weight` precedence.** Two confidence-ish numbers on different tables; precedence undocumented. **Action:** add column comments.
5. **`recall_class` is FDA-specific.** EMA/MHRA/TGA recall classification differs. Recalls from non-US regulators get mapped at scrape time, but the mapping is implicit. **Action:** comment.
6. **`controlled_substance_schedule` is jurisdiction-mixed.** Values include "Schedule II" (US DEA), "Class A" (UK), "S8" (AU). An LLM filtering by schedule across countries will treat them as comparable. **Action:** either split into `schedule_us` / `schedule_au` / etc., or comment that values are per-jurisdiction and not cross-comparable.
7. **`registry_status` on `drug_products` is enum-soup.** Values come from different country registries (ARTG: Active/Cancelled; PL: Authorised/Suspended; etc.). **Action:** document expected values per source.
8. **`supplier_inventory.quantity_available` and `supplier_quotes.available_quantity` are TEXT.** Means "1000 units", "50 packs", "5 vials" all land in the same field. **Action:** add comment, or migrate to `(quantity NUMERIC, quantity_unit TEXT)`.
9. **`alert_notifications.shortage_event_id` is now nullable (for recall alerts) but the recall is not directly addressable.** Drug derivation via `watchlist_id → user_watchlists.drug_id`. **Action:** comment so consumers don't assume `shortage_event_id` is always set.

### 5.3 LLM-specific clarifications

10. **No `first_reported_date` separate from `start_date`.** Several questions (GOV-07, HPR-02) hinge on whether a supplier reported a shortage *before* it began. The current schema conflates "when it started" with "when we noticed". **Action:** add `first_reported_date DATE` (nullable) to `shortage_events`; backfill where source data permits.
11. **`who_essential` on `active_ingredients` is unclear scope.** Is it the WHO EML for adults, paediatrics, both? **Action:** comment.
12. **`intelligence_sources` is mostly TEXT free-form.** Categorical columns (`category`, `subcategory`, `geography_coverage`) would benefit from CHECK constraints listing canonical values. Currently the LLM filters via substring match on TEXT.

### 5.4 Recommended `COMMENT ON COLUMN` additions

The full list is in the source schema-audit report. The top ten that should ship immediately (one migration, ~30 lines, no data risk):

```sql
COMMENT ON COLUMN shortage_events.start_date IS
  'Date shortage began per source regulator. May differ from scraper discovery date. Nullable; defaults to CURRENT_DATE when source provides none.';

COMMENT ON COLUMN shortage_events.last_verified_at IS
  'Timestamp of last scraper run that confirmed this shortage in its output. mark_stale_shortages() moves rows with last_verified_at > 7d to status=stale.';

COMMENT ON COLUMN shortage_events.estimated_resolution_date IS
  'Regulator-supplied estimate. NOT a Mederti forecast. Treat as low-confidence and never present without explicit caveat.';

COMMENT ON COLUMN shortage_events.source_confidence_score IS
  '0-100. Overrides data_sources.reliability_weight for this signal. NULL = use data_sources.reliability_weight.';

COMMENT ON COLUMN shortage_events.status IS
  'Regulator-reported shortage state: active | resolved | anticipated | stale. For per-country product availability use drug_availability.status instead.';

COMMENT ON COLUMN drug_availability.status IS
  'Aggregate availability state per product per country: available | shortage | limited | discontinued | recalled. For regulator-declared shortage events use shortage_events.status.';

COMMENT ON COLUMN drugs.who_essential_medicine IS
  'TRUE if on the current WHO Essential Medicines List. See who_eml_section and who_eml_year for section / year.';

COMMENT ON COLUMN recalls.recall_class IS
  'FDA classification (I/II/III/Unclassified). Non-US recalls mapped to nearest equivalent at scrape time; mapping is approximate.';

COMMENT ON COLUMN drug_products.registry_status IS
  'Country-specific registration status. Values vary by source (ARTG: Active/Cancelled; PL: Authorised/Suspended; etc.). See raw_data for source-native value.';

COMMENT ON COLUMN alert_notifications.shortage_event_id IS
  'FK to shortage_events. Nullable since v007 to support recall alerts. For recall alerts, the affected drug is at watchlist.drug_id.';
```

---

## 6. Eval framework

The 150 questions **are** the production eval suite. Recommendation: build a thin pytest harness that calls the live `/api/chat` route, runs each question, and grades against deterministic + LLM-judge criteria.

### 6.1 File structure

```
evals/
├── questions/
│   ├── sup.yaml          # 30 questions × {id, persona, text, expected_tools, expected_tables, expected_confidence_type, gold_answer_path?}
│   ├── hcl.yaml
│   ├── gov.yaml
│   ├── ret.yaml
│   └── hpr.yaml
├── gold/                 # 10 hand-graded gold answers for judge calibration
│   ├── SUP-01.md
│   ├── RET-05.md
│   └── ...
├── rubric/
│   └── product_standard.yaml   # six-dimension scoring rubric
├── runner/
│   ├── run_eval.py       # pytest harness
│   ├── grader_deterministic.py   # checks tool calls, citation block presence, country coverage gate
│   └── grader_judge.py   # Claude-as-judge against rubric
└── reports/
    └── 2026-05-27_baseline.md
```

### 6.2 Per-question YAML schema

```yaml
- id: SUP-02
  persona: SUP
  text: "Which essential medicines currently have zero or single-source supply in [market]?"
  context_variables:
    market: AU
  expected_status: yellow   # what the audit says it should be today
  expected_tools_min:
    - get_drug_details          # or get_sole_source_essentials when shipped
  expected_tables:              # at least one row must reference
    - drugs
    - drug_products
    - shortage_events
  expected_provenance:
    must_emit_sources_block: true
    min_regulators_cited: 1
  expected_confidence:
    type: rules_based            # or none / forecast / qualitative
    must_state_basis: true
  refusal_acceptable: false      # refusing this question is a failure
  hallucination_risk: false
```

### 6.3 Grading rubric (six dimensions of the product standard)

LLM-as-judge prompted with the gold answer + the model's answer + this rubric:

| Dimension | Pass criterion | Scoring |
|---|---|---|
| **Factually correct** | All numeric claims match DB rows when the runner re-queries; no claims about countries outside coverage gate | binary |
| **Sourced** | `<sources>` block present (or explicit "macro answer, no DB rows" disclaimer); every regulator cited matches a real `data_sources` row | binary |
| **Confidence-calibrated** | Forecast/comparative answers state confidence; sparse-data answers say so explicitly; never present `estimated_resolution_date` as Mederti forecast | binary |
| **Clean refusal** | If data missing, explicit "Mederti doesn't track X"; never falls through to confabulation | binary |
| **Persona-aware** | If persona signaled (or context variable set), answer shape matches JTBD routing in system prompt | 0–2 (none/partial/full) |
| **Synthesised** | Composes ≥2 data points where the question demands it (comparative / forecast / strategic); not a raw row dump | 0–2 |

A question passes only if all four binary dimensions pass *and* the 0–2 dimensions score ≥ 1.

### 6.4 Gold standard sample (10 questions for judge calibration)

Hand-grade these by a pharmacist + a developer; use as judge anchors:

- SUP-01 (basic retrieval, must pass)
- SUP-19 ⚠ (forecast risk; must demonstrate calibrated refusal)
- HCL-13 ⚠ (substitute coverage caveat)
- HCL-15 ⚠ (dose conversion — must refuse if missing, not invent)
- GOV-01 (essentials filter)
- GOV-14 (peer comparison synthesis)
- RET-05 (substitute happy path)
- RET-08 ⚠ (Section 19A / SSP eligibility — refusal template critical)
- HPR-25 (network stock — must say "Mederti doesn't track hospital network inventory")
- SUP-23 ⚠ (India/China API distress — must caveat scraper status)

### 6.5 CI integration

Hook into Vercel preview deploys via a GitHub Action:
1. On every PR, run a 30-question sub-suite (6 per persona, weighted toward GREEN + ⚠ questions) against the preview deploy.
2. Post a comment with pass-rate delta vs `main`.
3. Full 150-question run nightly on `main` against production.
4. Publish a public coverage badge linked from `/about` once pass rate exceeds 75% — credibility lever for "world's leading source" positioning.

Token cost: ~50k tokens per full 150-question run with Opus 4.7 + 9 tools + web_search. At current pricing, roughly $5–10 per full run. Acceptable for daily CI.

### 6.6 Tool-call assertions

For deterministic grading without judge LLM cost, log per-question:
- Which tools were called, in what order
- Tool call success/error rate
- Whether `sources_consulted` was non-empty when expected
- Token usage in/out, latency
- Whether the answer hit MAX_ITERATIONS (truncation flag)

These rolling metrics surface regressions before the judge does.

---

## 7. Confidence and citation infrastructure

### 7.1 Provenance flow (already shipped — works well)

```
shortage_events row
   → computeSourcesConsulted() in tools.ts
      → lookup data_sources by country_code (REGULATORS map, ~28 entries)
      → join last_scraped_at
      → calculate freshness_label (stale threshold = 7 days)
   → SourceConsulted { regulator_code, country_code, rows_contributed,
                       latest_event_date, last_scraped_at, source_url,
                       freshness_label, is_stale }
   → attached to tool result (.sources_consulted[])
   → Claude verbatim-copies freshness_label into <sources> block
   → Chat2Client renders as inline pill with stale/fresh visual flag
```

This is the production standard and should be the reference implementation when adding new tools. **Rule:** every new tool that returns row data must also return `sources_consulted` populated by the same helper.

### 7.2 Confidence — what's missing and how to add it

There is **no structured confidence model today**. The model gets implicit calibration from prompt rules ("if `severity_fallback_applied=true`, surface caveat honestly") and from the freshness chip in the rendered answer. For forecasting and comparative questions, that is insufficient.

**Recommendation — v1 rules-based confidence score, ship in week one:**

```typescript
// shared across tools
function computeConfidence(opts: {
  sourceReliability: number;       // 0-1 from data_sources.reliability_weight
  signalCount: number;             // how many rows backed the answer
  freshnessDays: number;           // max age of supporting rows
  sourceConfidenceOverride?: number;  // shortage_events.source_confidence_score, 0-100
}): { level: "low" | "medium" | "high"; score: number; basis: string }
```

Composition:
- `score = sourceReliability × min(1, signalCount/3) × freshnessFactor(freshnessDays)`
- `level`: ≥0.75 = high, 0.50–0.74 = medium, < 0.50 = low
- `basis`: human-readable, e.g. "TGA + EMA, both scraped today, 4 supporting events"

Every tool returns `{value, confidence}`. System prompt rule: when `confidence: "low"`, the model must use a hedging phrase ("regulator-reported", "single source", "not yet corroborated") and must not render a forecast-style date.

**Recommendation — v2 forecast confidence, quarterly project:**
- Train a survival model on resolved `shortage_events` (start → end durations) keyed by `reason_category`, `atc_prefix`, `country`, `severity`.
- Output: `{eta_p50, eta_p25, eta_p75, model_version, basis_count}`.
- Returned by `get_resolution_forecast` only when basis_count ≥ N (probably 10).
- Critical safety rail: never overrides regulator-supplied `estimated_resolution_date` for clinical questions — it's an alternative signal, presented alongside.

### 7.3 "Low confidence" / "data missing" answer templates

These belong in the system prompt as canonical patterns, so the LLM produces them consistently. Five standard shapes:

1. **Country not indexed.**
   > "Mederti doesn't currently track shortage signals from [country]. Regulators we do index: [list]. If you can confirm whether [country] publishes a shortage register, we can prioritize adding it."

2. **Country indexed but stale (GB, SG today).**
   > "Last scrape from [regulator] was [N days] ago — the data is **stale** relative to our 7-day freshness target. Treat the count as a lower bound."

3. **Data field missing on row.**
   > "[Regulator] reported the shortage but did not publish [field]. Common for [reason — e.g. dosage-form-specific signals]."

4. **Forecast unavailable.**
   > "Mederti doesn't yet ship a forecast for shortage resolution. The regulator's own estimate is [date], which is a typed-in field and not confidence-calibrated. Use it as a directional hint, not a planning anchor."

5. **Eligibility / regulatory rule not in DB.**
   > "Eligibility for [Section 19A / SSP / 503B / Article 5(2)] is determined by [regulator] on a per-application basis. Mederti doesn't index the live eligibility list. Canonical source: [URL]."

These templates eliminate the most common hallucination modes by giving the LLM somewhere to land.

### 7.4 Citation rendering pattern

Already shipped — keep it. Three visual elements:
- **Inline `<sources>` chip strip** — one chip per regulator, color-coded by freshness
- **Drill-down on chip click** — links to the source regulator page (via `source_url` on `data_sources` or per-row `source_url`)
- **`<followups>` row** — three short questions, chosen to deepen the chain (consistent with current behavior)

Recommendation: add a "Why this answer?" affordance on every answer card that opens a panel showing each tool called, the rows returned, and the prompt-side reasoning chain. Optional for v1; high-credibility for institutional users.

---

## 8. Gap clusters

Ordered by total questions unlocked per unit of engineering effort.

### Cluster A — **Typed-tool plumbing (the YELLOW unlock)**

- **Affected questions:** ~45 across all personas (mainly SUP-02/05/07/11/13/14/24/25/28/29/30, HCL-02/07/08/09/11/20/22/30, GOV-02/03/04/05/08/11/13/14/15/19/20/21/23/24/25/27/28/29/30, RET-03/04/06/16/18/19/26/29/30, HPR-04/07/08/10/15/17/30)
- **Estimated effort:** Medium. ~16 new tools at ~½ day each = ~8 engineer-days.
- **Dependencies:** Confidence helper (§7.2 v1). Tool-call logging for eval harness.
- **Fix type:** Tool/function.

### Cluster B — **Hospital & procurement operational substrate (the HPR red wall)**

- **Affected questions:** ~25 (most of HPR + HCL-01/05/06/19/21/23/24/25/26/27/28)
- **Estimated effort:** Large. Needs a hospital-network entity model (`hospital`, `hospital_formulary`, `hospital_supplier_contract`, `hospital_stock_position`), an upload primitive, and ideally GPO/wholesaler partnerships.
- **Dependencies:** User-side: CSV upload UX, RLS policies, multi-tenant isolation. Partnership: wholesaler stock feeds, GPO data, or aggregator agreement.
- **Fix type:** Data source + Partnership + Schema.

### Cluster C — **Forecasting & confidence (the BLACK list)**

- **Affected questions:** ~11 (SUP-19/20/21, HCL-17/18/29, RET-17/20/21/22, HPR-27/28, GOV-12)
- **Estimated effort:** Large. v1 rules-based confidence on every tool (1–2 weeks); v2 statistical/ML forecast model (one-quarter project).
- **Dependencies:** Cluster A delivers the signal volume needed. Eval harness needed to validate calibration.
- **Fix type:** Confidence model + Forecast model.

### Cluster D — **Demand telemetry & buyer-search signal**

- **Affected questions:** ~6 (SUP-08/09/26/27/28, RET-15 indirect)
- **Estimated effort:** Small to ship a `demand_signals` table + instrumentation; large to make the signal meaningful (needs volume).
- **Dependencies:** Privacy review (especially for k-anonymous buyer signals).
- **Fix type:** Data source + new schema.

### Cluster E — **Regulatory eligibility & substitution rules database**

- **Affected questions:** ~8 ⚠ (SUP-15/16/17/18, RET-07/08/25/27, HPR-18)
- **Estimated effort:** Medium. Country-by-country research and ingest. Some is web-scrapable (TGA Section 19A page, NHS BSA SSP); some requires manual curation.
- **Dependencies:** None hard. Highest-stakes hallucination cluster — refusal templates from §7.3 should ship as guardrail *before* the data lands.
- **Fix type:** Data source + Refusal template (immediate).

### Cluster F — **India / Israel / Hong Kong scraper unblock**

- **Affected questions:** ~5 directly (SUP-23, GOV-26, plus regional coverage in landscape questions).
- **Estimated effort:** Small per scraper (1–3 days each). India CDSCO: re-engineer selectors. Israel MOH: add Playwright. HK Drug Office: fix javascript: URL bug.
- **Dependencies:** Playwright infra in Railway for Israel.
- **Fix type:** Data source.

### Cluster G — **Schema legibility (§5)**

- **Affected questions:** zero unlocked directly; ~all questions benefit from cleaner LLM understanding.
- **Estimated effort:** S. One migration with ~30 `COMMENT ON COLUMN` lines.
- **Dependencies:** Verify `drug_catalogue` situation.
- **Fix type:** Schema legibility.

### Cluster H — **Refusal templates as guardrail (independent of data fixes)**

- **Affected questions:** 12 ⚠ items.
- **Estimated effort:** Small. Update system prompt with §7.3 templates.
- **Dependencies:** None.
- **Fix type:** Refusal template.

---

## 9. Prioritised remediation roadmap

Sequenced by `leverage × feasibility`. Coverage delta is in percentage-point of total 150 questions moved to GREEN. Effort: S < 2 days, M = 3–10 days, L > 10 days.

| # | Title | Effort | Coverage Δ | Dependencies | Notes |
|---|---|---|---|---|---|
| 1 | Ship the §5.4 `COMMENT ON COLUMN` migration | S | +0% direct, +indirect | None | Pre-req for clean tool-author + eval-judge experience |
| 2 | Build confidence helper v1 (rules-based) + retrofit existing 9 tools | S | +0%, +preconditions | None | Required before any new tool ships |
| 3 | Ship §7.3 refusal templates in system prompt | S | +0% but stops ~10 ⚠ hallucinations | None | **Highest-stakes guardrail** — do this first |
| 4 | Top 5 quick-win tools (§1.4) | S each (M as a batch) | +~13% (20 → GREEN) | Items 1, 2 | Includes sole-source, peer-burden, class-concentration, resolution-stats, predictive-signals wrap |
| 5 | Remaining 11 typed tools in §4 | M | +~12% (18 more → GREEN) | Item 4 | get_available_brands, get_recent_deregistrations, get_supplier_shortage_record, get_facility_distress_signals, get_price_around_shortage, etc. |
| 6 | Eval harness over 150 questions, including gold-graded subset | M | +0% direct, +regression protection | Item 4 (so there are tools to test) | Land before any prompt refactor |
| 7 | Fix `drug_catalogue` missing-table situation | S | +0% but unblocks tooling | Item 1 | Verify against live DB |
| 8 | Unblock India CDSCO + Hong Kong + Singapore recalls + Germany recalls | M (broken-down per scraper) | +~3% (deepens 5–8 questions) | None | Each is independent |
| 9 | Hospital formulary upload (CSV) + portfolio-watch alert type | M | +~7% (10 → GREEN, mostly HCL-01/05/19/28, RET-29, HPR-30) | Item 4 | Auth-side feature; user-driven (no partnership needed) |
| 10 | First-reported-date schema addition + backfill where source supports | S–M | +~2% (GOV-07, HPR-02 unblock, GOV-08 deepens) | Item 1 | Data quality + question unlock |
| 11 | Forecast confidence v2 (statistical / ML) | L | +~7% (11 BLACK → GREEN) | Items 2, 6 | Quarterly project |
| 12 | Regulatory eligibility DB (Section 19A / SSP / 503B / Art 5(2)) — pilot for 4 countries | M | +~5% (8 ⚠ → GREEN) | Item 3 (refusal templates running) | High-stakes; do AU + UK + US + EU first |
| 13 | Demand-signal table + supplier-side anonymized counts | M | +~3% (5 → GREEN, mostly SUP-08/09/27/28) | Privacy review | k-anonymity ≥ 5 mandatory |
| 14 | Hospital network entity model + sister-hospital stock pilot | L | +~5% (8 → GREEN, HCL-25/26, HPR-20/24/25/26) | Item 9, partnership | Could be skipped if Mederti's wedge is supplier-side |
| 15 | Wholesaler / GPO partnership for real-time stock | L | +~3% | Commercial | Strategic, not technical |

**Coverage trajectory** if items 1–10 ship in the next 8 weeks:
- Today: 16/150 GREEN (10.7%)
- Post-item-3 (templates + confidence): still 16 GREEN but 10 ⚠ questions become safe to attempt
- Post-item-4 (quick wins): ~36/150 (24%)
- Post-item-5: ~54/150 (36%)
- Post-item-9: ~64/150 (43%)
- Post-item-12: ~72/150 (48%)
- Post-item-11: ~83/150 (55%) — first time we cross the half-way mark of strict-standard GREEN

The remaining ~67 are dominated by hospital-network / partnership-dependent / pure-forecast questions. Reaching beyond 55% requires either:
- (a) commercial partnerships (wholesaler stock, GPO data, tender feeds), or
- (b) a clear product decision to declare those questions out of scope and offer pure-search / canonical-link refusals.

---

## 10. External data dependencies

Capabilities that require commercial partnerships or new data sources Mederti doesn't currently own:

| Dependency | Source candidates | Unlocks | Type |
|---|---|---|---|
| **Wholesaler real-time stock** | Sigma Healthcare (AU), Symbion (AU), Alliance Healthcare (UK), McKesson, AmerisourceBergen, Cardinal Health | HCL-10, RET-02, HPR-09/11 | Commercial |
| **Tender / procurement pricing detail** | NHS BSA tender DB, Pharmac NZ tenders, state tenders (US 340B, AU PBS), Wellcome MMV | SUP-07 deepens, HPR-13/16, GOV-10/12 | Mix of public + commercial |
| **Hospital formulary aggregator** | Wolters Kluwer Lexicomp, First Databank, regional GPO consortia, single-hospital direct upload | HCL-01/05/19/21/24/28, RET-29, HPR-30 | Commercial or user-driven |
| **GPO membership + group-purchasing** | Vizient, Premier, HealthTrust, AUS LHN networks | HCL-26/27, HPR-20/24/25/26 | Commercial |
| **API manufacturer site signals (India / China)** | India CDSCO PDFs (fixable), Chinese provincial GMP databases, Pharmacompass (already partial), LinkedIn signal, satellite imagery | SUP-23, GOV-26, GOV-24 | Mix of scraping + commercial |
| **Patient impact / epidemiology** | WHO Global Health Observatory, IHME GBD, national disease registries | SUP-06, HCL-04, HPR-23 | Public but heavy curation |
| **Compounder registry** | FDA 503B outsourcing facilities DB (US, public), Australian compounding pharmacy list, EU per-country | HPR-19 | Public — straightforward ingest |
| **Buyer-side demand telemetry** | First-party — Mederti search / view / enquiry logs aggregated with k-anonymity ≥ 5 | SUP-08/09/27/28 | Internal data, needs new table |
| **Country-specific regulatory eligibility rules** | TGA Section 19A page (scrapable), MHRA SSP list (scrapable), FDA shortage list (scrapable), EU Article 5(2) lists per country | SUP-15/16/17/18, RET-08/27, HPR-18 | Curation effort |

The biggest commercial unlock is wholesaler stock — it would shift Mederti from "regulator-reported shortages" to "live supply state", which is the actual question retail and hospital pharmacists are trying to answer. The biggest "free" unlock is the regulatory eligibility curation effort.

---

## 11. Hallucination risk register

12 questions are flagged ⚠. Per question: what the model might confabulate, why it's risky, and the refusal template to ship as a guardrail immediately.

### SUP-15 ⚠ — "Fastest legal import pathway"
- **Confabulation risk:** plausible-sounding pathway names ("emergency parallel import permit", "compassionate use authorization") that conflate jurisdictions or don't exist for the named drug.
- **Persona impact:** SUP — wrong pathway claim could lead to a real-world import attempt with regulatory consequences.
- **Template:** "Import pathway varies by drug, country, and shortage declaration status. Mederti doesn't yet index the live eligibility list for [country]. Canonical lookup: [regulator URL]. I can tell you whether the drug is currently in a declared shortage in [country] — that gates eligibility for most pathways."

### SUP-16, RET-08, RET-27, HPR-18 ⚠ — "Section 19A / SSP / 503B / Article 5(2) active for this drug?"
- **Confabulation risk:** the model knows the *scheme* (system prompt mentions it) but not the *current* listing; risk of stating "yes, eligible" when no formal listing exists.
- **Persona impact:** retail pharmacist may dispense; procurement may order — both rely on the eligibility claim.
- **Template:** "[Scheme name] eligibility is determined per-application by [regulator]. Mederti doesn't currently index the live list. Canonical source for the live list: [URL]. For [country], the published lists I've seen historically include [comment]; check the current entry before relying on it."

### SUP-19, RET-22, HPR-27, HCL-17 ⚠ — "Forecast end + confidence"
- **Confabulation risk:** restating regulator's `estimated_resolution_date` as if it were a Mederti forecast; presenting a single date with no confidence interval.
- **Persona impact:** procurement decisions (stock-up, alt-source) and patient counselling both miscalibrated.
- **Template:** "Mederti doesn't ship a structured resolution forecast yet. The regulator's own estimate is [date]. That estimate is a typed-in field, not a confidence-calibrated forecast — treat it as a directional hint, not a planning anchor. Historical resolution time for this class / drug is [from new stats tool if available]."

### SUP-23 ⚠ — "Indian / Chinese API site distress signals"
- **Confabulation risk:** the India CDSCO scraper is broken; the model may fall through to web_search and surface dated or unverified reports as "current".
- **Persona impact:** importer / regulator may act on stale or wrong signals.
- **Template:** "Mederti's India CDSCO scraper is currently held (selector reengineering pending) and our China NMPA feed publishes only rare API-suspension notices. For live distress signal: I can show concentration-risk and recent FDA inspection classifications for sites supplying [drug] (US/EU coverage), and I can web-search for current reporting — but I can't confirm a live "distress signal" without the upstream feeds."

### HCL-04 ⚠ — "Patients at risk if [drug] stays short past 30 days"
- **Confabulation risk:** the model might generate an indication-prevalence × population estimate from priors.
- **Persona impact:** clinical risk decisions; patient counts driving D&T Committee escalations.
- **Template:** "Mederti doesn't index patient-impact data. [Drug] is indicated for [from drug_approvals.indication, if present]; epidemiological prevalence in [country] is a question for [WHO GHO / national disease registry]. I can give you the shortage severity, duration, and substitute availability, which is what most D&T Committees use to triage."

### HCL-13, HCL-15 ⚠ — "Clinically equivalent substitutes / dose conversions"
- **Confabulation risk:** `drug_alternatives.dose_conversion_notes` covers ~100 drugs; when missing, the model may fall back to general clinical knowledge for dose conversion. Highest-stakes question on the list.
- **Persona impact:** prescribing-style answer; patient safety direct.
- **Template:** "Mederti doesn't have a verified dose-conversion entry for [from drug] → [to drug] in our database. Dose conversion is a clinical decision that depends on patient factors I can't see. Canonical references: [Australian Medicines Handbook / BNF / Micromedex / your hospital's guideline]. I'm not going to estimate a conversion ratio from general knowledge."

### HPR-13, HPR-16 ⚠ — "Cost premium / price elevation vs baseline"
- **Confabulation risk:** sparse pricing data may tempt the model to assert "elevated" without supporting comparison.
- **Persona impact:** budget-impact reporting, contract negotiation.
- **Template:** "I have [N] price data points for [drug] in [country] over [period]; the median is [X]. I don't have your contract baseline rate. To assess elevation, I'd need either your contract rate (you can paste it in) or a benchmark series — neither is in the platform today."

### HPR-23 ⚠ — "Cost differential of switch across patient volume"
- **Confabulation risk:** combining sparse pricing with a guessed patient volume.
- **Persona impact:** procurement budget decisions.
- **Template:** "I can show you the unit-price differential between [from] and [to] from the pricing data on file ([N] points). I don't have your patient volume — you'll need to provide that, or upload a procurement extract."

### RET-25 ⚠ — "Legal substitutions without prescriber contact"
- **Confabulation risk:** country-specific substitution law conflated across jurisdictions; e.g. quoting AU's PBS bioequivalence rules in a UK context.
- **Persona impact:** legal/professional risk for the pharmacist.
- **Template:** "Generic-substitution rules are jurisdiction-specific. Mederti doesn't index per-country substitution law as structured data. For [country], the canonical reference is [Pharmaceutical Society / regulator URL]. I can tell you whether a substitute is therapeutically equivalent on FDA / WHO criteria, but the substitution-without-prescriber-contact rule is yours to apply."

---

## 12. Open questions / decisions

Items where Rob's direction is needed before remediation can be planned:

1. **Hospital substrate: build or partner?** Cluster B (HPR + half of HCL) needs either a user-driven formulary upload + multi-tenant network model, or a commercial GPO/wholesaler partnership. They are very different bets. If the answer is "supplier-side is the wedge, hospital-side comes later", we should set explicit expectations in the marketing and refuse the hospital-specific questions cleanly rather than half-answer them.
2. **Forecast model: own or buy?** A statistical resolution-time model is a quarter-long project. There are off-the-shelf options (vendor APIs, partnerships with academic groups). Worth a discrete decision before sinking eng time.
3. **Regulatory-eligibility database: how much manual curation are we willing to fund?** A reasonable v1 covering AU/UK/US/EU Section-19A-and-equivalent listings is one curator-week per country. Whether to staff this matters because it directly de-risks ~8 ⚠ questions.
4. **Demand telemetry: privacy model.** A buyer-search demand signal is a strong supplier-side product. Aggregated with k-anonymity ≥ 5 it's defensible. Below that it leaks. We need a written privacy policy before instrumentation lands.
5. **Public methodology page + freshness dashboard.** Surfacing `data_sources.last_scraped_at` publicly (already correctly maintained in code, despite CLAUDE.md's outdated comment) is a credibility lever for "world's leading source" positioning. Schedule decision: now, with v1 tool surface, or later?
6. **Public API tier + eval badge.** If we publish the 150-question eval pass-rate on `/about`, it becomes a credibility moat — but also a target. Worth discussing the trade-off before turning it on.
7. ~~**`drug_catalogue` table situation.**~~ **Resolved (Sprint 1 Step 2, 2026-05-27).** Verified against live Supabase: table exists, 160k+ rows, heavily used. The audit's "missing table" finding was wrong. Migration `036_schema_legibility.sql` retroactively documents the schema via `CREATE TABLE IF NOT EXISTS` for fresh-clone reproducibility. See §5.1 issue #1 for the corrected note.
8. **Persona signal in `/chat`.** The system prompt detects persona from message signals and `user_profiles.role`. For first-time users (no auth), persona defaults to pharmacist. The roadmap's "chat-first surface" implies the persona signal should be more explicit — possibly a "I am a..." chip selector on first turn. Worth a UX decision.

---

## Appendix A — Source material verified against this report

- All 35 Supabase migrations (`supabase/migrations/001` → `035`) read directly
- [frontend/app/api/chat/route.ts](frontend/app/api/chat/route.ts) — model + tool dispatch + fallback path
- [frontend/lib/chat/system-prompt.ts](frontend/lib/chat/system-prompt.ts) — JTBD routing, output shape, refusal rules
- [frontend/lib/chat/tools.ts](frontend/lib/chat/tools.ts) — 9 tool implementations + provenance helper
- [frontend/lib/chat/coverage.ts](frontend/lib/chat/coverage.ts) — live/stale/not_indexed country sets
- [cron/crontab_fixed.txt](cron/crontab_fixed.txt) — 52 active scheduled jobs
- [backend/scrapers/base_scraper.py](backend/scrapers/base_scraper.py) — including the `_refresh_verified_at` fix verified
- [CLAUDE.md](CLAUDE.md) — cross-referenced and noted one stale claim (`data_sources.last_scraped_at` IS updated by base_scraper.py)
- Six secondary LLM endpoints (`/api/intelligence/briefing`, `/api/supplier/briefing`, `/api/drugs/[id]/so-what`, `/api/daily-question`, `/api/chip-answer`, `/api/detect-columns`) — surface only; not modified in this audit

Read-only verification only. No schema, code, or production data was changed.
