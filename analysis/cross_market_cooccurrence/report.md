# Cross-Market Shortage Co-occurrence — v1 (measured base rates)
_Analysis date: 2026-06-03. Source: `shortage_events` (onset = `start_date`). Analysis only — no forward predictions are published here._
**What this is:** an empirical measurement of how the *same INN* enters shortage across Mederti's 22 national markets, and the historical base rate that one market's shortage precedes another's. **What this is not:** a causal model or a forecast. Every relationship reports its sample size `n`; treat low-n pairs with caution.
## Coverage
- Events analysed: **37,062** (onset-dated)
- Distinct INNs ever in shortage: **10,020** (national markets only; EU bloc excluded from counts)
- Markets: **22** national codes + 1 EU bloc (EMA), excluded from pairwise analysis
- Onset date span: **2003-01-01 → 2027-06-30**

> ⚠️ **Headline caveat — coverage, not history.** Although onset dates span 2003→2028, each market's *observed* onset window is set by when its scraper began capturing shortages, and these differ by **years** (see table). Switzerland's onsets only start 2026-02; the Netherlands' 2024-07; the US reaches back to 2006. A naive lead-lag would therefore just measure which country has older records. **All directional results below are coverage-controlled** (both onsets required inside the pair's overlapping observation window); the uncontrolled version is shown only to demonstrate the artifact.

### Per-market observation windows

| market | events | first onset | last onset | window (days) |
|---|---|---|---|---|
| AU Australia | 1704 | 2003-01-01 | 2027-06-30 | 8,946 |
| US United States | 4469 | 2006-02-24 | 2026-06-01 | 7,402 |
| CA Canada | 3233 | 2008-03-19 | 2027-03-12 | 6,932 |
| IT Italy | 4422 | 2010-09-16 | 2028-04-28 | 6,434 |
| EU European Union | 101 | 2013-04-11 | 2026-12-02 | 4,983 |
| NZ New Zealand | 290 | 2014-07-17 | 2026-05-29 | 4,334 |
| ES Spain | 3172 | 2016-05-05 | 2026-06-01 | 3,679 |
| DE Germany | 740 | 2018-07-01 | 2026-09-01 | 2,984 |
| MY Malaysia | 226 | 2019-01-01 | 2026-01-01 | 2,557 |
| BE Belgium | 1014 | 2019-04-11 | 2026-06-16 | 2,623 |
| GB United Kingdom | 80 | 2019-10-03 | 2026-05-30 | 2,431 |
| NO Norway | 973 | 2020-07-10 | 2026-10-01 | 2,274 |
| FR France | 575 | 2021-05-19 | 2026-06-01 | 1,839 |
| FI Finland | 1815 | 2022-01-07 | 2026-06-15 | 1,620 |
| IE Ireland | 778 | 2022-04-15 | 2026-06-15 | 1,522 |
| GR Greece | 440 | 2022-11-10 | 2026-10-01 | 1,421 |
| NL Netherlands | 1010 | 2024-07-01 | 2026-06-02 | 701 |
| SG Singapore | 321 | 2025-01-02 | 2026-12-03 | 700 |
| JP Japan | 5672 | 2025-05-22 | 2026-06-02 | 376 |
| SK Slovakia | 13 | 2025-11-30 | 2026-06-05 | 187 |
| AE United Arab Emirates | 20 | 2026-02-08 | 2026-06-01 | 113 |
| CH Switzerland | 5930 | 2026-02-24 | 2026-06-02 | 98 |
| PT Portugal | 64 | 2026-03-22 | 2026-05-27 | 66 |

## 1. How widely does a single INN's shortage spread?
- INNs shorted in **≥2 countries**: **1,309** of 10,020 (13%)

| # countries | # INNs |
|---|---|
| 13 | 1 |
| 11 | 4 |
| 10 | 12 |
| 9 | 13 |
| 8 | 36 |
| 7 | 40 |
| 6 | 69 |
| 5 | 88 |
| 4 | 126 |
| 3 | 236 |
| 2 | 684 |
| 1 | 8711 |

**Most cross-market INNs (top 25 by country count):**

| INN | #countries | first market | first onset | last onset | spread span (days) |
|---|---|---|---|---|---|
| Atorvastatin | 13 | IT | 2013-07-19 | 2026-03-16 | 4,623 |
| Clopidogrel-Besilate | 11 | CA | 2018-09-17 | 2026-03-09 | 2,730 |
| Levetiracetam | 11 | IT | 2014-03-21 | 2026-04-22 | 4,415 |
| Olanzapine-Pamoate-Monohydrate | 11 | CA | 2020-01-08 | 2026-04-01 | 2,275 |
| Propofol | 11 | US | 2014-10-06 | 2026-05-01 | 4,225 |
| Budesonide | 10 | IT | 2017-11-01 | 2026-06-02 | 3,135 |
| Cinacalcet-Hydrochloride | 10 | IT | 2020-10-13 | 2026-02-24 | 1,960 |
| Fluconazole | 10 | MY | 2024-01-01 | 2026-04-21 | 841 |
| Insulin glargine | 10 | MY | 2020-01-01 | 2026-04-02 | 2,283 |
| Latanoprost | 10 | IT | 2022-01-22 | 2026-03-22 | 1,520 |
| Montelukast-Sodium | 10 | IT | 2018-05-07 | 2026-05-01 | 2,916 |
| Olanzapine(10 Mg) | 10 | CA | 2020-01-08 | 2026-04-30 | 2,304 |
| Paracetamol | 10 | US | 2021-03-02 | 2026-03-09 | 1,833 |
| Quetiapine-Fumarate | 10 | CA | 2017-04-01 | 2026-03-22 | 3,277 |
| Sertraline-Hydrochloride | 10 | CA | 2017-03-17 | 2026-01-15 | 3,226 |
| Sodium-Pertechnetate(99Mtc) | 10 | US | 2013-05-29 | 2025-12-23 | 4,591 |
| Sumatriptan-Succinate | 10 | ES | 2023-09-05 | 2026-02-19 | 898 |
| Adalimumab | 9 | IT | 2018-12-31 | 2026-03-30 | 2,646 |
| Amoxicillin | 9 | CA | 2022-07-12 | 2026-05-20 | 1,408 |
| Ciprofloxacin | 9 | CA | 2017-03-10 | 2026-03-11 | 3,288 |
| Entecavir | 9 | IT | 2020-09-01 | 2026-04-01 | 2,038 |
| Estradiol | 9 | US | 2013-05-29 | 2026-06-02 | 4,752 |
| Ibuprofen | 9 | CA | 2021-05-12 | 2026-04-30 | 1,814 |
| Linezolid | 9 | IT | 2013-10-28 | 2026-03-11 | 4,517 |
| Metronidazole | 9 | US | 2022-01-13 | 2026-02-26 | 1,505 |

## 2. Lead-lag base rates — does country A's shortage precede country B's?
**Coverage-controlled.** Among INNs shorted in **both** A and B *whose onsets in each fall inside the pair's overlapping observation window*, the share where A's onset is strictly earlier than B's. Ranked by the Wilson 95% lower bound of that hit rate (penalises small samples). Ordered pairs with **n ≥ 15** and hit-rate ≥ 50%. `n` is the count of co-shorted INNs inside the window — read every row against it.

| lead → lag | n (both, in-window) | A-first | hit rate | Wilson LB | median lead (days) |
|---|---|---|---|---|---|
| IT → NL | 28 | 28 | 100% | 88% | 377.5 |
| US → NL | 37 | 36 | 97% | 86% | 303.5 |
| US → FR | 32 | 31 | 97% | 84% | 454 |
| US → GR | 62 | 57 | 92% | 82% | 426 |
| IT → NZ | 27 | 26 | 96% | 82% | 1428.0 |
| ES → NL | 50 | 46 | 92% | 81% | 246.5 |
| AU → NL | 88 | 78 | 89% | 80% | 186.5 |
| US → NZ | 46 | 42 | 91% | 80% | 901.5 |
| SG → NL | 31 | 29 | 94% | 79% | 256 |
| IE → NL | 36 | 33 | 92% | 78% | 135 |
| FR → NL | 34 | 31 | 91% | 77% | 169 |
| US → NO | 46 | 41 | 89% | 77% | 553 |
| IT → AU | 124 | 103 | 83% | 75% | 1401 |
| MY → AU | 37 | 33 | 89% | 75% | 1470 |
| NO → NL | 37 | 33 | 89% | 75% | 134 |
| US → AU | 214 | 173 | 81% | 75% | 976 |
| CA → NL | 46 | 40 | 87% | 74% | 164.5 |
| MY → ES | 18 | 17 | 94% | 74% | 1005 |
| IT → ES | 173 | 138 | 80% | 73% | 1105.0 |
| GR → NL | 61 | 51 | 84% | 72% | 106 |
| IT → GR | 32 | 28 | 88% | 72% | 361.5 |
| US → DE | 55 | 46 | 84% | 72% | 623.0 |
| CA → GR | 80 | 65 | 81% | 71% | 257 |
| US → BE | 132 | 104 | 79% | 71% | 735.0 |
| CA → NZ | 69 | 56 | 81% | 70% | 2369.0 |
| IT → BE | 91 | 71 | 78% | 68% | 652 |
| US → IE | 59 | 47 | 80% | 68% | 392 |
| SG → BE | 31 | 26 | 84% | 67% | 263.0 |
| AU → NZ | 59 | 46 | 78% | 66% | 283.0 |
| CA → ES | 103 | 77 | 75% | 66% | 1430 |
| CA → AU | 264 | 187 | 71% | 65% | 1531 |
| AU → GR | 93 | 69 | 74% | 64% | 146 |
| IT → IE | 28 | 23 | 82% | 64% | 666 |
| IT → FR | 16 | 14 | 88% | 64% | 445.0 |
| BE → NL | 88 | 65 | 74% | 64% | 103 |
| IT → DE | 51 | 39 | 76% | 63% | 905 |
| DE → NL | 34 | 27 | 79% | 63% | 206 |
| ES → NZ | 19 | 16 | 84% | 62% | 217.5 |
| US → ES | 90 | 65 | 72% | 62% | 768 |
| IT → NO | 48 | 36 | 75% | 61% | 662.0 |

**How to read this — the direction still partly tracks coverage maturity.** Notice every high-ranked *lead* market (US, IT, ES, CA, AU) is a long-history, high-volume scraper, and every *lag* market (NL, GR, NZ, NO, FR) onboarded recently — and median 'leads' for the old-history pairs remain implausibly large (e.g. IT→AU 1,401d, CA→AU 1,531d, US→AU 976d). That is residual confounding the window control cannot fully remove: within the overlap, a newly-onboarded market's onsets still cluster near the present. The pairs whose median lead is short and plausible (≈100–260d: BE→NL 103d, GR→NL 106d, NO→NL 134d, IE→NL 135d, AU→NL 186d) are the least artifactual — but all share NL as the lag, so they mostly reflect NL's mid-2024 onboarding. **v1 conclusion: these base rates are real measurements but are NOT yet decision-grade as predictors.** They become trustworthy only once per-market coverage windows converge (another year of overlapping data) or onset is anchored to true regulator-notification dates rather than scrape-capture. Use Section 3 (point-in-time, coverage-robust) for any actual watch-listing today.

<details><summary>Uncontrolled version (coverage-confounded — DO NOT cite)</summary>

Same calculation without the window control. The huge median 'leads' (often 800–1,500 days) are the artifact: markets with older records trivially 'precede' recently-scraped ones. Shown only to motivate the control above.

| lead → lag | n (both) | hit rate | Wilson LB | median lead (days) |
|---|---|---|---|---|
| US → NL | 105 | 99% | 95% | 877.5 |
| IT → NL | 90 | 97% | 91% | 1292 |
| US → FR | 50 | 98% | 90% | 856 |
| CA → NL | 139 | 94% | 89% | 1509 |
| US → GR | 99 | 95% | 89% | 754.5 |
| MY → NL | 28 | 100% | 88% | 1554.5 |
| MY → GR | 26 | 100% | 87% | 1276.0 |
| IT → GR | 70 | 94% | 86% | 1534.5 |
| ES → NL | 58 | 93% | 84% | 261.5 |
| US → NZ | 55 | 93% | 83% | 1103 |
| CA → GR | 137 | 89% | 83% | 813.0 |
| AU → NL | 100 | 89% | 81% | 209 |
| IE → NL | 42 | 93% | 81% | 209 |
| MY → BE | 40 | 92% | 80% | 1464 |
| US → NO | 54 | 91% | 80% | 742 |

</details>

**Lead-lag specifically INTO the AU / US anchor markets** (which foreign market most often shorts *before* AU or US, n≥20):

_→ Australia (AU)_

| lead → lag | n (both) | A-first | hit rate | Wilson LB | median lead (days) |
|---|---|---|---|---|---|
| IT → AU | 124 | 103 | 83% | 75% | 1401 |
| MY → AU | 37 | 33 | 89% | 75% | 1470 |
| US → AU | 214 | 173 | 81% | 75% | 976 |
| CA → AU | 264 | 187 | 71% | 65% | 1531 |
| SG → AU | 39 | 22 | 56% | 41% | 184.5 |
| DE → AU | 75 | 39 | 52% | 41% | 173 |
| ES → AU | 71 | 35 | 49% | 38% | 217 |
| FR → AU | 43 | 21 | 49% | 35% | 164 |
| BE → AU | 142 | 54 | 38% | 30% | 261.0 |
| NO → AU | 51 | 21 | 41% | 29% | 127 |
| IE → AU | 59 | 17 | 29% | 19% | 277 |
| GR → AU | 93 | 22 | 24% | 16% | 112.5 |

_→ United States (US)_

| lead → lag | n (both) | A-first | hit rate | Wilson LB | median lead (days) |
|---|---|---|---|---|---|
| IT → US | 163 | 99 | 61% | 53% | 1108 |
| MY → US | 38 | 23 | 61% | 45% | 1278 |
| CA → US | 408 | 199 | 49% | 44% | 1622 |
| SG → US | 20 | 11 | 55% | 34% | 221 |
| ES → US | 90 | 25 | 28% | 20% | 233 |
| BE → US | 132 | 28 | 21% | 15% | 157.0 |
| AU → US | 214 | 41 | 19% | 14% | 261 |
| IE → US | 59 | 12 | 20% | 12% | 239.5 |
| DE → US | 55 | 9 | 16% | 9% | 334 |
| NO → US | 46 | 5 | 11% | 5% | 53 |
| GR → US | 62 | 5 | 8% | 3% | 131 |
| NZ → US | 46 | 4 | 9% | 3% | 253.0 |

## 3. Current candidate leading indicators
INNs **currently** in shortage (status active, or anticipated with onset ≤ 2026-06-03) in **≥2 national markets** but **not yet in AU or US**. These are watch-list candidates — a measured signal, not a prediction.

**426 INNs** match. Top 30 by breadth:

| INN | #active countries | markets |
|---|---|---|
| Donepezilo Normon | 7 | BE|CA|ES|GR|IE|IT|MY |
| Valaciclovir | 7 | BE|GR|IE|IT|MY|NL|NZ |
| Alfacalcidol | 6 | BE|CA|FR|IT|NL|NZ |
| Diazepam | 6 | BE|CA|GR|IT|NL|NO |
| Diazepam Tablets 2 Mg | 6 | BE|CA|CH|IT|NL|NO |
| Etoricoxib | 6 | BE|DE|ES|IE|IT|NL |
| Letrozole | 6 | BE|CA|ES|GR|IE|NL |
| Mometasone Furoate | 6 | CA|IE|IT|NL|NZ|SG |
| Quetiapine | 6 | BE|CA|GR|IT|NL|PT |
| Sitagliptin | 6 | BE|CA|GR|IE|IT|SG |
| Candesartancilexetil | 5 | CA|DE|ES|IT|NZ |
| Citalopram | 5 | BE|CA|ES|GR|IT |
| Dutasteride | 5 | CA|DE|IE|IT|NO |
| Efavirenz/Emtricitabina/Tenofovir Disoproxilo Glenmark | 5 | DE|ES|IT|NL|NZ |
| Ipratropiumbromid (Ph.Eur.) | 5 | CA|DE|IE|NL|NZ |
| Lenalidomide | 5 | BE|CA|GR|IE|IT |
| Levosimendan | 5 | BE|ES|GR|IT|NL |
| Montelukast | 5 | BE|CA|IT|NL|NZ |
| Olmesartan Medoxomil | 5 | BE|CA|ES|GR|IT |
| Olmesartan/Amlodipino/Hidroclorotiazida Cinfa | 5 | BE|ES|IE|MY|NL |
| Ropinirole-Hydrochloride | 5 | BE|CA|ES|FR|NL |
| Sugammadex Sodique | 5 | BE|ES|GR|IT|NL |
| Tenofovir Disoproxil Fumarate | 5 | CA|ES|IE|IT|MY |
| Aflibercept | 4 | BE|CA|DE|PT |
| Citalopram-Hydrobromide | 4 | BE|CA|GR|IT |
| Desloratadina | 4 | ES|IE|IT|NO |
| Desogestrel; Ethinylestradiol | 4 | BE|CA|DE|IE |
| Donepezil | 4 | BE|CA|GR|MY |
| Etanercept | 4 | CA|DE|GR|IT |
| Ezetimibe(10Mg),Simvastatin(10 Mg) | 4 | BE|IE|IT|NZ |

## Caveats
- **INN fragmentation (counts are a LOWER BOUND):** grouping is by `drugs.generic_name`, which for many rows is still an unresolved product/salt/brand string (e.g. `Donepezilo Normon`, `Diazepam Tablets 2 Mg`, `Olanzapine(10 Mg)` vs `Olanzapine-Pamoate-Monohydrate`). The same molecule is split across several keys, so true cross-market co-occurrence is *higher* than reported here. A canonical-INN normalisation pass would strengthen every number.
- **Onset = regulator publish date**, not true clinical onset; reporting cadence differs by regulator and biases lead-lag toward faster-reporting agencies (e.g. CH, JP, US have the most records).
- **First-episode collapse:** repeated shortages of the same INN in the same country are reduced to their first onset. Episodic co-movement is out of scope for v1.
- **Detection ≠ event:** a market with denser scraping coverage will appear to 'lead' simply because it captures onsets earlier. The hit rates below are confounded by coverage and cannot be read as supply-chain causation.
- **EU bloc excluded** from pairwise and current-indicator counts (overlaps member states).
- Sample-size floor for the ranked table is n≥15; full pairs (incl. low-n) are in `country_pairs.csv`.
