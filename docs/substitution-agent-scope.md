# Substitution Agent — scope

*2 Nov 2026. All counts are live prod reads from 2 Nov 2026, not estimates.*

## The job

> **Pharmacist, patient at the counter:** "X is out. What can I dispense instead, today, legally — and at what dose?"

The answer leads with **one** recommendation, its legal basis and the dose *as the source states it*, or a clean refusal that names the gap and the reference to use instead. Data comes second. (Doctors get the same engine with a prescribing skin later; not v1.)

## Reality check vs the Sep memo

The Ryan memo said "every tool is built, ships in weeks." That holds for the tools. It doesn't hold for the data behind them:

| Leg | Memo said | Prod today |
|---|---|---|
| Regulator-authorised swaps | Built | Built, but **TGA SSSI: 19 of 101 imported statements still current. UK SSP: 8.** The SSSI / SSP / BfArM / Orange Book importers were run once (17 Oct) and are **not in cron**. Instruments expire and new ones never get picked up. Only `tfda_alternatives` is scheduled. |
| Dose conversion | Built | `get_dose_conversion` is deliberately hard-wired to "unanswerable" (PR #183). The only sourced doses are the verbatim `dose_statement` on those 27 SSSI/SSP rows. |
| Legal basis | Built | TGA s19A: 105 active approvals (62 resolved to a drug). FDA shortage list: 58 active. MHRA SSP: 8 active. EU Art 5(2): scaffold, 0 rows. |
| Therapeutic (different-drug) alternatives | Built | WHO eEML only: 228 statements, all single-source. |

**In-jurisdiction coverage of drugs with an active shortage** (a cited alternative that is valid *in that country*):

| Market | Active-shortage drugs | With in-market cited alternative |
|---|---|---|
| US | 2,084 | 283 (Orange Book AB, same molecule) |
| TW | 203 | 81 |
| DE | 475 | 33 |
| AU | 391 | **2** |
| GB | 6 | 0 (the GB shortage feed itself looks thin; investigate separately) |
| everywhere else | — | 0 (WHO single-source only) |

So in v1 the agent will mostly refuse or hand off to the prescriber. That's correct behaviour, but it isn't the product the memo promised. The work below fixes the AU number first, since AU is where the pharmacist feedback came from.

## What the agent returns: four tiers, ranked in code

Ranking is **deterministic server code**, not model judgement. The model phrases the answer; it never chooses or invents the tier.

| Tier | What it is | Source | Shown as |
|---|---|---|---|
| **1. Authorised swap** | A current legal instrument permits this exact swap in the user's country | `alternative_evidence` with `authority_type='regulator_legal'`, `country_code` = user market, valid today | "Authorised by TGA under SSSI 2026-xx until DD/MM", with the verbatim dose statement |
| **2. Same medicine, other presentation** | Same molecule, different strength/form/brand, on the market's register, **no shortage notice on file** | `drug_products` (AU 31k, CA 58k, US 111k, GB 14k) × `shortage_events`. Reuses the PR #198 "Supply in market" exact-match logic | "Registered in AU, no shortage notice on file as of DD/MM". **Never "available".** Prescriber approval needed unless a tier-1 instrument covers it. |
| **3. Import pathway** | An approved overseas product brought in under a shortage scheme | `regulatory_eligibility` active rows (TGA s19A, FDA shortage import) | "s19A approval [ref], sponsor X, until DD/MM" |
| **4. Different medicine** | A therapeutic alternative | `verified_alternatives` with `kind='therapeutic'` | Prescriber decision. Label "single source (WHO)" unless 2+ publishers. No dose, ever. |
| **Refuse** | None of the above | — | Names the gap, then the reference: AMH / BNF / Micromedex / local guideline + the regulator URL |

**Output contract** (one `substitution_card` block, operational-first):

1. **Headline:** the top-tier recommendation in one line, or "No authorised substitute on file for AU."
2. **Legal basis:** instrument / scheme + reference + expiry, jurisdiction-scoped.
3. **Dose:** the verbatim source `dose_statement`, or "No sourced dose conversion — check AMH/BNF." Never computed, never estimated.
4. **Recall check:** is the recommended product under an active recall (`search_recalls`).
5. **Alternates:** the next 2–3 options, with their tiers.
6. **Sources + freshness:** source, retrieved date and expiry on every line.

**Hard rules** (enforced in the tool layer *and* the prompt):
- No dose unless a source row states it.
- No legal claim outside the instrument's jurisdiction and validity dates.
- No ATC-class pairings (`drug_alternatives`) shown as substitutes.
- Unresolved / ambiguous drug name → ask, don't guess. Strict `DrugResolver`, never canonical heads.
- "Registered + no notice" ≠ "in stock". Say which one we know.

## Build plan

### Phase A — data prerequisites (do first; the agent is hollow without them)

| # | Item | Size | Why |
|---|---|---|---|
| A1 | Put the `tga_sssi`, `uk_ssp`, `bfarm`, `fda_orange_book` alternatives importers in cron (SSSI/SSP daily, BfArM weekly, Orange Book monthly), with lapse handling like `tfda_alternatives` | S | 82 of 101 SSSI statements have expired since the one-off run. This is the AU number. |
| A2 | Check that SSSI expiry parsing is correct (is 19/101 real, or a date bug?) | S | Data accuracy rule |
| A3 | Resolve the 43 unresolved active s19A rows to drug_ids via `drug_synonyms` (no fuzzy matching) | S | Tier 3 coverage |
| A4 | Product-level matching: a shortage notice often names one strength/form. Tier 2 needs presentation-level notice matching. Depends on migration 068 (brand/sponsor), which is **not in prod** | M | Without it, tier 2 hides valid other strengths or shows short ones |
| A5 | Fix name resolution for the 69 INN/USAN misses (beclometasone, chlortalidone…) | S | Coverage |

#### Phase A status (2 Nov 2026)

| # | Result |
|---|---|
| A1 | **Done.** BfArM, SSSI and SSP run daily; Orange Book runs weekly (Wed). Installed in the live crontab. BfArM now expires rows whose notification left the CSV (7 were still counting; 9 new ones picked up; DE in-market coverage 33 → 39). Orange Book and TFDA already did this; SSSI and SSP carry their own end dates. |
| A2 | **Not a bug.** 19 current SSSI statements is the real number: TGA lists only 3 SSSIs in force (diltiazem, dapsone, estradiol), and our derived validity matches TGA's current/lapsed listing for all 26 instruments. **The AU tier-1 gap is the regulator, not our pipeline.** So AU coverage depends on tiers 2 and 3. |
| A3 | **Blocked, two separate problems.** (1) Since ~28 Oct, tga.gov.au serves an Akamai bot-check page instead of the s19A register. The scraper parsed that as 0 rows and logged a clean run. It now fails loudly. Data is frozen at its 27 Oct state. We won't try to get past the bot check: we need a sanctioned feed from TGA, or the user exports it by hand. (2) The 43 unresolved approvals are a drug-identity problem, not a parser one. There's no clean `drugs` row for indapamide, lomustine, clomifene, fludarabine etc., only fragments like "Indapamide-Hemihydrate". Fix that in the entity layer, not with fuzzy matching. Also fixed: titles prefixed "(Approval lapsed …)" or "Approval commences …" were stored as active. The 3 affected prod rows are corrected. The two fusidate approvals (commencing 1 Dec) will need flipping to active by hand if the scraper is still blocked then. |
| A4 | Not started. Waits on migration 068 in prod. |
| A5 | Not started. Same drug-identity work as A3(2). |

### Phase B — engine (≈1 week)

- `frontend/lib/substitution/resolve.ts`: `resolveSubstitution(drugId, country, presentation?)` returns the tiered envelope above, with a `refusal` object when empty. Pure function over Supabase, unit-tested.
- New chat tool `get_substitution_answer`, which supersedes calling `get_sourced_alternatives` + `find_substitutes` + `get_eligibility_status` separately for this question shape. Update `system-prompt.ts` pharmacist JTBD to call it first.
- `substitution_card` render block in chat.

### Phase C — front doors (≈1 week)

- **/search row:** "What instead?" opens the card in the drawer (the existing "Can I substitute?" column becomes the entry point).
- **Drug page:** card at the top for pharmacists, above the supply section.
- **Chat:** auto-triggered on "X is out / what instead" intents.
- PostHog event `substitution_answer_shown {tier, country, refused}` behind the consent gate, so we can measure the refuse rate per market.

### Phase D — eval gate (blocks launch)

- Golden set of ~40 cases built from real current SSSI/SSP/s19A instruments, tier-2 register cases, and deliberate refusal traps ("dose to switch amoxicillin to cefalexin?", an expired SSSI, a cross-jurisdiction legal claim).
- **Ship gate:** 0 fabricated doses, 0 out-of-jurisdiction or expired legal claims, 100% of refusals name a reference. Add it to the nightly persona eval CI. That CI still needs the `ANTHROPIC_API_KEY` repo secret.

## Launch scope

- **v1 markets:** AU (after A1), US, DE, TW. These are the only markets where in-jurisdiction tiers exist. Other markets get tier 4 + refusal, and the copy says so plainly.
- **Not in v1:** dose calculation of any kind, stock levels, cross-border sourcing (that's the Sourcing Agent), the doctor skin, write actions (prescriber note drafting needs the draft-and-approve infrastructure).

## Open decisions for the CEO

1. **Tier 2 wording and legality.** In AU, a pharmacist can't swap strength/form without the prescriber unless an SSSI covers it. Show tier 2 as "ask the prescriber about…" or hide it outside tier-1 cover?
2. **Do we launch AU with ~19–30 authorised swaps?** Or hold until A1 has run for a few weeks and we can quote a coverage figure?
3. **Licensed sources.** ASHP (US) and SPS/MSN (UK) would multiply tier 1/4 coverage but need commercial licences. Worth pricing now?
