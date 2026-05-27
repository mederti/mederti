# Mederti — Architecture & Build Quality Audit (v1)

**Audit date:** 2026-05-27
**Auditor scope:** read-only inspection of Supabase schema (41 migrations), 67 scraper files, 49 Next.js Route Handlers, AI surface, frontend (139 `.tsx` files), security posture, performance, observability, SEO, code quality. Graded against the *"world's leading source of short-supply drug data"* product standard, with **data accuracy and recency** applied as the dominant axis.
**Output type:** roadmap-grade audit; no remediation in this pass.
**Companion:** [`persona-coverage-audit.md`](persona-coverage-audit.md) (what the platform can answer) — this report asks **how well the platform is built to answer it**.

> **Headline:** the engine room is in two very different shapes. The data/AI/ingestion spine is genuinely strong — confidence-calibrated tools, 41 migrations, 67 scrapers with idempotent dedup, RLS thorough on 42+ tables, a 150-question eval harness. The presentation layer (UI/UX, frontend architecture) is at MVP shape — Tailwind installed and unused, 727 hardcoded hex colours, mobile via UA-sniffing, no shared component library. The operational perimeter (security headers, error tracking, tests, CI gating) is mostly absent. **Mederti is closer to "credible institutional product" than the polish level suggests, and further from "investor-grade due-diligence ready" than the velocity suggests.**

---

## 1. Executive Summary

### 1.1 Maturity heatmap

| # | Pillar | Score | One-line verdict |
|---|---|---|---|
| 1 | **Data Architecture & Provenance** | **3.5** | Rich schema, working citation chain — undercut by 3 competing drug-entity tables and 2 uncommitted prod migrations |
| 2 | **Ingestion / Scrapers** | **3.5** | Solid `BaseScraper` primitives + freshness signal — half-done Railway migration with 5 parallel cron definitions |
| 3 | **Backend & APIs** | **3.5** | Clean Supabase-client separation, middleware-gated auth — 5 supplier routes leak unauthenticated, FastAPI legacy still in tree |
| 4 | **Frontend Architecture** | **2.0** | App Router done right but the React layer is bespoke MVP — 1,480-line god-component on the drug page, 88 client components with no shared library |
| 5 | **Performance & Caching** | **3.5** | Strong indexes + parallel queries + `ServerTimer` — 45/49 API routes are `force-dynamic` with no cache headers, predictive-signals aggregates 30k rows in JS |
| 6 | **Code Quality & Maintainability** | **2.5** | Modern stack, descriptive commits — zero automated tests, 2 uncommitted migrations, 26+ stale branches |
| 7 | **Security & Compliance** | **2.5** | RLS thorough, IP/copyright in Terms is explicit — live GitHub PAT in `.git/config`, no HTTP security headers, AWS IP clause undocumented |
| 8 | **UI/UX & Design System** | **1.0** | Tailwind installed and unused; 3,172 inline styles; 727 hardcoded `#hex`; mobile via UA-sniff; live drug page diverges hard from reference mockup |
| 9 | **AI / LLM Layer** | **4.5** | 30 typed tools, 14 named refusal templates, confidence calibration, 150-question eval harness, end-to-end citations — eval CI not yet committed, zero token/cost observability |
| 10 | **Observability, SEO & Product Readiness** | **3.0** | SEO is excellent (robots, sitemap, llms.txt, Drug JSON-LD, dynamic OG) — no Sentry, no `.github/workflows/`, no uptime monitor, conversion-funnel events missing |

**Raw average:** 2.95 / 5
**Weighted average** (1.5× on Pillars 1, 2, 7, 9 — the data-accuracy spine + governance): **3.05 / 5** — "workable, with gaps that will bite at the next stage".

### 1.2 Top 3 critical risks 🔴

1. **🔴 Live GitHub PAT in `.git/config`** (FINDING-S7-01). Plaintext `ghp_…` token embedded in `[remote "origin"]` URL, granting write access to the private repo. Local-only file, but exfiltration cost is low. **Rotate today.** See §3.7 for the 10-minute remediation.
2. **🔴 Half-done Railway scraper migration + 0-record misreporting** (FINDING-D2-01 + D2-02). Five separate cron definitions exist (Mac crontab + `railway/railway.toml` + 3× `railway/*_cron/run.py` + `cron/run_*.py`), all disagreeing on which scrapers run. A typo (`records_upserted` instead of `records_processed`) makes every Railway run *log as 0 records succeeded*, so operators cannot tell healthy from broken. Direct violation of the "data accuracy and recency" north star.
3. **🔴 No error tracking + no automated tests + no CI gates** (FINDING-O10-01 + Q6-01 + O10-02). Sentry/Logtail/Bugsnag are not configured. `*.test.*` and `*.spec.*` counts are zero. `.github/workflows/` does not exist. The recent `712aa22 fix(chat): import missing levelFromScore to unblock Vercel builds` commit confirms builds can break on main with no pre-merge gate. Institutional buyers (government, hospital procurement) will hit silent failures and not surface them.

### 1.3 Top 5 quickest wins (≤ 1 day each, ranked by uplift / effort)

| # | Win | Pillar | Effort | Uplift |
|---|---|---|---|---|
| 1 | Rotate the GitHub PAT in `.git/config`, switch `origin` to SSH or `gh`-managed HTTPS | 7 | 10 min | Removes 🔴; eliminates write-access-leak vector |
| 2 | Fix `records_upserted` → `records_processed` typo in `cron/run_{shortage,recall}_scrapers.py` | 2 | 1 line, 5 min | Railway run logs become legible; silent-failure detection works again |
| 3 | Wire `requireAdmin()` into `/admin/data-sources/page.tsx` and `/admin/naming-graph/page.tsx`; extract `safeNext()` into `lib/auth/safe-next.ts` and call from login/signup `router.push(next)` and `emailRedirectTo` | 7 | 4 files, ~30 min | Closes 2 🟠 findings (S7-02 + S7-03 — admin info disclosure + open-redirect/phishing class) |
| 4 | `git add` migrations 035 + 037 + `backend/importers/ema_epar_importer.py` + commit; verify against prod with `SELECT indexname FROM pg_indexes WHERE tablename='drugs'` | 1 / 6 | 1 commit | Restores migration-history integrity; eliminates schema-drift risk between prod and repo |
| 5 | `npx @sentry/wizard@latest -i nextjs` on the frontend; `pip install sentry-sdk` + 3-line init in `backend/utils/logger.py` | 10 | 30 min | Closes 🔴 O10-01; chat timeouts, RLS denials, scraper upsert failures all start alerting |

### 1.4 Top 3 ⚠ hidden-failure risks

These are the silent-failure modes that won't trip an alert today but will look very bad when they're discovered:

1. **⚠ Eight non-shortage scrapers bypass the `last_scraped_at` heartbeat** (FINDING-D1-01). `clinicaltrials`, `fda_inspections`, `drugs_at_fda`, `edqm_cep`, `ema_chmp`, `eudragmdp`, `fda_adcomm`, `nhs_drug_tariff` all override `run()` and skip the heartbeat write. The public `/freshness` dashboard will mark them stale at 168h even when they ran an hour ago — directly contradicting the credibility tile.
2. **⚠ `audit_logs` is documented as immutable but RLS does not enforce it** (FINDING-D1-14). Policy is `service_role only USING (true)` for `ALL` operations — service-role can `UPDATE` and `DELETE` audit rows. The table's promise of "never UPDATE or DELETE" is unbacked. Any tamper-evidence claim is currently untrue.
3. **⚠ Scraper heartbeat fires even on 0-row results** (FINDING-D2-11). A scraper that hits a regulator page serving HTML 200 with no rows (transient blank page, format change that breaks the row selector) marks itself fresh. `data_sources.last_scraped_at` updates; the freshness dashboard says green; the chat says "no shortages reported" rather than "we don't know". Compounds with D1-01 above.

### 1.5 Top 3 biggest open decisions (these unblock the roadmap)

These are decisions only Rob can make — they shape the remediation plan in §5–§6:

1. **Railway migration: finish or revert?** Five parallel cron definitions exist; `railway/scheduler.py` will hard-fail on import; the Mac laptop sleeping is still a single point of failure. *Decision needed*: pick one runtime (Railway-only or Mac-only) and decommission the other within Sprint 5. Reading: §3.2 + FINDING-D2-01.
2. **Tailwind: commit or rip out?** `tailwindcss ^4` is installed, `@theme inline` is in `globals.css`, `components.json` references shadcn — but application code uses 3 responsive variants total and 3,172 inline `style={{}}` objects. *Decision needed*: build a shared `lib/ui/` component library on Tailwind v4 + shadcn primitives, or remove Tailwind from `package.json` and own the CSS deliberately. The current state is the worst of both. Reading: §3.8 + FINDING-UX-01.
3. **Drug-entity canonicalization** — `drugs`, `drug_catalogue`, `drug_products` are three competing master tables; `_find_or_create_drug` happily creates duplicates per scraper; migration 037 had to drop 035's CAS uniqueness because of fragmentation. *Decision needed*: pick canonical entity (recommend `drugs` with `drug_catalogue` and `drug_products` as strictly downstream views), then sequence a dedupe pipeline. Reading: §3.1 + FINDING-D1-03/D1-08.

---

## 2. How to read this report

- Findings are coded `FINDING-<PILLAR>-NN` and tagged by severity (🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low / ⚠ Hidden-failure).
- Every finding cites a real `file:line` artefact. Where claims need runtime verification (Lighthouse, Supabase Advisor, axe-core, Vercel deploy headers), the report says so.
- Cross-references to the persona coverage audit use its question IDs (SUP-15, HCL-09, etc.).
- Stale facts in the audit brief vs reality: 41 migrations (not 32), 67 scraper files (not 47), 49 Next.js Route Handlers; chat is on Opus 4.7 (not Sonnet 4.6 as CLAUDE.md says); FastAPI is effectively dead despite the brief flagging `NEXT_PUBLIC_API_URL` as a blocker.

---

## 3. Per-pillar findings

### 3.1 Pillar 1 — Data Architecture & Provenance · **3.5 / 5**

**Justification.** 41 migrations, ~51 tables across 7 well-defined surfaces. The shortage core is *very* well thought through: deterministic `set_shortage_id` Postgres trigger (`supabase/migrations/001_initial_schema.sql:241`) mirrored exactly in `backend/scrapers/base_scraper.py:343`, idempotent `mark_stale_shortages()` that writes its own audit row, duplicate-payload fast path that refreshes `last_verified_at`. RLS is on everywhere. Migration 036 explicitly documents LLM-legibility intent. What pulls the score down: three competing drug-entity tables with no documented canonical path, two uncommitted prod migrations (035 + 037), `drug_catalogue` existed in prod for months without a migration, and column comments cover only ~10 columns out of hundreds across the supplier marketplace and supply-intelligence surfaces.

**Inventory snapshot.**

| Surface | Count / Notes |
|---|---|
| Migration files | **41** (`001`–`041`, gap at `034` — never authored, deliberate skip) |
| Uncommitted migrations | 2: `035_drug_external_ids.sql`, `037_relax_external_id_uniqueness.sql` |
| Distinct tables (estimate) | ~51 across 7 surfaces |
| Tables with `COMMENT ON TABLE` | ~24 / 51 |
| Tables with at least one `COMMENT ON COLUMN` | ~12 / 51 |
| `data_sources` rows seeded in migrations | 34+ (production count unknown) |
| Scraper files | 67 (`backend/scrapers/*.py`) |
| Non-shortage scrapers bypassing base `run()` heartbeat | **8** (clinicaltrials, drugs_at_fda, edqm_cep, ema_chmp, eudragmdp, fda_adcomm, fda_inspections, nhs_drug_tariff) |

**Findings.**

#### 🔴 FINDING-D1-01 — 8 non-shortage scrapers silently bypass the `last_scraped_at` heartbeat
- **Artifact:** `backend/scrapers/clinicaltrials_scraper.py:204` (`def run`); same pattern in `fda_inspections_scraper.py:232`, `drugs_at_fda_scraper.py:167`; plus 5 more that override `upsert` only.
- **Issue:** The `data_sources.last_scraped_at` update lives only in `BaseScraper.run()` (`base_scraper.py:613`) and `BaseRecallScraper.run()` (`base_recall_scraper.py:546`). The 8 scrapers that override `run()` never call `data_sources.update`. Their freshness signal stays at whatever `scripts/backfill_last_scraped_at.py` last derived from event timestamps.
- **Risk:** The public freshness dashboard (`/freshness`) marks any source >168h stale. These 8 scrapers will *look broken* on a public credibility tile even when they ran successfully an hour ago.
- **Remediation:** **S.** Extract `_touch_data_source(self, finished_at)` mixin; call from every overriding `run()`. Run `backfill_last_scraped_at.py --apply` once.

#### 🔴 FINDING-D1-02 — `drug_catalogue` was production-only for ~10 weeks; schema-drift surface
- **Artifact:** `supabase/migrations/036_schema_legibility.sql:34-64`; commit `f57ec90`.
- **Issue:** 036's header admits the table held 160k+ rows in prod with no `CREATE TABLE` anywhere in `001`–`035`. Migration `026:54` already does `ALTER TABLE drug_catalogue ADD COLUMN`, which would fail on a fresh clone. Retroactive `CREATE TABLE IF NOT EXISTS` is good housekeeping but does not prove the production columns match the inlined definition.
- **Risk:** Fresh clones (CI, staging, local) cannot reproduce production deterministically. Out-of-band Supabase Dashboard edits to `drug_catalogue` are invisible to migration history.
- **Remediation:** **M.** Snapshot prod with `pg_dump --schema-only`; diff against 036; add CI check that runs `001`–`041` against empty Postgres and asserts schema matches.

#### 🟠 FINDING-D1-03 — Three drug-entity tables, no canonical resolution doc
- **Artifact:** `drugs` (001), `drug_catalogue` (036, prod since ~Mar), `drug_products` (011).
- **Issue:** All three carry generic-name / strength / form. Frontend hits all three: `bulk-lookup` and `market-gaps` query `drug_products`; `availability`, `search`, `drug-autocomplete` query `drug_catalogue`; chat queries `drugs`. No view normalises across them and no doc says "for X use Y".
- **Risk:** Silent answer divergence between routes (autocomplete finds it, drug-resilience does not). Migration 037 had to relax 035's uniqueness *because* Mederti has multiple `drugs` rows per chemical entity. Cross-ref FINDING-D1-08.
- **Remediation:** **M.** Pick canonical (`drugs`), either make the others strictly downstream views with `drug_id NOT NULL`, or write a `v_canonical_drug` resolver view. Pair with a deduper batch job. Migration 037's header already names this debt — formalise it.

#### 🟠 FINDING-D1-04 — Two competing status enums across `shortage_events` and `drug_availability`
- **Artifact:** `001_initial_schema.sql:198` (`'active','resolved','anticipated','stale'`) vs `011_drug_universe.sql:71` (`available`, `shortage`, `limited`, `discontinued`).
- **Issue:** Migration 036 explicitly notes the collision and warns LLMs which to use when — the right band-aid. The underlying duality remains. `drug_status_snapshots` aggregates `drug_availability.status` (not `shortage_events.status`), so the daily-snapshot counts and the public shortage feed track different denominators.
- **Remediation:** **M.** Retire `drug_availability.status` (recommended — usage unclear) or ship `v_unified_status` view with explicit provenance enum tags.

#### 🟠 FINDING-D1-05 — Uncommitted migrations 035 + 037 are presumed-applied to prod
- **Artifact:** `supabase/migrations/035_drug_external_ids.sql`, `037_relax_external_id_uniqueness.sql` — both `??` in `git status`.
- **Issue:** 035 adds `drugs.cas_number` and `drugs.ema_product_number` with partial UNIQUE indexes. 037 drops those uniques (replaces with non-unique) explicitly because *"the unique constraint caused 223/812 patches to 409 on the first EMA EPAR backfill run"*. Past-tense phrasing strongly implies both ran in prod. Neither in git.
- **Risk:** Migration history is **incomplete**. Next agent has no idea these ran. Rollback story broken. Cross-ref FINDING-Q6-02.
- **Remediation:** **S.** `git add supabase/migrations/035_drug_external_ids.sql supabase/migrations/037_relax_external_id_uniqueness.sql backend/importers/ema_epar_importer.py scripts/test_step5_tools.mjs`; commit; verify with `SELECT column_name FROM information_schema.columns WHERE table_name='drugs' AND column_name IN ('cas_number','ema_product_number')`.

#### 🟠 FINDING-D1-06 — `shortage_events` has 6 timestamp/date columns with overlapping semantics
- **Artifact:** `shortage_events` (`001:209-217` + `009:8-14` + `016:6-8` + `039:23`).
- **Issue:** `start_date`, `end_date`, `estimated_resolution_date`, `last_verified_at`, `first_reported_date` (new in 039), `created_at`, `updated_at`. Migration 036 documents three of them; the rest are undocumented. No explicit `discovered_at` — `created_at` is a reasonable proxy but is never declared as such.
- **Remediation:** **S.** Add COMMENT ON COLUMN for `created_at`/`updated_at`/`end_date`. Wire `first_reported_date` into at least TGA (it exposes notification date) so 039 becomes functional.

#### 🟠 FINDING-D1-07 — Recalls and shortages share `data_sources` but use different FK column names
- **Artifact:** `recalls.source_id` (`007:18`) vs `shortage_events.data_source_id` (`001:194`); same target.
- **Issue:** Convention drift. `scripts/backfill_last_scraped_at.py:97` had to special-case it. Bites every cross-source query.
- **Remediation:** **M.** Add `data_source_id` as `GENERATED ALWAYS AS (source_id) STORED` on `recalls`, or rename via migration.

#### 🟡 FINDING-D1-08 — `_find_or_create_drug` is the root cause of entity fragmentation
- **Artifact:** `backend/scrapers/base_scraper.py:315-337`.
- **Issue:** Auto-creates `drugs` rows labelled `therapeutic_category='Auto-created by <X> scraper'` whenever exact-normalised + first-word-prefix matching fails. No synonym check (despite `drug_synonyms` existing since 026). No dedupe.
- **Risk:** Drug table accumulates near-duplicates. Per-drug shortage counts split across N rows. Migration 037's header cites this directly.
- **Remediation:** **L.** (a) Gate auto-create on a `drug_synonyms` + `active_ingredients` lookup; (b) one-off dedupe pipeline merging rows by `cas_number`, `rxcui`, fuzzy `generic_name_normalised`.

#### 🟡 FINDING-D1-09 — `raw_scrapes.scraper_version` hardcoded `"1.0.0"` everywhere
- **Artifact:** `base_scraper.py:71`, `base_recall_scraper.py:116`.
- **Issue:** Class-level default no subclass overrides. Defeats the column's purpose.
- **Remediation:** **S.** Bump `SCRAPER_VERSION` per-subclass on behavioural change, or derive from `git rev-parse HEAD` at startup.

#### 🟡 FINDING-D1-10 — 8 of ~51 tables have a `COMMENT ON TABLE` but no column comments
- **Artifact:** All `supplier_*` tables (020/021/022), `intelligence_articles`, `clinical_trials`, `regulatory_events`, `manufacturing_facilities`, `api_suppliers`, `drug_approvals`, `drug_pricing_history`, `therapeutic_equivalents`.
- **Issue:** 036's column-comments lift covered shortages, drugs, recalls, alerts. Supplier marketplace + supply-intel surfaces have only table-level docs; many cryptic columns (`te_code`, `pipeline_stage`, `verification_status`, `entity_id`, `payload`).
- **Risk:** Chat-tool agents cannot leverage these tables well.
- **Remediation:** **M.** Sprint 036's pattern across the supplier and supply-intel surfaces. Highest leverage: `drug_approvals.te_code`, `manufacturing_facilities.fei_number/DUNS/OAI`, `supplier_quotes.pipeline_stage` enum, `regulatory_events.event_type` enum.

#### 🟡 FINDING-D1-11 — `drug_universe` views are orphans
- **Artifact:** `011_drug_universe.sql:99-169` — `v_au_drug_universe`, `v_gb_drug_universe`, `v_drug_universe_global`.
- **Issue:** `grep "drug_universe" frontend/` returns zero hits. Built for an architecture that did not survive the `drug_catalogue` pivot.
- **Remediation:** **S.** Drop in a tidy migration with a comment, or wire into country-detail endpoints if the data is good.

#### 🟢 FINDING-D1-12 — `drug_alternatives` lacks per-row source URL
- **Artifact:** `001_initial_schema.sql:283-291`, `006_drug_alternatives_columns.sql`.
- **Issue:** `source` enum exists (`manual|atc|rxnorm|fda_orange_book`); `dose_conversion_notes` is free text with no citation. Chat refuses to surface alternatives without citation per system prompt — hidden coverage ceiling.
- **Remediation:** **S.** Add `source_url TEXT` + `source_note TEXT`; backfill from ATC linking.

#### 🟢 FINDING-D1-13 — `mark_stale_shortages()` runs 7-day window but no cron actually invokes it
- **Artifact:** `001_initial_schema.sql:464-511`.
- **Issue:** Comment says "Run daily via pg_cron or Supabase Edge Function scheduler." `cron/crontab_fixed.txt` doesn't invoke it. **Needs runtime check** — is pg_cron configured in prod?
- **Remediation:** **S.** Either pg_cron `SELECT mark_stale_shortages()` daily or a Vercel cron route.

#### ⚠ FINDING-D1-14 — `audit_logs` is declared immutable but RLS does not enforce it
- **Artifact:** `001_initial_schema.sql:376-394, 614-617`.
- **Issue:** Policy is `service_role only FOR ALL USING (auth.role() = 'service_role')` — service_role can `UPDATE` and `DELETE` audit rows. The "Never UPDATE or DELETE rows here" comment is unbacked.
- **Risk:** Audit table cannot be relied on for tamper-evident proof. Material for due diligence.
- **Remediation:** **S.** `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`. Or split into a true append-only role.

**Citation chain verdict.** Intact for shortage scrapers using the base class (row → `data_source` → `raw_scrapes` → `last_verified_at` → `data_sources.last_scraped_at`). Breaks at 3 places: (a) the 8 non-shortage scrapers (D1-01), (b) recalls' `source_id` naming drift (D1-07), (c) downstream derived data — `drug_alternatives` and `intelligence_articles` have no per-row source URLs.

---

### 3.2 Pillar 2 — Ingestion / Scrapers · **3.5 / 5**

**Justification.** Strong primitives: `BaseScraper.run()` (`base_scraper.py:496`) provides a real lifecycle — raw-scrape audit log, deterministic MD5 dedup, status-change capture, automatic `last_scraped_at` heartbeat (lines 612–622), `last_verified_at` refresh on duplicate payloads + stale-row re-activation (lines 543–566). Two base classes cleanly cover 60 of 64 scrapers. End-to-end freshness signal works: scraper → `data_sources.last_scraped_at` → `/api/freshness` → daily `detect_stale_sources` (`backend/health/detectors.py:120`) → ops email. **What pulls the score down:** five parallel cron execution paths, 4 quarantined sources with no re-enable date, one log file at 537 MB, and a one-character typo (`records_upserted` vs `records_processed`) that makes every Railway run log as `0 records`.

**Scraper inventory (reconciling the brief's "47" vs reality).**

| Bucket | Count |
|---|---|
| Functional scrapers under `backend/scrapers/` | **64** (+ 2 base classes + `recall_linker.py` + `__init__.py` = 67 files) |
| Shortage scrapers in `run_all_scrapers.py:62` (`SCRAPERS` dict) | 42 |
| Recall scrapers registered | 10 |
| Supply-intelligence scrapers | 8 |
| Eligibility scrapers under `backend/scrapers/eligibility/` | 5 (NEW, not in any cron) |
| Importers under `backend/importers/` + `scripts/import_*.py` | 8 (ad-hoc by design) |
| Quarantined (active failure) | 7 |
| **In Mac crontab (`crontab_fixed.txt`)** | **47 scheduled jobs** |

**Findings.**

#### 🔴 FINDING-D2-01 — Five parallel cron execution paths disagree about which scrapers run
- **Artifact:** `cron/crontab_fixed.txt`, `railway/railway.toml`, `railway/shortage_cron_daily/run.py`, `railway/shortage_cron_frequent/run.py`, `railway/recall_cron/run.py`, `cron/run_shortage_scrapers.py`, `railway/scheduler.py`.
- **Issue:** Five separate "what runs and when" definitions with non-overlapping scraper lists. `railway/scheduler.py` imports class names that don't exist anymore (`MHRARecallScraper`, etc.) — instant crash on startup. Reader cannot tell from the repo which configuration is actually live on Railway today.
- **Risk:** A scraper believed to be on Railway may not be. Mac laptop sleeping = silent downtime. Two systems both writing is benign (MD5 dedup) but doubles DB write load.
- **Remediation:** **M.** Delete dead variants (`railway/scheduler.py`, `railway/scrapers/`, `railway/regulatory_cron/`). Pick ONE Railway runner per category. Document. See open decision #1.

#### 🔴 FINDING-D2-02 — Railway runners misreport record counts as 0
- **Artifact:** `cron/run_shortage_scrapers.py:63` and `cron/run_recall_scrapers.py:49`.
- **Issue:** Both read `summary.get("records_upserted", 0)` but `BaseScraper.run()` returns `records_processed` (`base_scraper.py:582`). The key `records_upserted` is **never set**. Every Railway run logs `… success     0 records`.
- **Risk:** Operators can't tell healthy from broken from Railway logs. Defeats the entire point of structured cron output. Masks regressions until `detect_silent_failure_scrapers` runs ~24h later.
- **Remediation:** **S.** One-line fix. `records_processed` not `records_upserted`.

#### 🔴 FINDING-D2-03 — `logs/cron.log` at 537 MB, total `logs/` at ~1 GB, no rotation
- **Artifact:** `logs/cron.log` (537M), `logs/scraper_2026-05-26.log` (33M).
- **Issue:** No log rotation anywhere. `cron.log` grows unbounded via `>> logs/cron.log 2>&1` in every Mac crontab line. 67 daily scraper logs retained back to Feb 2026.
- **Remediation:** **S.** `logrotate` or move structured logging to Railway/cloud-log.

#### 🟠 FINDING-D2-04 — 7 quarantined scrapers — 4 critical-market countries silently absent
- **Artifact:** `cron/RAILWAY_SERVICES.md:154-164`, `cron/run_shortage_scrapers.py:37-42`.
- **Issue:** china_nmpa (CN), india_cdsco (IN), israel_moh (IL), poland_mz (PL), aemps_recalls (ES), bfarm_recalls (DE), hsa_recalls (SG). No owner, no deadline. **`poland_mz` is still in Mac crontab line 56** despite being quarantined elsewhere — it fails daily.
- **Risk:** Coverage gap is silent to end users — search returns no results for affected markets. Damages "world's leading source" positioning.
- **Remediation:** **L.** Fix per scraper (M each).

#### 🟠 FINDING-D2-05 — Likely France SLA breach — ANSM scraper is MITM-only by design
- **Artifact:** `backend/scrapers/ansm_scraper.py:35` ("All records are on a single page — no pagination").
- **Issue:** ANSM only scrapes the MITM (critical medicines) list, not the full DGS shortage register. Matches the brief's "France 162 vs ~1,000+" gap.
- **Risk:** Mederti FR data is structurally bounded to MITM. False negatives for non-MITM drug queries.
- **Remediation:** **M** (widen scraper) or **S** (document MITM-only on freshness page first).

#### 🟠 FINDING-D2-06 — Eligibility scrapers landed but never scheduled
- **Artifact:** `backend/scrapers/eligibility/{fda_shortage,mhra_ssp,tga_s19a,eu_art_5_2}.py`.
- **Issue:** Real parsers verified (full HTMLParser implementations), reference migration 040 (`regulatory_eligibility`), appear in no cron file. Run only from `if __name__ == "__main__":`.
- **Risk:** SSP / s19A / 503B eligibility data goes stale immediately. Critical for pharmacists evaluating substitution legality. Cross-ref persona audit SUP-16, RET-08, RET-27, HPR-18.
- **Remediation:** **S.** Add to Railway cron (daily).

#### 🟠 FINDING-D2-07 — `recall_linker` only runs in Mac cron, not on Railway
- **Artifact:** `backend/scrapers/recall_linker.py`, `run_all_scrapers.py:338`, `cron/run_recall_scrapers.py` (doesn't call it).
- **Issue:** Runs once at the end of the Mac orchestrator. If Mac cron disappears, recall→shortage causal links stop populating silently. CLAUDE.md flags this as "a strong differentiator if populated".
- **Remediation:** **S.** Move `link_unlinked_recalls()` call into the Railway recall runner.

#### 🟡 FINDING-D2-08 — Class-I recall auto-creates synthetic shortage with severity=high, no human review
- **Artifact:** `backend/scrapers/recall_linker.py:158-211`.
- **Issue:** Any Class I recall with no matching active shortage auto-creates a synthetic `shortage_events` row, severity=high. Drug-resolver runs through `_find_or_create_drug` so a misclassified recall title COULD auto-create a fake drug + synthetic shortage. The `_looks_like_drug_name` guard mitigates but isn't bulletproof.
- **Risk:** Regulator-feed glitch becomes a phantom shortage the chat will confidently surface.
- **Remediation:** **M.** Add `synthetic=true` flag, surface differently in UI, require non-null `recall_ref` before auto-create.

#### 🟡 FINDING-D2-09 — Stale-source detector window misaligned with cron cadence
- **Artifact:** `backend/health/detectors.py:149`.
- **Issue:** Threshold is `max(scrape_frequency_hours or 24, 24) + 12` ≥ 36h. Daily scrapers missing one run register as "fresh". Combined with D2-02 (record counts wrong) and D2-11 (heartbeat on 0 rows), silent breakage stays invisible 24–48h.
- **Remediation:** **S.** Promote `detect_silent_failure_scrapers` findings (`detectors.py:261`) to ERROR not WARN.

#### 🟡 FINDING-D2-10 — Untracked importer `backend/importers/ema_epar_importer.py`
- **Artifact:** 403 lines, uncommitted per `git status`.
- **Issue:** Functional EMA EPAR importer with dry-run support, primary + fallback URLs, `drugs.ema_product_number` patching (depends on uncommitted migration 035).
- **Remediation:** **S.** Commit and schedule (quarterly) — or delete.

#### 🟡 FINDING-D2-11 — Heartbeat updates even when scraper returned 0 records
- **Artifact:** `backend/scrapers/base_scraper.py:613-617`.
- **Issue:** `last_scraped_at` updates on any non-failed status. Fresh heartbeat + zero new rows looks identical to "site has no shortages today".
- **Remediation:** **M.** Track `records_found` in `data_sources` too; freshness API can show "scraped 4h ago, 0 records (28-day avg: 240)".

#### 🟢 FINDING-D2-12 — Salt-form prefix matching causes drug-resolution collisions (legacy path)
- **Artifact:** `backend/scrapers/base_scraper.py:291-313`.
- **Issue:** "amoxicillin trihydrate" prefix-matches to whatever "amoxicillin*" comes first. Known issue per memory file `project_drug_resolver_backfill.md` — fix shipped 2026-05-26 but legacy Tier 2 prefix-match still runs.
- **Remediation:** **S.** Replace with post-fix resolver.

#### 🟢 FINDING-D2-13 — `railway/scheduler.py` is dead code that will crash on import
- **Artifact:** `railway/scheduler.py:16-25`.
- **Issue:** Imports class names that no longer exist post-BaseScraper refactor. If `Procfile`'s `worker: python scheduler.py` is ever spawned: instant crash.
- **Remediation:** **S.** Delete `railway/scheduler.py`, `railway/scrapers/`, `railway/Procfile`.

**Heartbeat & freshness verdict.** Detectable for shortage scrapers. Weakness: heartbeat updates on empty results (D2-11); `OPS_ALERT_EMAIL` warned-but-not-enforced; Railway runners' 0-record misreporting defeats human log inspection.

**Railway migration status.** Half-done. Both systems run today. **Decision needed (open #1).**

---

### 3.3 Pillar 3 — Backend & APIs · **3.5 / 5**

**Justification.** Next.js Route Handler monolith with disciplined Supabase client separation (`admin.ts` server-only, `server.ts` for session SSR, `client.ts` browser) and a clean middleware-based auth gate (`frontend/middleware.ts:107`) that defaults to "auth required" with an explicit public allowlist. Admin routes uniformly gated through `requireAdmin()` (`frontend/lib/admin-auth.ts:30`) with both env-allowlist and DB-flag paths. Legacy FastAPI is *almost* dead — one stale `BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"` reference (`frontend/app/search/page.tsx:13`) is unused dead code. The gaps are uneven: rate-limiting only on 2 routes; no per-route OpenAPI contract or integration tests; no `frontend/.env.example`; the typed client `lib/api.ts` references routes that don't exist as Route Handler files.

**API surface inventory.** 49 Next.js Route Handler files under `frontend/app/api/` (47 `route.ts` + 2 `route.tsx` for OG images). Domain split:

| Domain | Routes | Auth model |
|---|---|---|
| Chat / AI | `/api/chat`, `/api/chip-answer`, `/api/daily-question`, `/api/detect-columns`, `/api/drugs/[id]/so-what`, `/api/intelligence/briefing` | Optional / public |
| Data (public) | `/api/search`, `/api/drug-autocomplete`, `/api/drug/[id]`, `/api/drugs/[id]/{availability,preview}`, `/api/drug-resilience/[drug_id]`, `/api/bulk-lookup`, `/api/market-data`, `/api/pipeline/[drug_id]`, `/api/freshness`, `/api/regulatory-calendar`, `/api/predictive-signals` | Public |
| Supplier (public) | `/api/suppliers/directory`, `/api/suppliers/by-drug/[id]`, `/api/suppliers/profile/[slug]` | Public |
| Supplier dashboard (session) | `/api/supplier/{portfolio,profile,inventory,inventory/bulk,quotes,inbox,verification,insight/*,briefing,analytics}` | Session-gated |
| Supplier dashboard (NO AUTH) | `/api/supplier/{demand-signals,market-gaps,opportunities,pathways,regulatory}` | **No auth — see 🟠 FINDING-B3-01** |
| Admin | `/api/admin/{intelligence,intelligence/[id],cohorts,freshness}` | `requireAdmin()` |
| User | `/api/user/{role,profile}` | Session-gated |
| Comms | `/api/contact`, `/api/lead`, `/api/subscribe`, `/api/supplier-enquiry` | Public POST |
| OG image | `/api/og`, `/api/og/drug/[id]` | Public |

**Findings.**

#### 🟠 FINDING-B3-01 — Five `/api/supplier/*` routes return business intelligence without auth checks
- **Artifact:** `frontend/app/api/supplier/demand-signals/route.ts:8`, `market-gaps/route.ts:8`, `opportunities/route.ts:9`, `pathways/route.ts:17`, `regulatory/route.ts:49`.
- **Issue:** Siblings of properly-gated supplier routes (which all `createServerClient + auth.getUser`), but these 5 skip the auth check and pull via the service-role admin client. Middleware skips `/api/*` per its matcher (`middleware.ts:215`) — no other gate.
- **Risk:** Pre-aggregated buyer demand signals, market gaps, opportunity rankings, regulatory pathway data — all leak to any anonymous caller. Product IP and (for demand-signals) buyer behaviour. UI gates the page; the API is a direct backdoor.
- **Remediation:** **S.** Add the auth preamble used in other supplier routes; return 401 on null user. If meant to be public marketing-page fodder, move to `/api/public/*`.

#### 🟠 FINDING-B3-02 — Stale `NEXT_PUBLIC_API_URL` reference + FastAPI legacy still in repo without kill-switch
- **Artifact:** `frontend/app/search/page.tsx:13`, plus `api/main.py` and `api/routers/*`.
- **Issue:** Dead unused variable mis-signals that FastAPI is on the critical path. The brief's "NEXT_PUBLIC_API_URL pointing to localhost" blocker is a non-issue — no live frontend code path depends on it. Meanwhile `api/main.py` duplicates Route Handler logic, risking schema drift between two endpoint families.
- **Remediation:** **S.** Delete `search/page.tsx:13`; rename `api/` → `legacy-api/` with a header README or delete outright. Update `cron/RAILWAY_SERVICES.md` service 4.

#### 🟡 FINDING-B3-03 — No `frontend/.env.example`; Vercel env requirements only in CLAUDE.md
- **Artifact:** Repo root has `.env.example` (Supabase only); `frontend/` has none.
- **Issue:** ~8 required frontend env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAILS`, `NEXT_PUBLIC_SOFT_LAUNCH`). None templated.
- **Risk:** Silent misconfiguration. Chat has a "degraded" fallback when `ANTHROPIC_API_KEY` missing — if Vercel forgets to set it after rotation, AI surface silently downgrades.
- **Remediation:** **S.** Add `frontend/.env.example` with every consumed var, comment indicating server-side vs public.

#### 🟡 FINDING-B3-04 — Rate limiting only on `/api/chat` and `/api/lead`; chat limiter is per-instance and resets on cold-start
- **Artifact:** `frontend/lib/chat/rate-limit.ts:1-29`.
- **Issue:** 30/hour/IP, in-memory, resets per region/cold-start (acknowledged in comments). The other 47 routes are unprotected. `daily-question` uses Anthropic + `web_search` — single attacker could exhaust the quota.
- **Risk:** Cost-amplification on AI routes; scraping of valuable data.
- **Remediation:** **M.** Move to Vercel KV / Upstash Redis; apply across `chat`, `chip-answer`, `daily-question`, `intelligence/briefing`, `drugs/[id]/so-what`, `supplier/insight/*`, `detect-columns`.

#### 🟡 FINDING-B3-05 — Typed client `lib/api.ts` references routes that don't exist
- **Artifact:** `frontend/lib/api.ts:167-210`.
- **Issue:** Wrappers for `/drugs/{id}/shortages`, `/drugs/{id}/alternatives`, `/drugs/{id}/recalls`, `/shortages?...`, `/shortages/summary`, `/recalls?...`, `/recalls/summary` — **none of these have backing Route Handler files**. They exist only on the FastAPI side.
- **Risk:** Latent runtime errors on pages that import the typed client and call missing-route methods.
- **Remediation:** **S.** Audit `grep -rn "from.*lib/api" frontend/app`; either implement the missing handlers or delete the wrappers.

#### 🟢 FINDING-B3-06 — Business logic location: drug resilience computed inline in the route handler, not the DB
- **Artifact:** `frontend/app/api/drug-resilience/[drug_id]/route.ts:36-110`.
- **Issue:** 5 parallel Supabase queries + JS cross-referencing of supplier-companies-to-facility-names to derive OAI exposure. Same shape in `predictive-signals`, `regulatory-calendar`, `pipeline/[drug_id]`, `market-data`, `intelligence/briefing`. No reusable helper.
- **Remediation:** Push aggregations into Supabase views (the codebase already has `v_drug_manufacturer_concentration`, `v_demand_signal_summary`) or into `frontend/lib/insights/*.ts` shared helpers callable from API routes AND chat tools.

#### 🟢 FINDING-B3-07 — Wide `select(...)` strings duplicated across routes; PostgREST schema-drift risk
- **Artifact:** `frontend/lib/chat/tools.ts:601-619` already shows the fallback dance ("wide select failed... retrying without migration-035 columns").
- **Remediation:** Generate Supabase types (`supabase gen types typescript`) and consume; or wrap the wide-select pattern in a helper handling missing columns.

---

### 3.4 Pillar 4 — Frontend Architecture · **2.0 / 5**

**Justification.** Working, deployed Next.js 16 / React 19 app with sensible App Router layout, middleware-driven auth/onboarding gating, server-first data path through `lib/supabase/admin.ts`. Underneath: 88 client components, almost all hand-rolled with inline styles; a **1,480-line `drugs/[id]/page.tsx`** that mixes data fetching, persona routing, derived state, JSON-LD generation, mobile branching and three render paths. Multiple parallel UI experiments (`v4/`, `chat/components/cards/*` vs `drugs/[id]/*View.tsx`, `mobile/Mobile*`) with no clear winner. Component reuse via shared primitives is **essentially zero** — there's no `ui/` library despite `components.json` declaring shadcn. State is split between localStorage, React context, and `useState` with no overarching pattern. Posture: *shipping fast*, not *steady-state system*.

**Route map (high-traffic subset).**

| Route | Strategy | Auth | Notes |
|---|---|---|---|
| `/` | ISR (`revalidate=300`) + signed-in redirect to `/home` | Public | Mobile branch via UA |
| `/drugs/[id]` | `force-dynamic` | Public | **1,480-line server file**; persona + mobile branches |
| `/chat`, `/chat/[chatId]` | `force-dynamic` | Public | Heavy client; localStorage chat store |
| `/freshness` | `force-dynamic` + `revalidate=300` (conflict, see F4-07) | Public | |
| `/home`, `/dashboard`, `/account` | `force-dynamic` | Auth | |
| `/onboarding` | Client | Auth | Middleware forces here if `onboarding_done=false` |
| `/alerts`, `/watchlist` | **308-redirected to `/account`** in `next.config.ts:13` | Auth | Dead routes — page files still exist |
| `/supplier-dashboard/*` | mostly `force-dynamic` | Auth (supplier role) | |
| `/admin/*` | mostly `force-dynamic` | Admin via `requireAdmin()` (except 2 — see S7-02) | |

**TypeScript posture.** `strict: true`, but `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitOverride` are off. The drug page alone has **28 `eslint-disable @typescript-eslint/no-explicit-any`** directives. Repo-wide: **74 `: any` declarations + 125 `as any` casts**. Zero `@ts-ignore` (silently worse — escapes flow through `any` instead). No generated Supabase types. `tsconfig.target = ES2017` on a Next 16 / React 19 app.

**State ownership.** No global store (no Zustand, no Redux, no Tanstack Query). Chat rolls its own `chatStore.ts` + `folderStore.ts` + `watchlistStore.ts` against `localStorage` with custom events for same-tab updates. Three React contexts in `chat/`: `ChatContext`, `PaneContext`, `LeadContext`. **Zero server actions** — every mutation goes through `/api/*`.

**Findings.**

#### 🔴 FINDING-F4-01 — `/drugs/[id]/page.tsx` is a 1,480-line god-component
- **Artifact:** `frontend/app/drugs/[id]/page.tsx`.
- **Issue:** One server component handles: SEO metadata, three render paths (catalogue-only / persona F-bento / classic), mobile branching, persona resolution, six parallel Supabase queries + three extra await chains, a timeline reducer, risk-score calculation, manufacturer-concentration and pharma-spend lookups (each silently swallows exceptions), JSON-LD assembly, ~600 lines of inline `style={{}}` JSX. 28 `eslint-disable` directives.
- **Risk:** Multi-hour archaeology dig per change. Three paths duplicate header/layout/styling logic. Bugs in one variant don't surface in others.
- **Remediation:** **M-L.** Extract `DrugCataloguePage`, `DrugPersonaPage`, `DrugClassicPage` siblings; lift derived state to `lib/drug/aggregations.ts`; type query rows once; move JSON-LD to `lib/seo.ts`.

#### 🟠 FINDING-F4-02 — Two parallel persona-view component trees
- **Artifact:** `frontend/app/drugs/[id]/{PharmacistAnswerCard,ProcurementView,SupplierView}.tsx` vs `frontend/app/chat/components/cards/{PharmacistCard,ProcurementCard,SupplierCard}.tsx`.
- **Issue:** Two independent implementations of the same persona logic. Chat cards share helpers (`ManufacturersStrip`, `ShortageHistoryLine`, `TradePriceStrip`) the drug-page views don't reuse.
- **Remediation:** **M.** One canonical `lib/persona/<PharmacistBlocks />` etc., consumed by both. Or document why they must differ.

#### 🟠 FINDING-F4-03 — Dead components shipping in the bundle
- **Artifact:** `SpinningGlobe.tsx` (8.4 KB), `world-map.tsx` (6.9 KB — zero imports), `drugs/[id]/{CrossBorderAvailability,PipelineRegulatory,SupplyChainResilience,ai-insight-chips,forecast}.tsx` (zero imports), `chat/components/parser.tsx` + `parser2.tsx` co-exist.
- **Remediation:** **S.** Delete unimported files. Rename `parser2.tsx` → `parser.tsx`.

#### 🟠 FINDING-F4-04 — Soft-launch + ISR + middleware all redirect `/` differently
- **Artifact:** `frontend/middleware.ts:121`, `frontend/app/page.tsx:33`, `frontend/next.config.ts:13`.
- **Issue:** `/` is ISR (300s) but the page calls `redirect("/home")` for signed-in users — forces per-request execution and defeats ISR for the dominant logged-in path. The only ISR-cached page is "anonymous desktop landing" — which is also the only page with a 5-min stale window for live stat numbers.
- **Remediation:** **S.** Drop `revalidate` for `force-dynamic`, or split stats fetch into `unstable_cache`.

#### 🟠 FINDING-F4-05 — `/alerts` and `/watchlist` are dead routes
- **Artifact:** `next.config.ts:13-14` 308-redirects both to `/account`; `app/alerts/page.tsx` + `app/watchlist/page.tsx` still exist with full client implementations.
- **Remediation:** **S.** Delete the two `page.tsx` files.

#### 🟡 FINDING-F4-06 — `strict` is on, but `any` is the safety valve (74 + 125 escape hatches)
- **Artifact:** Repo-wide; concentrated in `drugs/[id]/page.tsx`, `chat/components/parser*.tsx`, `chat/components/cards/*`.
- **Risk:** Schema changes (37+ migrations) silently break the frontend at runtime.
- **Remediation:** **M.** Add `supabase gen types typescript > frontend/types/db.ts` to toolchain; type the Supabase client. `any` count should drop ~80%.

#### 🟡 FINDING-F4-07 — `/freshness/page.tsx` has conflicting cache directives
- **Artifact:** `frontend/app/freshness/page.tsx:11-12`.
- **Issue:** Declares both `dynamic = "force-dynamic"` AND `revalidate = 300`. Next takes `force-dynamic` and ignores `revalidate`.
- **Remediation:** **S.** Pick one (recommend `revalidate = 300` for a read-mostly public page).

#### 🟡 FINDING-F4-08 — No `loading.tsx` anywhere
- **Artifact:** `find frontend/app -name loading.tsx` = 0.
- **Risk:** No Suspense boundaries → blank tab for 500ms–2s on drug page (6 parallel queries + 2 sequential). CLS hit.
- **Remediation:** **S.** Add at `/`, `/drugs/[id]`, `/chat`, `/dashboard`, `/intelligence`, `/freshness`.

#### 🟡 FINDING-F4-09 — Chat localStorage stores will break for multi-device users
- **Artifact:** `chat/chatStore.ts`, `folderStore.ts`, `watchlistStore.ts`.
- **Issue:** All chat history, folders, watchlist in `localStorage` keyed `chat2:*:v1`. Second-device sign-in sees nothing. Acknowledged in `chatStore.ts` header.
- **Remediation:** Real chat table; on the roadmap. Avoid building more features that compound the dependency.

#### 🟢 FINDING-F4-10 — `tsconfig.target = ES2017` on Next 16 / React 19
- **Artifact:** `frontend/tsconfig.json:3`.
- **Remediation:** **S.** Bump to `ES2022`.

#### ⚠ FINDING-F4-11 — Undocumented `v4/` directory under `drugs/[id]`
- **Artifact:** `frontend/app/drugs/[id]/v4/{bell-button.tsx, header-actions.tsx}`.
- **Issue:** `next.config.ts` redirects `/v2,/v3,/v4,/classic` back to `/drugs/:id` — page is dead but the *components* are still used.
- **Remediation:** **S.** Move components up to the parent folder; delete `v4/`.

---

### 3.5 Pillar 5 — Performance & Caching · **3.5 / 5**

**Justification.** Solid foundations: ISR on homepage, dynamic per-request rendering on user-specific pages, dedicated FTS + trigram indexes (`supabase/migrations/038_trigram_indexes_for_autocomplete.sql`), parallel Supabase round-trips with `ServerTimer` instrumentation (`lib/server-timing.ts`), Inter/DM Mono via `next/font`, Vercel Speed Insights live. But not yet "Lighthouse > 90 by design": almost every API route is `force-dynamic`, raw `<img>` everywhere, no `images.remotePatterns`, `predictive-signals` paginates 30k rows in JS. **Lighthouse needs runtime check.**

**Caching strategy summary.**

| Route | Strategy | Revalidate |
|---|---|---|
| `/` | ISR | 300s |
| `/freshness` | ISR (+conflicting `force-dynamic`) | 300s |
| `/sitemap.ts` | ISR | 3600s |
| All other pages | `force-dynamic` | none |
| 45 of 49 `/api/*` routes | `force-dynamic` | none |

No `useSWR` / TanStack Query / `Cache-Control` headers anywhere — every browser fetch is a full miss.

**Index coverage on hot paths.**

- **`shortage_events`** — well-covered: `drug_id`, `country_code`, `status`, `severity` (partial), `start_date DESC`, `last_verified_at`, `manufacturer_id`, `data_source_id`, composite `idx_shortage_events_drug_active`.
- **`drugs`** — FTS `idx_drugs_search_vector` (GIN), trigram on generic+brand (001 + 038), `atc_code`, `therapeutic_category`, `rxcui WHERE NOT NULL`, `who_eml WHERE TRUE`. Excellent.
- **`drug_synonyms`** — composite `(drug_id, synonym_normalised)` (026).
- **Gaps:** `shortage_events(country_code, status)` composite missing — many list pages filter both, currently served by bitmap-AND. `drug_alternatives.is_approved` not indexed. `supplier_inventory` has no shown indexes despite drug + country filters.

**Findings.**

#### 🟠 FINDING-P5-01 — 45/49 API routes are `force-dynamic` with no edge caching
- **Artifact:** 45 of 49 files under `frontend/app/api/*` set `export const dynamic = "force-dynamic"`.
- **Issue:** Public read-only endpoints (`predictive-signals`, `regulatory-calendar`, `freshness`, `suppliers/directory`, `market-data`) change at most hourly but re-run full query (and sometimes 30k-row aggregation) every request. No `Cache-Control: s-maxage`, no `revalidate` on most.
- **Risk:** Cold Supabase round-trips dominate p95 latency; function invocations scale 1:1 with traffic.
- **Remediation:** **M.** Per-route audit. For public reads, switch to `revalidate = N` or `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`. `/api/freshness/route.ts:7` already has the right pattern — copy it.

#### 🟠 FINDING-P5-02 — `/api/predictive-signals` paginates 30k+ rows then aggregates in Node
- **Artifact:** `frontend/app/api/predictive-signals/route.ts:46-58`.
- **Issue:** Pulls every active shortage event in 1000-row chunks, builds JS `Map` to count peer countries per drug.
- **Risk:** Latency grows linearly. Vercel function-timeout risk as dataset grows (currently 21,500 shortages; 100k+ within a year).
- **Remediation:** **M.** Postgres view / RPC doing GROUP BY `drug_id` with `count(distinct country_code)`, filter peer set + `inUserCountry = FALSE` server-side. Add partial index `(status, country_code, drug_id) WHERE status='active'`.

#### 🟡 FINDING-P5-03 — Raw `<img>` tags everywhere, zero `next/image`
- **Artifact:** 9 raw `<img>` in `HomeNavClient.tsx:69`, `chat/components/{ChatMain,Sidebar}.tsx`, `components/{landing-nav,site-footer,landing-page-client}.tsx`, `drugs/[id]/ai-insight-chips.tsx:165`. **Zero `import Image from 'next/image'`**.
- **Risk:** No automatic resize / format / lazy-loading. Logo PNG served 1× to every device. LCP regression.
- **Remediation:** **S.** Convert logo (used everywhere) to `next/image`. SVG would be even better.

#### 🟡 FINDING-P5-04 — Heavy client-only libs may not be lazy-loaded
- **Artifact:** `package.json` includes `d3 ^7.9` (~250 KB), `jspdf + jspdf-autotable` (~450 KB), `xlsx ^0.18.5` (~600 KB), `canvg`, `react-simple-maps`. `bulk-upload.tsx:159` already uses `await import("xlsx")` — good. `d3` and `jspdf` not verified.
- **Remediation:** Run `next build --profile`; convert to `dynamic(() => import(...), { ssr: false })` if not already.

#### 🟡 FINDING-P5-05 — `next.config.ts` has only redirects; no perf knobs
- **Artifact:** `frontend/next.config.ts:1-19`.
- **Issue:** Missing `images.remotePatterns`, `experimental.optimizePackageImports` for `lucide-react`/`@radix-ui`, no `compress` / `poweredByHeader` overrides.
- **Remediation:** **S.** Add `experimental: { optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"] }`.

#### 🟡 FINDING-P5-06 — Missing composite index on common shortage filter combo
- **Artifact:** `supabase/migrations/001_initial_schema.sql:226-235`.
- **Issue:** `(country_code, status)` and `(status, severity)` — both commonly co-filtered, both served by bitmap-AND of single indexes.
- **Remediation:** **S.** `CREATE INDEX idx_shortage_events_country_status ON shortage_events(country_code, status) WHERE status IN ('active','anticipated');` — partial, write-cheap.

---

### 3.6 Pillar 6 — Code Quality & Maintainability · **2.5 / 5**

**Justification.** Reasonable structure (clear `app/`, `lib/`, `backend/scrapers/`, `supabase/migrations/` separation), descriptive commit messages, modern stack (Next 16, React 19, TS 5, Tailwind 4). CLAUDE.md is honest about debt. But: **zero automated tests** outside the chat eval harness, 4 uncommitted files including 2 Supabase migrations, 26+ stale branches, 3 open stashes, a 1,480-line `drugs/[id]/page.tsx` overdue for split, **no root `README.md`**.

**Code footprint.**

| Surface | Files | LOC (approx) | Largest file |
|---|---|---|---|
| `frontend/app` (`.tsx`) | 139 | ~37,000 | `drugs/[id]/page.tsx` — 1,480 lines |
| `frontend/app` (`.ts`) | 60 | route handlers + lib | — |
| `backend/` (`.py`) | 98 | ~29,600 | `scrapers/portugal_infarmed_scraper.py` — 1,029 lines |
| `api/` (legacy FastAPI, `.py`) | 11 | 1,697 | `routers/data_quality.py` — 392 lines |
| Supabase migrations | 38 files (gap at 034) | — | — |

Other large frontend files: `ProcurementView.tsx` (964), `SupplierDashboardClient.tsx` (963), `Sidebar.tsx` (957), `SupplierView.tsx` (926), `landing-page-client.tsx` (842), `bulk-upload.tsx` (820), `PharmacistAnswerCard.tsx` (768).

**Findings.**

#### 🔴 FINDING-Q6-01 — Zero automated tests outside the chat eval harness
- **Artifact:** `find` for `*.test.*`, `*.spec.*`, `vitest.config`, `jest.config`, `pytest.ini` = 0 results.
- **Issue:** 49 route handlers, 67 scrapers, 41 migrations, complex persona routing, payment-adjacent supplier flow — none has executable safety net. The recent `712aa22 fix(chat): import missing levelFromScore to unblock Vercel builds` shows builds can break on main with no pre-merge gate.
- **Remediation:** **M.** Vitest minimal: `lib/seo.ts`, `lib/risk-score.ts`, `lib/trade-price.ts`, `lib/demand-signal.ts` (pure functions). Playwright smoke for `/`, `/search?q=amoxicillin`, `/drugs/<stable-id>`. Pytest on `backend/utils/db.py` + 1 regression test per scraper using captured HTML fixtures.

#### 🔴 FINDING-Q6-02 — Uncommitted migration files
- **Artifact:** `supabase/migrations/035_drug_external_ids.sql` and `037_relax_external_id_uniqueness.sql` in `git status`, not in `git log`.
- **Issue:** Either prod has had these applied and the repo lacks source-of-truth, or they're local dev migrations not yet rolled out. Either way the repo no longer matches reality. Cross-ref D1-05.
- **Remediation:** **S.** Diff prod schema against `supabase/migrations/`; reconcile; commit.

#### 🟡 FINDING-Q6-03 — 26+ stale branches on origin
- **Artifact:** `git branch -a` shows ~12 `claude/*` branches (5 are 2–10 weeks old) and ~11 squash-merged `sprint*` branches never deleted.
- **Remediation:** **S.** `git push origin --delete` for every `sprint*` and merged `claude/*`. Enable "auto-delete head branches".

#### 🟡 FINDING-Q6-04 — Largest files have exceeded sane bounds
- **Artifact:** `drugs/[id]/page.tsx` 1480, `ProcurementView.tsx` 964, `SupplierDashboardClient.tsx` 963, `Sidebar.tsx` 957.
- **Remediation:** Split per F4-01.

#### 🟡 FINDING-Q6-05 — SheetJS CE on `^0.18.5` — verify CVE patch
- **Artifact:** `frontend/package.json:35` (`xlsx ^0.18.5`).
- **Issue:** SheetJS CE prior to 0.20.2 has a prototype-pollution + ReDoS advisory (GHSA-4r6h-8v6p-xvw6).
- **Remediation:** **S.** `npm ls xlsx`; pin to 0.20.2+ or switch to official SheetJS CDN tarball / `exceljs`.

#### 🟡 FINDING-Q6-06 — No root `README.md`
- **Artifact:** Repo root has `CLAUDE.md` + `SOFT_LAUNCH.md`, no `README.md`. `frontend/README.md` is the Next default.
- **Remediation:** **S.** 50-line root README pointing to CLAUDE.md + bootstrap commands.

#### 🟡 FINDING-Q6-07 — Legacy `api/` FastAPI still in tree, not on critical path
- **Artifact:** `api/main.py` + 11 router files, 1,697 LOC.
- **Issue:** Still mounted in `nixpacks.toml` / Railway. Risk: someone calls it thinking it's the canonical API and gets stale logic.
- **Remediation:** **S.** Delete or rename `legacy_api/` + per-file header docstring.

---

### 3.7 Pillar 7 — Security & Compliance · **2.5 / 5**

**Justification.** Hard, deliberate work on RLS done (every public table has explicit policy; migrations 028–030 demonstrate awareness of column-level GRANT attacks; the `WITH CHECK` fix shows operator-level understanding). Secret hygiene in tracked source is clean. **But** this is undercut by three concrete leaks: a live GitHub PAT in `.git/config`, two unauthenticated `/admin/*` pages, and a complete absence of HTTP security headers. Auth flows are mostly correct — server callback validates redirects — but client-side `router.push(next)` mirror-images the safe path with no validation. Net: **foundation good, perimeter has gaps**.

**RLS coverage matrix (summary).** ~42 tables confirmed RLS-on with explicit policies (full table in Appendix §9.1). 4 tables in CLAUDE.md couldn't be tied to an explicit `ENABLE ROW LEVEL SECURITY` line in migration grep — `drug_catalogue`, `drug_universe`, `live_status_layer`, `ai_insights_cache`. **Needs runtime check** via `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`.

**Secret hygiene findings.** Git history is clean of `.env` files; `.gitignore` covers `.env, .env.*, *.env, credentials*.json, secrets.json, *.pem, *.key`. No JWTs / `ghp_` / `sk-ant-` in tracked source. **One serious leak:** `.git/config:13` has a plaintext PAT in the remote URL.

**Findings.**

#### 🔴 FINDING-S7-01 — Live GitHub PAT in `.git/config` remote URL
- **Artifact:** `/Users/findlaysingapore/mederti/.git/config:13`.
- **Issue:** Plaintext PAT `ghp_…` embedded in `[remote "origin"] url = https://x-access-token:ghp_…@github.com/mederti/mederti.git`. Local-only file (not in any git tree), but it grants write access to the private repo.
- **Risk:** Any process with read on this file (malware, backup tooling, dev-container snapshot, accidental `cat .git/config` in screencast) exfiltrates the token. Push access → commit forgery to `main` → downstream Vercel deploy.
- **Remediation:** **S, urgent.** (1) Revoke at github.com/settings/tokens. (2) `git remote set-url origin git@github.com:mederti/mederti.git` (SSH) OR `git remote set-url origin https://github.com/mederti/mederti.git` (let `gh` credential helper handle auth out-of-band). (3) Audit other repos: `find ~ -name config -path '*/.git/*' -exec grep -l 'x-access-token' {} \;`.

#### 🟠 FINDING-S7-02 — Two `/admin/*` pages bypass `requireAdmin`
- **Artifact:** `frontend/app/admin/data-sources/page.tsx` (no `requireAdmin`); `frontend/app/admin/naming-graph/page.tsx:18-19` (explicit comment: *"Public route under /admin/* but does no auth check"*).
- **Issue:** Both call `getSupabaseAdmin()` and render results. Middleware requires *some* signed-in user for `/admin/*` but doesn't check `is_admin`. Any signed-up user can browse to `/admin/data-sources` and see internal scraper health (regulator IDs, last_scraped_at, internal source naming) and `/admin/naming-graph` to probe drug-resolution internals.
- **Risk:** Information disclosure of internal ops metadata. Naming-graph also lets non-admins issue drug-resolution queries that hit `getSupabaseAdmin` (service-role) under the hood — bypass rate limits or expensive joins.
- **Remediation:** **S, this sprint.** Add `const ctx = await requireAdmin(); if (!ctx) notFound();` at the top of both. Two-line fix per file.

#### 🟠 FINDING-S7-03 — Open-redirect via client-side `router.push(next)` and `emailRedirectTo`
- **Artifact:** `frontend/app/(auth)/login/page.tsx:15, 40-52, 62`; `signup/page.tsx:15, 45`.
- **Issue:** `next` taken straight from `searchParams.get("next")` with no validation. `router.push("//evil.com/path")` and `${window.location.origin}//evil.com/path` (browser normalizes) both navigate offsite. Server callback (`auth/callback/route.ts`) has the right `safeNext()` validator — client paths skipped it.
- **Risk:** Phishing — `https://mederti.vercel.app/login?next=//evil.com`. User signs in, gets redirected to evil.com after a believable Mederti experience. Magic-link variant is worse: redirect baked into the email Supabase delivers.
- **Remediation:** **S, this sprint.** Extract `safeNext` to `lib/auth/safe-next.ts`; call from every `next` consumer. Same fix in login + signup pages.

#### 🟡 FINDING-S7-04 — No HTTP security headers
- **Artifact:** `frontend/next.config.ts` (no `headers()`), `frontend/vercel.json` (no headers block).
- **Issue:** CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy all absent. HSTS exists by Vercel default on `*.vercel.app` but not asserted (won't survive a custom domain).
- **Risk:** Clickjacking on `/account`, `/supplier-dashboard`, `/admin/*`; MIME-sniffing; referer leakage; no defense in depth if future XSS appears.
- **Remediation:** **M.** Add `headers()` to `next.config.ts`: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. CSP can start in report-only.

#### 🟡 FINDING-S7-05 — Contact email built with unescaped user input
- **Artifact:** `frontend/app/api/contact/route.ts:30-36`.
- **Issue:** `${name.trim()}`, `${subject?.trim()}`, `${message.trim().replace(/\n/g, "<br>")}` interpolated into HTML email body. Recipient is internal (`hello@mederti.com`) but malicious payload can inject `<a href>`, hidden tracking, weaponize inbox preview.
- **Remediation:** **S.** HTML-escape helper or send as plain text.

#### 🟡 FINDING-S7-06 — 4 tables in CLAUDE.md not provably RLS-on from migrations
- **Artifact:** `drug_catalogue`, `drug_universe`, `drug_universe_multi_country`, `live_status_layer`, `ai_insights_cache`.
- **Risk:** If RLS off + anon has default GRANTs, PostgREST exposes them. Migration 029 demonstrates this exact failure mode happened before.
- **Remediation:** **S.** Run verification SQL from 029's footer; add follow-up migration for any returning `rowsecurity = false`.

#### 🟢 FINDING-S7-07 — In-memory per-IP rate limit doesn't survive cold starts / region splits
- **Artifact:** `frontend/lib/chat/rate-limit.ts:5-23`. (Same as B3-04.)
- **Remediation:** **M, when chat traffic justifies.** Upstash Redis or Supabase-backed token bucket; add per-user limit once chat requires auth.

#### ⚠ FINDING-S7-08 — `[defender "bypass"]` section in `.git/config`
- **Artifact:** `/Users/findlaysingapore/mederti/.git/config:18`.
- **Issue:** Likely a GitHub Advanced Security secret-scanning bypass marker. Worth understanding what it bypasses (push-protection?). If it's bypassing secret-push protection, that may be how the PAT-in-URL got normalized.
- **Remediation:** **S, investigate.** `gh api repos/mederti/mederti/secret-scanning/alerts`; remove bypass if vestigial.

**IP / copyright posture.** Explicit and reasonable. `terms/page.tsx` §5 draws the right line: regulator raw data is public domain, Mederti's normalisation/enrichment/presentation is proprietary; §3 explicitly prohibits scraping/reverse-engineering/bulk-export. §2 has "not for clinical decision-making" disclaimer. **No `LICENSE` file at repo root** — fine for private SaaS, but worth a one-line note that the code is unlicensed/all-rights-reserved if any contractor touches the repo.

**AWS IP clause status.** **Undocumented.** No mention of "AWS" / "Amazon" / "employer assignment" / "IP clause" in `docs/`, `SOFT_LAUNCH.md`, `CLAUDE.md`, or any tracked source. **Most important governance gap in the audit.** Given Rob's day-job at AWS, every commit is arguably subject to AWS's assignment language. Needs a separate `docs/ip-position.md` describing (a) the employment IP-assignment clause text, (b) the carve-out or written waiver covering Mederti, (c) dates and signatories.

---

### 3.8 Pillar 8 — UI/UX & Design System · **1.0 / 5**

**Justification.** There's a clear visual vibe — slate-on-white with severity colour ramps and a single navy hero band — but the implementation is the opposite of a design system. **3,172 inline `style={{...}}` literals**, **727 raw `#hexcode` strings**, and Tailwind 4 installed (`tailwindcss`, `@tailwindcss/postcss`, shadcn `components.json`) but practically unused (**3 responsive variants in the entire app**). A shadcn baseline was scaffolded then the team built everything in `<div style={{...}}>`. Tokens partially exist as CSS custom properties (`--crit`, `--high`, `--app-bg`, etc.) and are reasonably reused via `var(--…)`, so the colour palette has some consistency — but typography, spacing, radius, motion are per-block bespoke. Persona landing pages share `PersonaPage` but have no parity with the in-product persona experience.

**Design token inventory.**

- **Mederti tokens (used):** `globals.css:130-168` — 35 CSS custom properties. Navy palette, text scale, severity ramps + `-bg` + `-b`, teal action color, indigo accent, app surfaces.
- **shadcn/Tailwind tokens (defined, barely used):** Same file lines 7–117 — full second token system in `oklch(…)`. Dark mode variant. None visibly consumed by app code.
- **Hard-coded:** **727 `#hexcode` literals** in `frontend/app` + `frontend/lib`.
- **Spacing/radius/typography:** No tokens — integer literals per component.

**Per-persona conversion paths.**

| Persona | Landing | Primary CTA | Break point? |
|---|---|---|---|
| Pharmacist | `/pharmacists` (`PersonaPage`) | "Start for free" → `/signup` | Default persona view on `/drugs/[id]` is `supplier`, not `pharmacist` (UX-04) |
| Doctor | `/doctors` (`PersonaPage`) | "Start for free" → `/signup` | `personaFromRole()` has no `doctor` case → falls through to `supplier` default. **Broken.** |
| Hospital | `/hospitals` (`PersonaPage`) | "Book a demo" → `/contact` | Demo path is a contact form, no booking calendar |
| Government | `/government` (`PersonaPage`) | "Talk to us" → `/contact` | No dedicated government dashboard; role maps to `procurement` |
| Supplier | `/suppliers` (`PersonaPage`) | "List your stock free" → `/signup?role=supplier&next=/supplier-dashboard/onboarding` | **Best-built path.** 8 sub-pages |

**Findings.**

#### 🔴 FINDING-UX-01 — Tailwind 4 installed and ignored; the app is inline-styled
- **Artifact:** `frontend/package.json` (`tailwindcss: ^4`, `@tailwindcss/postcss`), `globals.css:1-3` (full shadcn theme imported), **3,172 inline `style={{}}` occurrences vs 3 Tailwind responsive variants** (`md:grid-cols-4`, two `sm:inline-flex`).
- **Issue:** Team is paying the cost of Tailwind (build, CSS-in-JS-by-Tailwind tokens unused, full `@theme inline` block) while getting none of the benefit (utilities, responsive variants, hover/focus, dark mode).
- **Risk:** Every UI change is hand-crafted; no shared focus-ring, no hover convention, no centralised dark mode. Accessibility primitives don't come for free.
- **Remediation:** **L.** **Decision required (open #2).** Either commit (build a `lib/ui/` `<Button />`/`<Card />`/`<Badge />` library on Tailwind + shadcn) or remove Tailwind. Current state is worst-of-both.

#### 🔴 FINDING-UX-02 — Mobile execution is media-query-in-`<style>`-tag, not mobile-first
- **Artifact:** `frontend/app/page.tsx:96-112`, `drugs/[id]/page.tsx:917-935`, `:826-832`.
- **Issue:** Three highest-traffic routes implement mobile by injecting `<style>{`@media (max-width:768px) { … !important }`}</style>` blocks next to desktop JSX. PLUS a UA-sniffed branch in middleware that returns a different React tree (`MobileHome`, `MobileDrugPage`, `MobileSupplierPage`). Of 88 client components: 3 use Tailwind responsive variants.
- **Risk:** Mobile rendering hidden behind UA strings (breaks tablets, breaks resized desktop), `!important` chains accumulate, entire drug page duplicated for mobile.
- **Remediation:** **L.** Adopt Tailwind responsive utilities; delete `MobileHome`/`MobileDrugPage`/`MobileSupplierPage` and `BottomNav`; drive layout off CSS not UA.

#### 🔴 FINDING-UX-03 — 727 hard-coded `#hex` values
- **Artifact:** Repo-wide grep `#[0-9a-fA-F]{6}` returns 727 in `frontend/app` + `frontend/lib`.
- **Issue:** Brand colour drift. Example: `--teal` is set to `#0F172A` (slate-900, **not teal**) in `globals.css:140`, while the pharmacist-view mockup `mockups/mederti-pharmacist-view_7.html:19` defines `--teal: #0d9488` (actual teal). Production `/drugs/[id]` renders monochrome slate; reference design is teal-accented.
- **Risk:** Brand inconsistency already drifting from spec; no theming hook; hostile to design QA.
- **Remediation:** **M.** Audit token names vs values; replace inline hex with tokens; promote `var(--…)` discipline.

#### 🟠 FINDING-UX-04 — Persona-routing default is "supplier" even for unknown / doctor roles
- **Artifact:** `frontend/app/drugs/[id]/page.tsx:53-59`.
- **Issue:** `resolvePersona()` defaults to `"supplier"` when role missing/unknown. `personaFromRole()` returns `null` for `doctor` → signed-in doctor sees the supplier (F bento) view. `/doctors` marketing promises "shortage alerts before you prescribe" — they land in a market-scan dashboard.
- **Risk:** Persona promise broken silently. Conversion from `/doctors` likely poor.
- **Remediation:** **S.** Map `doctor` → `pharmacist`. Default for unknown should be `pharmacist`, not `supplier` (CLAUDE.md positions pharmacist as the "radical simplification" view — better fallback).

#### 🟠 FINDING-UX-05 — Accessibility primitives essentially absent
- **Artifact:** Repo-wide grep across `frontend/app/**/*.tsx`: 28 `aria-label`, 1 `aria-labelledby`, 0 `aria-describedby`, 9 `aria-hidden`, 15 `role=`.
- **Issue:** ~5,000 elements; <60 ARIA attributes. No `<label htmlFor>` audit. No visible focus-ring (inline styles don't include `:focus-visible`). Severity colour chips communicate state with colour-only.
- **Risk:** Fails WCAG AA. Specifically blocks government / hospital procurement procurement where a11y is a hard requirement.
- **Remediation:** **M.** **Needs runtime check** (axe/Lighthouse). Quick wins: `aria-label` on icon-only buttons (lucide used in 51 files); `<label>` on every input in `bulk-upload.tsx`, `email-capture.tsx`, `OAuthButtons.tsx`; focus ring on button helpers.

#### 🟠 FINDING-UX-06 — Live drug page diverges hard from reference mockup
- **Artifact:** `frontend/mockups/mederti-pharmacist-view_7.html` vs `frontend/app/drugs/[id]/page.tsx` + `PharmacistAnswerCard.tsx`.
- **Issue:** Reference: single-column 1100px page, 14px-radius cards, teal `#0d9488` action accent, clean header with status pill + tags + single right-aligned alert button. Live: two-column shell (25% left rail with `SoWhatInsight` + `AskMedertiCta`, scrollable right column) — completely different IA. Live default for anonymous user is `SupplierView` ("F bento"). `--teal` overridden to slate `#0F172A`. `PharmacistAnswerCard` only renders when `activeShortages.length > 0 && alternatives.length > 0` (line 970) — disappears for many drugs.
- **Risk:** What design approved is not what ships. The single most important page (pharmacist drug detail) doesn't match the spec.
- **Remediation:** **L.** Either ratify the live design as new spec + retire the mockup, or rebuild `/drugs/[id]` pharmacist view to match the reference.

#### 🟡 FINDING-UX-07 — Inline styles + `<style>` blocks for media/keyframes/hover
- **Artifact:** `drugs/[id]/page.tsx:826-832, 917-935`; `page.tsx:96-112`; `error.tsx`, `not-found.tsx`, `PersonaPage`, every persona view.
- **Issue:** ~3,200 inline `style={{}}` plus per-page `<style>` blocks containing `@media`, `@keyframes`, `:hover`. Can't be statically optimised, can't be cached as CSS, no cascade.
- **Remediation:** **L.** Migrate to Tailwind utilities or CSS Modules incrementally.

#### 🟡 FINDING-UX-08 — Two design token systems (shadcn slate vs Mederti navy/teal)
- **Artifact:** `globals.css:50-117` (shadcn `oklch()`) vs `globals.css:130-168` (Mederti hex).
- **Issue:** Both coexist; shadcn set unused by app code; overlapping concepts (`--primary` vs `--teal`, `--card` vs `--panel`, `--border` vs `--app-border`). Dark mode partially defined for shadcn set only.
- **Risk:** Future shadcn component pulls (which `components.json` is set up for) will render in a different palette.
- **Remediation:** **M.** Delete shadcn token block + remove `components.json`, OR remap shadcn vars to Mederti tokens (`--primary: var(--teal)`) so future shadcn pulls render on-brand.

#### 🟢 FINDING-UX-09 — PersonaPage shows fake 5-row "preview" instead of real data
- **Artifact:** `frontend/app/components/persona-page.tsx:30-44`, `pharmacists/page.tsx:50-58`.
- **Issue:** Each persona landing shows fake screenshot built from `previewRows` (e.g. "Amoxicillin 500mg — Critical"). Live data is right there.
- **Risk:** Demonstrates product looks like a static mockup, not a real-time intelligence platform. Trust hit.
- **Remediation:** **S.** Server-render with 5-row pull of "top critical shortages now" from `shortage_events`.

#### 🟢 FINDING-UX-10 — `error.tsx` and `not-found.tsx` are the only error surfaces
- **Artifact:** `frontend/app/error.tsx`, `not-found.tsx`.
- **Issue:** No per-route error boundaries. 1,480-line drug page swallows every Supabase failure into a generic "Drug not found" — technically 200 OK with HTML error state. Bad for SEO + diagnostics.
- **Remediation:** **S.** Per-route `error.tsx` at `/drugs/[id]`, `/chat`, `/intelligence`. For the not-found path in `drugs/[id]/page.tsx`, call `notFound()` from `next/navigation` so Next returns a real 404.

---

### 3.9 Pillar 9 — AI / LLM Layer · **4.5 / 5**

**Justification.** Deepest part of the codebase. **30 typed tools** (full inventory in Appendix §9.5), all DB-backed except `web_search` and `query_intelligence_sources`. System prompt at `frontend/lib/chat/system-prompt.ts` is **417 lines** of structured, versioned-in-git guidance: 5 canonical refusal shapes + 9 question-specific refusal templates + confidence calibration rules + JTBD persona shaping + output-shape conventions + explicit anti-patterns. `confidence.ts` is a clean rules-based scorer (`levelFromScore`, `confidenceFromSources`) used by 30+ tool sites. Citation infrastructure round-trips end-to-end: tool → `sources_consulted` → `<sources>` tag → `parser.tsx` renders `SourceChip`. Refusal envelopes (`status: "unanswerable"`) appear 34 times. 150-question eval harness with rubric + deterministic + judge graders exists. **Gaps:** no eval CI is actually live, no token-cost dashboard, no per-tool observability beyond one `console.log`, and the 4 ancillary AI surfaces (`chip-answer`, `daily-question`, `so-what`, `intelligence/briefing`) each use Sonnet 4 with inline prompts and no eval coverage.

**Prompt + tool inventory.**

| Surface | Prompt location | Tools | Citation render? | Fallback? |
|---|---|---|---|---|
| `/api/chat` | `lib/chat/system-prompt.ts` (`SYSTEM_PROMPT`, 417 lines, ephemeral cache) | **30** (28 DB + `web_search` + `query_intelligence_sources`) | Yes — `<sources>` parsed in `parser.tsx:62-228` → `SourceChip` | Yes — `fallbackDrugLookup` (`route.ts:238-305`) does 1 DB search + drug card |
| `/api/chip-answer` | Inline `buildSystemPrompt` (`route.ts:30-64`) | 0 (text-only stream) | No | Yes — `generateFallback` keyword-matches |
| `/api/daily-question` | Inline (`route.ts:27-40`) | 1 (`web_search`) | No | Yes — hardcoded `FALLBACK_QUESTION` |
| `/api/drugs/[id]/so-what` | Inline (`route.ts:142-160`) | 0 | No (structured JSON) | No — 503 when no key |
| `/api/intelligence/briefing` | Inline | 0 | No | 6h cache; no graceful no-key path observed |
| `/api/detect-columns` | Dynamic import | 0 | No | n/a |
| `lib/ai/supplier-insights.ts` (3 routes consume) | `STRATEGIST_PERSONA` exported + per-route | 0 | No | Cache-only fallback |

**Models in use:** `/api/chat` uses `claude-opus-4-7` (override via `ANTHROPIC_MODEL`); all 5 ancillary surfaces hardcode `claude-sonnet-4-20250514`. **CLAUDE.md says `claude-sonnet-4-6`** — stale, needs update.

**Findings.**

#### 🟠 FINDING-AI-01 — Eval CI workflow documented but not committed; no live regression gate
- **Artifact:** `evals/CI-WORKFLOW.md` (manual install required), absence of `.github/workflows/`.
- **Issue:** `CI-WORKFLOW.md` is explicit: *"The CI plumbing for this eval suite is intentionally **not committed** in this PR. GitHub PATs without the `workflow` scope can't push files under `.github/workflows/`..."* There is no `.github/workflows/` at all. Commit `8850c8f`'s claim that the eval is "CI-wired" is aspirational.
- **Risk:** A future PR that breaks the system prompt, removes a refusal template, or regresses tool confidence will merge silently. The harness's whole point — preventing the 12 known ⚠ hallucination paths from regressing — is unenforced.
- **Remediation:** **S.** Commit `.github/workflows/eval-coverage.yml` (template at `evals/CI-WORKFLOW.md.template`); use PAT with `workflow` scope or Rob commits by hand. Set `ANTHROPIC_API_KEY` secret. Wire `MEDERTI_CHAT_URL` to Vercel preview URL. Start with `--no-judge` on PRs (deterministic only is free); nightly judge runs against prod.

#### 🟠 FINDING-AI-02 — Cost / latency / token observability is one `console.log` — no dashboard, no per-tool breakdown
- **Artifact:** `frontend/app/api/chat/route.ts:184-186`.
- **Issue:** Only telemetry is `console.log(`[chat] ip=${ip} model=${MODEL} tool_calls=${toolCalls} in=${usage?.input_tokens} out=${usage?.output_tokens} truncated=${truncated}`)`. Vercel logs only. No structured logging, no Anthropic usage rollup, no per-tool latency, no cost per question. With `MAX_OUTPUT_TOKENS=16384` + adaptive extended thinking + 12 tool-call budget, a single chat turn can easily exceed $1. None of the 5 ancillary surfaces log token usage at all.
- **Risk:** A prompt or tool regression that doubles average input tokens (unbounded tool result, system-prompt expansion) goes unnoticed until the Anthropic bill arrives. Free-tier traffic × surprise.
- **Remediation:** **S.** Pipe `usage.input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` into a Supabase `ai_request_log` table on every chat call. Add `/admin/ai-spend`. Same for the 5 ancillary surfaces.

#### 🟡 FINDING-AI-03 — Four ancillary AI surfaces use inline prompts not covered by the eval harness
- **Artifact:** `chip-answer/route.ts:30-64`, `daily-question/route.ts:27-40`, `drugs/[id]/so-what/route.ts:142-160`, `intelligence/briefing/route.ts`, plus `lib/ai/supplier-insights.ts` (3 consumers).
- **Issue:** Each has its own short inline prompt with its own house-style rules. None uses the chat's tool surface or refusal-template guidance. Eval harness exclusively covers `/api/chat`.
- **Risk:** Drug detail pages, daily question, public intelligence briefing all use Claude with no quality gate.
- **Remediation:** **M.** (a) Consolidate by routing through `/api/chat`'s tool layer, OR (b) add eval coverage per surface: 5–10 questions with a deterministic grader checking surface-specific contract (e.g. `so-what` returns valid JSON; `daily-question` returns ≤20 words).

#### 🟡 FINDING-AI-04 — Two model identifiers in use; CLAUDE.md is stale
- **Artifact:** `chat/route.ts:14` (`claude-opus-4-7`), `chip-answer/route.ts:104`, `daily-question/route.ts:19`, `intelligence/briefing/route.ts:8`, `drugs/[id]/so-what/route.ts:7`, `lib/ai/supplier-insights.ts:14` (all `claude-sonnet-4-20250514`).
- **Issue:** CLAUDE.md says `claude-sonnet-4-6` in `/api/chat`. Reality: Opus 4.7. Cost projection drift (Opus ~5× Sonnet input cost; with `effort: "high"` + extended thinking, the gap is real).
- **Remediation:** **S.** Update CLAUDE.md. Consider whether all Sonnet calls would benefit from Haiku to halve cost (most are tightly-structured short outputs).

#### 🟡 FINDING-AI-05 — Hardcoded model strings; no central config
- **Artifact:** 5 files hardcode `claude-sonnet-4-20250514`. Only `/api/chat` reads `process.env.ANTHROPIC_MODEL`.
- **Risk:** When Anthropic deprecates the snapshot ID, the 5 routes 400 with no graceful path.
- **Remediation:** **S.** `lib/ai/models.ts` exporting `CHAT_MODEL`, `INSIGHT_MODEL`, `EDITORIAL_MODEL`, each `process.env.X ?? "<default>"`.

#### 🟢 FINDING-AI-06 — Prompt versioning is "in git" but no version stamp emitted with answer
- **Artifact:** `lib/chat/system-prompt.ts` is git-tracked + `cache_control: ephemeral` (`route.ts:99`), but response doesn't carry prompt version / commit SHA back to client.
- **Risk:** When eval report regresses, you have to git-bisect.
- **Remediation:** **S.** Add `SYSTEM_PROMPT_VERSION = "2026-05-26.2"` constant; include in `console.log` and eval report metadata.

#### 🟢 FINDING-AI-07 — Daily question runs Sonnet + web_search every cache miss; no rate limit
- **Artifact:** `frontend/app/api/daily-question/route.ts:68-80`.
- **Issue:** Cached 24h via `unstable_cache`; cache bypass possible by hitting different Vercel region.
- **Remediation:** **S.** Apply shared rate-limiter (per B3-04); or pre-compute the daily question via Vercel cron and store in Supabase, eliminating user-triggered generation.

**Hallucination guardrail verdict.** **Strong, well-engineered, gated by an eval suite that isn't yet a CI gate.** 34 `status: "unanswerable"` returns in tools, 14 named refusal paths in the system prompt, all 12 known ⚠ paths covered by `scripts/test_refusal_templates.mjs`. The gap is enforcement (CI), not design.

**Cost / latency observability.** **Absent.** A `lib/ai/usage-log.ts` helper writing `(route, model, usage, latency_ms, tool_calls, user_id?)` into `ai_request_log` would unblock the next 80% with one PR.

---

### 3.10 Pillar 10 — Observability, SEO & Product Readiness · **3.0 / 5**

**Justification.** SEO infrastructure is **genuinely excellent**: proper `robots.ts` with explicit AI-crawler allow list (GPTBot, ClaudeBot, PerplexityBot, GoogleOther, Bingbot), dynamic sitemap with 5,500 drug page cap, schema.org `Drug` + `BreadcrumbList` JSON-LD on drug pages, dynamic OG via `/api/og`, `llms.txt` in public, per-page `generateMetadata` on SEO-critical routes. Vercel Analytics + Speed Insights are live (`layout.tsx:3-4, 64-65`). Custom `demand_signals` table (migration 041) is a first-party event store. **But:** no Sentry / error tracking of any kind; no uptime monitor in-repo; no `.github/workflows/`; 51 raw `console.*` calls in `frontend/app/api` disappear into Vercel log retention.

**Observability inventory.**

| Layer | Tool | Status |
|---|---|---|
| Error tracking (frontend) | Sentry / Bugsnag / Logtail | **Not configured** |
| Error tracking (backend) | — | **Not configured** — `backend/utils/logger.py` writes structured JSON to stdout only |
| Performance | `@vercel/speed-insights/next` | **Live** |
| Web analytics | `@vercel/analytics/next` | **Live** |
| Custom event store | `demand_signals` + `recordDemandSignal()` | **Live** — wired into 2 routes (search + drug_view); claim of "4 routes" needs spot check |
| Uptime monitoring | Better Stack / UptimeRobot | Not in repo — **needs runtime check** |
| CI | GitHub Actions | No `.github/workflows/` |
| Structured logging (server) | None for Next routes; Python has proper JSON logger | 51 `console.*` calls under `frontend/app/api/`; 9 under `frontend/lib/` |
| Request timing | Custom `lib/server-timing.ts` → `Server-Timing` header | **Live** on `/api/search`, `/api/drug-autocomplete` |

**SEO inventory.**

| Asset | File | Status |
|---|---|---|
| robots.txt | `frontend/app/robots.ts` | Present — explicit AI-crawler allow; disallows `/api/`, `/admin/`, `/account`, `/watchlist`, `/onboarding`, `/auth`, `/coming-soon` |
| sitemap.xml | `frontend/app/sitemap.ts` | Present — up to 5,000 drug pages + 500 intelligence articles + 16 static, 1h ISR |
| llms.txt | `frontend/public/llms.txt` | Present, well-structured, lists 22 countries + sources + key paths |
| JSON-LD (Drug) | `frontend/app/drugs/[id]/page.tsx:823, 902` via `lib/seo.ts drugJsonLd()` | Present — `Drug` + `WebPage` + `MedicalCondition` graph + `BreadcrumbList` |
| JSON-LD (other pages) | — | **Missing on** `/`, `/search`, `/intelligence`, persona pages. Could add `Organization`, `BreadcrumbList`, `FAQPage`, `MedicalWebPage`. |
| OG meta (root) | `frontend/app/layout.tsx:31-46` | Present — Twitter card + dynamic OG via `/api/og` |
| OG meta (drug page) | `drugs/[id]/page.tsx:62 generateMetadata` | Present, dynamic |
| OG meta (other pages) | 10 of ~25 have it | `/search`, `/recalls`, `/shortages`, `/account`, `/contact`, `/government`, `/doctors`, `/suppliers`, `/coming-soon` inherit root only |
| Canonical URLs | `lib/seo.ts canonicalUrl()` helper exists | Verify usage per page — **needs spot check** |
| Dynamic OG image | `/api/og/route.tsx`, `/api/og/drug/[id]/route.tsx` | Present on edge runtime |

**Analytics event inventory.**

**Fired:** page views (Vercel Analytics, auto), Core Web Vitals (Speed Insights, auto), `demand_signals` rows for `signal_type: 'search'` + `'drug_view'`.

**Missing:** signup/login completion, onboarding step progression + drop-off, `supplier-enquiry` submission (B2B conversion event), `subscribe` email signup, `bulk-lookup` usage (institutional value indicator), chat message sent / tool invoked separately from demand_signals, watchlist add / alert subscribe, "Ask Mederti" CTA clicks, persona switch (`?as=…`), outbound clicks on regulator source URLs (credibility signal).

**Findings.**

#### 🔴 FINDING-O10-01 — No error tracking — silent failures will bite at launch
- **Artifact:** Grep for `Sentry|@sentry|posthog|logtail|datadog|bugsnag` across `frontend/`, `backend/`, `api/` returns nothing. 51 `console.error/warn` go to Vercel function logs only (24h–7d retention).
- **Risk:** Chat timeouts (300s budget), RLS policy denials, scraper insert failures — none alert. Mederti is positioned for institutional buyers; silent outages at this tier are credibility-killers.
- **Remediation:** **S.** `npx @sentry/wizard@latest -i nextjs` (~20 min); set DSN; enable source-map upload in Vercel. Mirror to Python scrapers via `sentry-sdk`.

#### 🟠 FINDING-O10-02 — No CI workflows in repo
- **Artifact:** No `.github/workflows/`. `evals/CI-WORKFLOW.md.template` is a template.
- **Issue:** Deploys to Vercel happen on push but no PR-gate for lint, build, or evals. Commit `712aa22 fix(chat): import missing levelFromScore` is evidence a build broke on main.
- **Remediation:** **S.** `.github/workflows/ci.yml` running `npm ci && npm run lint && npm run build` on PR + push to main. Eval harness nightly. Cross-ref AI-01.

#### 🟠 FINDING-O10-03 — No uptime monitor visible in repo
- **Artifact:** No Better Stack / UptimeRobot / Pingdom / Checkly references anywhere.
- **Issue:** Vercel doesn't notify on 500s from `/api/search`; only on deploy failures.
- **Remediation:** **S.** Better Stack (free 10 monitors) on `/`, `/api/search?q=amoxicillin`, `/api/freshness`, `/drugs/<known-good-id>`. **Needs runtime check** — may already exist out-of-repo.

#### 🟠 FINDING-O10-04 — Conversion-funnel analytics gaps
- **Artifact:** `recordDemandSignal()` only fires on search + drug_view.
- **Issue:** Can't answer "search → drug-view → supplier-enquiry conversion rate" — the question every B2B SaaS investor asks.
- **Remediation:** **M.** Extend `recordDemandSignal()` with `signal_type: 'enquiry' | 'subscribe' | 'signup' | 'onboarding_step'` wired into those routes. Or add PostHog (free up to 1M events/mo).

#### 🟡 FINDING-O10-05 — Most pages lack OG metadata + per-page canonical
- **Artifact:** 10 of ~25 pages have `generateMetadata`. `/search`, `/recalls`, `/shortages`, `/account`, `/contact`, `/government`, `/doctors`, `/suppliers` inherit root only.
- **Remediation:** **S.** Add `title` + `description` per page; use `alternates.canonical`.

#### 🟡 FINDING-O10-06 — JSON-LD only on drug + supplier pages
- **Artifact:** Found in `drugs/[id]/page.tsx` and `suppliers/[slug]/page.tsx` only.
- **Issue:** Missing `Organization` on `/`, `FAQPage` on `/about` or `/pricing`, `BreadcrumbList` outside drug page, `Dataset` on `/shortages` (genuinely useful for **Google Dataset Search** — a credibility moat for "world's leading source" positioning).
- **Remediation:** **S.** Add `Organization` to layout, `Dataset` to `/shortages` and `/recalls`.

#### 🟡 FINDING-O10-07 — `console.log` is the de-facto logger
- **Artifact:** 51 `console.*` under `frontend/app/api`, 9 under `frontend/lib/`. No `pino` / `winston`.
- **Issue:** No correlation IDs, log levels, structured fields — Vercel log search becomes string-grep.
- **Remediation:** **S.** Add `pino` (after Sentry); wrap in `lib/logger.ts` so the next refactor is one file.

#### 🟡 FINDING-O10-08 — SOFT_LAUNCH env flag has no runtime verification surface
- **Artifact:** `SOFT_LAUNCH.md` documents `NEXT_PUBLIC_SOFT_LAUNCH=true` toggles 308 redirects on most pages.
- **Issue:** No way to see at-a-glance whether live deploy is in soft-launch mode.
- **Remediation:** **S.** `X-Mederti-Launch-Mode` response header from middleware, or non-indexed `/api/_status` returning `{ mode, commit_sha, build_time }`.

---

## 4. Cross-pillar themes

These are findings that recur across multiple pillars — fixing the underlying cause moves several scores at once.

### Theme A — "Silent failures everywhere": no error tracking, no test gates, scrapers fail without alerting, audit logs not actually immutable
Affected: P2 (D2-02, D2-11), P6 (Q6-01), P9 (AI-02), P10 (O10-01, O10-02, O10-03). The whole observability stack is one Sentry install + one CI workflow + one logrotate config away from being **noisy** rather than **silent**. The current state is the worst possible for an institutional product: things break and nobody knows.

### Theme B — "Half-done migrations" — Mac→Railway scrapers, FastAPI→Next.js APIs, shadcn→inline-styles
Affected: P2 (D2-01), P3 (B3-02), P4 (F4-03, F4-05, F4-11), P8 (UX-01, UX-08). Three big architectural moves were started and not finished. Each leaves dead code, duplicate logic, and decision paralysis. The pattern matters: Rob is great at starting; the org needs a discipline of *finishing* (delete the loser) before moving on.

### Theme C — Citation/provenance chain breaks at the same 3 places across pillars
Affected: P1 (D1-01, D1-07, D1-12), P2 (D2-11), P9 (AI guardrail depends on it). The 8 non-shortage scrapers skip the heartbeat, recalls use a different FK column name, and `drug_alternatives` lacks per-row URLs. The chat's strict citation discipline (and the `/freshness` dashboard credibility tile) is silently undermined by these.

### Theme D — Three drug-entity tables × auto-create-drug fallback = entity fragmentation
Affected: P1 (D1-03, D1-08), P3 (B3-07 — schema-drift fallback dance), P9 (chat tools have to manage this). The chat already has a "wide select failed, retry without 035 columns" handler to cope. Until canonical entity is decided and a dedupe pipeline runs, every new scraper compounds the fragmentation.

### Theme E — UI/design system absence cascades into every UX finding and several frontend ones
Affected: P4 (F4-01, F4-02), P8 (UX-01 through UX-08), and indirectly P5 (no `next/image` because raw `<img>` is the convention), P10 (most pages lack OG because each page is bespoke). Either commit to Tailwind+shadcn with discipline or pick a different system — the current state of "Tailwind installed, then ignored" is unique to no design culture.

### Theme F — Security is "RLS done well, perimeter neglected"
Affected: P3 (B3-01, B3-04), P7 (S7-01, S7-02, S7-03, S7-04). Database access is well-guarded; the HTTP perimeter is not. This pattern is common in Supabase-first apps where the team thinks "RLS = secure" — but auth bypasses, header omissions, and open-redirects live above the DB.

---

## 5. Risk register

All 🔴 and 🟠 items, sorted by severity then likelihood.

| ID | Pillar | Description | Severity | Likelihood | Blast radius | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| S7-01 | 7 | Live GitHub PAT in `.git/config` | 🔴 | Medium | Repo write access → `main` forgery → Vercel deploy | Rotate + switch to SSH | Rob | Open |
| D2-01 | 2 | 5 parallel cron paths disagree | 🔴 | High | Silent scraper downtime + duplicate DB writes | Pick one runtime; delete others | Rob | Open |
| D2-02 | 2 | Railway runners misreport record counts as 0 | 🔴 | Certain | Operators can't read logs | 1-line typo fix | Rob | Open |
| D2-03 | 2 | `cron.log` at 537 MB, no rotation | 🔴 | Certain | Disk fill on laptop; ops blind | logrotate | Rob | Open |
| D1-01 | 1 | 8 non-shortage scrapers bypass heartbeat | 🔴 | Certain | Public freshness dashboard mis-states their state as stale | Extract `_touch_data_source` mixin | Rob | Open |
| D1-02 | 1 | `drug_catalogue` was prod-only for 10 weeks | 🔴 | High | Fresh-clone schema doesn't match prod | `pg_dump` snapshot + CI assert | Rob | Open |
| Q6-01 | 6 | Zero automated tests | 🔴 | High | Any change can break prod silently | Vitest pure-fn + Playwright smoke | Rob | Open |
| Q6-02 | 6 | Uncommitted migrations 035/037 in repo | 🔴 | Certain | Repo doesn't match prod schema | `git add` + commit | Rob | Open |
| O10-01 | 10 | No error tracking | 🔴 | Certain | Silent outages at institutional-buyer tier | Sentry wizard | Rob | Open |
| F4-01 | 4 | 1,480-line god-component `drugs/[id]/page.tsx` | 🔴 | Certain | Multi-hour archaeology per change; bugs in one variant don't surface in others | Split per-render-path | Rob | Open |
| UX-01 | 8 | Tailwind installed and ignored | 🔴 | Certain | No design discipline; every UI change bespoke | Decision: commit or remove | Rob | Open |
| UX-02 | 8 | Mobile via UA-sniff + media-in-style-tag | 🔴 | High | Breaks tablets, resized desktop; entire drug page duplicated | Adopt Tailwind responsive | Rob | Open |
| UX-03 | 8 | 727 hard-coded `#hex`; `--teal` is slate-900 | 🔴 | Certain | Brand drift; reference mockup not on live site | Token audit | Rob | Open |
| B3-01 | 3 | 5 supplier routes leak unauthenticated | 🟠 | Certain | Buyer demand signals + market gaps to anonymous callers | Auth preamble | Rob | Open |
| B3-02 | 3 | Stale `NEXT_PUBLIC_API_URL` + dead FastAPI | 🟠 | Medium | Onboarding friction; schema drift between two API definitions | Delete line 13 + retire `api/` | Rob | Open |
| D1-03 | 1 | Three drug-entity tables, no canonical | 🟠 | High | Answer divergence between routes | Decision: pick canonical | Rob | Open |
| D1-04 | 1 | Two competing status enums | 🟠 | Medium | Cross-table joins mix denominators | Retire `drug_availability.status` or unify view | Rob | Open |
| D1-05 | 1 | Migrations 035 + 037 uncommitted | 🟠 | Certain | History incomplete; rollback story broken | Same as Q6-02 | Rob | Open |
| D1-06 | 1 | 6 overlapping timestamp columns on `shortage_events` | 🟠 | Medium | LLM/human can't tell discovered vs reported | COMMENT ON COLUMN | Rob | Open |
| D1-07 | 1 | `source_id` vs `data_source_id` drift | 🟠 | Certain | Every cross-source query special-cases | Generated column or rename | Rob | Open |
| D2-04 | 2 | 7 quarantined scrapers; 4 critical markets silent | 🟠 | Certain | CN/IN/IL/PL/ES/DE/SG coverage gap | Per-scraper fix | Rob | Open |
| D2-05 | 2 | France ANSM is MITM-only | 🟠 | Certain | Pharmacist false negatives | Widen scraper or document scope | Rob | Open |
| D2-06 | 2 | Eligibility scrapers never scheduled | 🟠 | Certain | SSP/s19A/503B data stale immediately | Add to Railway cron | Rob | Open |
| D2-07 | 2 | `recall_linker` only in Mac cron | 🟠 | Medium | Loss of causal recall→shortage edges | Move into Railway recall runner | Rob | Open |
| F4-02 | 4 | Two parallel persona-view component trees | 🟠 | Certain | Designer tweak ships twice or once | One `lib/persona/` library | Rob | Open |
| F4-03 | 4 | Dead components shipping | 🟠 | Certain | Future contributors copy from dead version | Delete | Rob | Open |
| F4-04 | 4 | Soft-launch + ISR + middleware all redirect `/` differently | 🟠 | Medium | Stale stats + caching confusion | Pick one model | Rob | Open |
| F4-05 | 4 | Dead routes `/alerts`, `/watchlist` | 🟠 | Certain | Future contributors edit wrong file | Delete page files | Rob | Open |
| P5-01 | 5 | 45/49 API routes `force-dynamic`, no caching | 🟠 | Certain | Vercel cost + Supabase load scale 1:1 with traffic | Per-route audit | Rob | Open |
| P5-02 | 5 | `/api/predictive-signals` aggregates 30k rows in JS | 🟠 | High | Function timeout risk as data grows | Postgres view / RPC | Rob | Open |
| O10-02 | 10 | No CI workflows in repo | 🟠 | Certain | Broken builds on main; eval not enforced | Add `.github/workflows/ci.yml` | Rob | Open |
| O10-03 | 10 | No uptime monitor in repo | 🟠 | High | 500s go undetected | Better Stack | Rob | Open |
| O10-04 | 10 | Conversion-funnel analytics gaps | 🟠 | Certain | Can't answer the B2B SaaS investor question | Extend `recordDemandSignal()` | Rob | Open |
| AI-01 | 9 | Eval CI not committed | 🟠 | Certain | Refusal templates + tools can regress silently | Commit workflow YAML | Rob | Open |
| AI-02 | 9 | No AI cost/latency observability | 🟠 | Certain | Cost surprise on next bill | `ai_request_log` table | Rob | Open |
| S7-02 | 7 | 2 `/admin/*` pages bypass `requireAdmin` | 🟠 | Certain | Internal ops metadata to any signed-up user | Add `requireAdmin()` | Rob | Open |
| S7-03 | 7 | Open-redirect on client-side `router.push(next)` | 🟠 | High | Phishing via magic-link redirect | Extract `safeNext()` everywhere | Rob | Open |
| UX-04 | 8 | Persona default = supplier for doctors | 🟠 | Certain | Persona promise broken; `/doctors` conversion hit | Map `doctor` → `pharmacist` | Rob | Open |
| UX-05 | 8 | Accessibility primitives absent | 🟠 | High | Fails WCAG AA; blocks govt/hospital sales | axe-core + a11y sprint | Rob | Open |
| UX-06 | 8 | Live drug page diverges hard from reference mockup | 🟠 | Certain | Approved design ≠ shipped design | Decide which is canonical | Rob | Open |

---

## 6. Top 10 quickest wins (ranked by uplift / effort)

| # | Title | Pillar(s) | Effort | Expected uplift |
|---|---|---|---|---|
| 1 | Rotate GitHub PAT + switch `origin` to SSH | 7 | 10 min (S) | Closes 🔴 S7-01; eliminates write-leak |
| 2 | Fix `records_upserted` → `records_processed` typo in Railway runners | 2 | 1 line (S) | Restores Railway log signal |
| 3 | `git add` migrations 035 + 037 + ema_epar_importer + commit | 1, 6 | 1 commit (S) | Closes D1-05 + Q6-02 |
| 4 | Wire `safeNext()` everywhere + add `requireAdmin()` to 2 admin pages | 7 | ~30 min (S) | Closes S7-02 + S7-03 (admin info disclosure + open-redirect class) |
| 5 | Install Sentry on Next + Python scrapers | 10 | 30 min (S) | Closes 🔴 O10-01; errors start alerting |
| 6 | Commit `.github/workflows/eval-coverage.yml` from `evals/CI-WORKFLOW.md.template` | 9, 10 | 1 hour (S) | Closes AI-01 + half of O10-02 |
| 7 | Add auth preamble to 5 supplier routes | 3 | 5 routes × 5 lines (S) | Closes B3-01 (BI leak) |
| 8 | Add `_touch_data_source()` mixin to the 8 non-shortage scrapers | 1, 2 | M | Closes D1-01; freshness dashboard accuracy restored |
| 9 | Delete dead components + dead routes (`/alerts`, `/watchlist`, `world-map.tsx`, etc.) | 4 | S | Closes F4-03 + F4-05 |
| 10 | Add `logrotate` config for `logs/cron.log` | 2 | S | Closes D2-03 |

**Cumulative effort:** these 10 items are ~1.5 dev-days. They close 1 🔴, 6 🟠, and meaningfully move 4 pillar scores (Pillar 1: 3.5 → 4; Pillar 2: 3.5 → 4; Pillar 7: 2.5 → 3.5; Pillar 10: 3.0 → 3.5).

---

## 7. Six-week remediation roadmap

Sequenced by *leverage × feasibility*. Each item lists affected pillars, suggested approach, blockers, effort, expected maturity delta.

### Sprint 1 (Week 1): Stop the bleeding
- **Win pack** (items #1–10 above). 1.5 days. Closes the immediate-action criticals.
- **Decision #1** (Railway migration): Rob picks runtime. Document choice in `cron/RAILWAY_SERVICES.md` v2. Start a deprecation PR for the loser.
- **Outcome:** P1 → 4, P2 → 4, P7 → 3.5, P10 → 3.5. Overall average 2.95 → 3.25.

### Sprint 2 (Week 2): Observability + safety net
- **Sentry rollout finished** (frontend + Python). Wire to `#alerts` or email.
- **Better Stack uptime** on 4 routes.
- **CI**: `npm ci && lint && build` on PR; nightly eval-no-judge; weekly eval-with-judge.
- **Vitest skeleton** + 4 pure-function tests (`risk-score`, `seo`, `trade-price`, `demand-signal`); Playwright smoke test for `/`, `/search`, `/drugs/<known-id>`.
- **AI usage log**: `ai_request_log` table + helper called from `/api/chat` and the 5 ancillary surfaces.
- **Outcome:** P6 → 3, P9 → 4.75, P10 → 4. Overall 3.25 → 3.5.

### Sprint 3 (Week 3): Schema + heartbeat hardening
- **Drug-entity decision** (Decision #3). Pick canonical; sequence dedupe pipeline.
- **Citation chain repair**: D1-01 fix on 8 non-shortage scrapers; D1-07 generated-column on recalls.
- **Recall linker on Railway** (D2-07).
- **Schedule eligibility scrapers** (D2-06).
- **Quarantine cleanup**: re-enable poland_mz, push the others to next sprint.
- **Outcome:** P1 → 4.25, P2 → 4.25.

### Sprint 4 (Weeks 4–5): UI/Design decision + execution
- **Decision #2** (Tailwind commit or remove). If commit:
  - Build `lib/ui/{Button, Card, Badge, Input, Modal}.tsx` on Tailwind v4 + shadcn primitives.
  - Token audit: collapse shadcn + Mederti vars; fix `--teal`.
  - Migrate `/drugs/[id]` (the god-component) as the first consumer — split into per-persona files; type the Supabase queries.
- **Mobile-first migration**: delete `MobileHome` / `MobileDrugPage` / `MobileSupplierPage`; rebuild responsive in the new component lib.
- **A11y sprint**: axe-core in CI; fix top 20 violations; focus-ring discipline in the new component lib.
- **Outcome:** P4 → 3, P8 → 3.

### Sprint 5 (Week 6): Perf + polish
- **API caching audit**: per-route `revalidate` / `Cache-Control` headers on public reads (P5-01).
- **`predictive-signals` to Postgres view** (P5-02).
- **`next/image` for the logo + chat assets** (P5-03).
- **Conversion-funnel events**: `recordDemandSignal()` extension or PostHog drop-in (O10-04).
- **JSON-LD coverage**: `Organization`, `Dataset` on `/shortages` (O10-06).
- **AWS IP clause doc** (`docs/ip-position.md`).
- **Outcome:** P5 → 4, P10 → 4.5.

**End-of-roadmap maturity:** average ~3.8 / 5 ("solid; minor gaps; no risk at current or next stage").

---

## 8. Cross-reference to persona coverage audit

The persona audit's cluster framing maps onto architecture findings as follows. Items at the intersection are double-leverage (one fix moves both audits).

| Persona audit cluster | Architecture findings that block it | Shared remediation |
|---|---|---|
| **Cluster 1: Typed-tool plumbing** (60 YELLOW questions) | AI-01 (eval CI), AI-02 (observability), B3-06 (logic location) | Push aggregations into Postgres views + shared `lib/insights/` helpers — both chat tools and API routes consume the same primitives |
| **Cluster 2: Hospital/procurement operational substrate** (25 ORANGE questions) | Per-hospital formulary, contracted suppliers, fill-rate — needs schema + ingest. D1-03 (drug entity) is a prerequisite | Decide canonical entity (open #3); design hospital-network schema after |
| **Cluster 3: Forecasting + confidence calibration** (11 BLACK + 10 ⚠) | AI-06 (no prompt version stamp), D2-11 (heartbeat lies), D1-01 (citation breaks for 8 scrapers), Q6-01 (no test for forecasts) | Citation-chain repair (Sprint 3) + AI usage log (Sprint 2) are prerequisites for trustable forecasts |
| **12 ⚠ hallucination paths** | AI-01 (eval CI not enforced) | Commit the workflow YAML (Win #6) |
| **SUP-15, RET-08, RET-27, HPR-18** (eligibility) | D2-06 (eligibility scrapers never scheduled) + D1-12 (sparse `regulatory_eligibility` data) | Schedule the 4 eligibility scrapers (Win #?, Sprint 3) |
| **GOV-13/14/15/05, SUP-05** (peer-country burden comparison) | P5-02 (predictive-signals 30k-row JS aggregation) | Move to Postgres view (Sprint 5) makes both faster and chat-callable |
| **All "answer arrived but no citation"** | D1-12 (drug_alternatives lacks source URL), D1-07 (recall FK drift), D1-01 (8 scrapers no heartbeat) | Citation-chain repair (Sprint 3) |

**The strongest shared lever**: fixing the citation chain in Sprint 3 directly clears the persona audit's "hallucination risk on forecasts" theme AND the architecture audit's ⚠ hidden-failure items D1-01/D2-11/D1-14.

---

## 9. Open questions

Decisions Rob needs to make before remediation can be sequenced.

1. **Railway migration runtime — pick one.** Mac cron is the live source of truth; Railway has 5 parallel definitions. Cost of finishing: ~1 week; cost of leaving as-is: silent downtime risk when laptop sleeps + ops blindness. (See FINDING-D2-01.)

2. **Tailwind v4: commit or remove.** Current state is worst-of-both. Committing means building `lib/ui/` and migrating ~3,200 inline-style instances. Removing means owning CSS deliberately (~smaller refactor, lower ceiling). (See FINDING-UX-01.)

3. **Drug-entity canonicalization** — which of `drugs` / `drug_catalogue` / `drug_products` is master? Recommend `drugs`; others as downstream views. Pre-req for: dedupe pipeline, re-enabling CAS uniqueness, eliminating the chat's "wide-select fallback" dance. (See FINDING-D1-03 + D1-08.)

4. **Test framework + CI gate**: Vitest + Playwright vs Jest + Cypress vs none. Minimum bar before scaling.

5. **Observability stack**: Sentry vs LogTail vs Datadog; PostHog vs GA4 vs custom `demand_signals`. (Current state: zero / partial.)

6. **AWS IP clause**: needs a documented carve-out from Rob's AWS employment IP-assignment language, or written waiver. **Most important governance gap; blocks any due-diligence conversation.**

7. **`api/` FastAPI**: delete or rename to `legacy_api/`? Either is fine; current state ("CLAUDE.md says it's dead, repo still mounts it on Railway") is confusing.

8. **Soft-launch flag scope**: `NEXT_PUBLIC_SOFT_LAUNCH` documented but not surfaced. Need a runtime check on prod state.

---

## 10. Appendix — raw inventories

### 10.1 Supabase tables (~51 distinct, grouped by surface)

- **Drug intelligence:** `drugs`, `drug_catalogue`, `drug_products`, `drug_synonyms`, `drug_rxnorm`, `atc_codes`, `drug_alternatives`, `drug_pricing`, `drug_pricing_history`, `therapeutic_equivalents`, `active_ingredients`, `product_ingredients`, `drug_availability`, `drug_availability_history`, `drug_status_snapshots`
- **Shortages:** `shortage_events`, `shortage_status_log`
- **Recalls:** `recalls`, `recall_shortage_links`
- **Supplier marketplace:** `supplier_profiles`, `supplier_inventory`, `supplier_quotes`, `supplier_documents`, `supplier_notifications`, `supplier_analytics_events`, `supplier_portfolios`, `supplier_enquiries`, `ai_supplier_insights`
- **Supply intelligence:** `manufacturing_facilities`, `api_suppliers`, `api_manufacturers`, `api_supply_summary`, `drug_approvals`, `regulatory_events`, `clinical_trials`, `pharma_trade_flows`, `oecd_pharma_metrics`, `snomed_concepts`, `regulatory_eligibility`
- **Reference/macro:** `data_sources`, `manufacturers`, `sponsors`, `intelligence_sources`, `intelligence_articles`
- **Ops/users:** `audit_logs`, `raw_scrapes`, `scraper_runs`, `alert_notifications`, `user_profiles`, `user_watchlists`, `email_subscribers`, `demand_signals`

### 10.2 Scrapers (67 files; 47 in Mac cron)

- **In cron (Mac, daily UTC stagger):** tga, fda, health_canada, mhra, ema, bfarm, ansm, aifa, aemps, fda_enforcement, hsa, pharmac, medsafe, cbg_meb, dkma, fimea, hpra, lakemedelsverket, sukl, ogyei, swissmedic, noma, ages, anvisa, pmda, mfds, cofepris, sahpra, nafdac, sfda, belgium_famhp, greece_eof, portugal_infarmed, argentina_anmat, malaysia_npra, poland_mz (quarantined!), uae_mohap; recalls — tga_recalls, fda_recalls, health_canada_recalls, ema_recalls, mhra_recalls, fda_medwatch, aifa_recalls, ansm_recalls, medsafe_recalls, aemps_recalls
- **Commented out in cron:** bfarm_recalls
- **Not in any cron:** ashp, clinicaltrials, ema_chmp, fda_adcomm, fda_inspections, nhs_drug_tariff, drugs_at_fda, eudragmdp, edqm_cep, hk_drugoffice (Railway-only), turkey_titck (Railway-only), israel_moh (quarantined), china_nmpa (quarantined), india_cdsco (quarantined)
- **Eligibility (5, never scheduled):** `eligibility/base.py`, `eligibility/tga_s19a.py`, `eligibility/mhra_ssp.py`, `eligibility/fda_shortage.py`, `eligibility/eu_art_5_2.py`

### 10.3 API endpoints (49 Next.js Route Handlers + legacy FastAPI routers)

See §3.3 for the full table grouped by domain. FastAPI legacy: `api/routers/{search, drugs, shortages, summary, sources, data_quality, recalls, intelligence_sources}.py` — functionally dead.

### 10.4 Frontend routes

24 top-level routes. See §3.4 for the high-traffic subset. Dead routes: `/alerts`, `/watchlist` (308-redirected, page files still exist).

### 10.5 Chat tools (30 total)

1. `web_search` (Anthropic server, 5 uses/turn)
2. `query_intelligence_sources` (124 macro sources)
3. `search_drugs` 4. `get_drug_details` 5. `find_substitutes` 6. `list_active_shortages` 7. `get_trade_prices` 8. `summarize_shortage_landscape` 9. `get_class_summary` 10. `search_recalls`
11. `get_sole_source_essentials` 12. `compare_shortage_burden` 13. `get_class_concentration_risk` 14. `get_resolution_time_stats` 15. `get_predictive_signals`
16. `get_eligibility_status` 17. `get_recurring_shortages` 18. `get_shortage_history` 19. `get_available_brands` 20. `get_recent_deregistrations`
21. `get_dose_conversion` 22. `get_therapeutic_equivalents` 23. `get_supplier_shortage_record` 24. `get_facility_distress_signals` 25. `get_price_around_shortage`
26. `get_management_guidance` 27. `get_recall_links` 28. `get_demand_signal_summary`
29. `get_my_portfolio_status` (auth) 30. `get_watchlist_demand` (auth) 31. `set_portfolio_alert` (auth, **WRITE**)

### 10.6 Models in use

- `/api/chat`: `claude-opus-4-7` (overridable via `ANTHROPIC_MODEL`)
- `/api/chip-answer`, `/api/daily-question`, `/api/intelligence/briefing`, `/api/drugs/[id]/so-what`, `lib/ai/supplier-insights.ts`: `claude-sonnet-4-20250514` (hardcoded)

### 10.7 Third-party services

- **Anthropic** (Claude API)
- **Supabase** (Postgres, Auth, Storage)
- **Vercel** (frontend, Route Handlers, Analytics, Speed Insights, edge runtime for OG images)
- **Railway** (partial scrapers; in-flight migration)
- **Resend** (transactional email)
- **GitHub** (private repo)
- **Mac cron** (live scraper scheduler)

### 10.8 Key dependencies (frontend)

35 prod + 13 dev. Heavy: `d3 ^7.9`, `jspdf ^4.2`, `xlsx ^0.18.5` (verify CVE patch), `react-simple-maps ^3.0`. Modern stack: Next 16.1.6, React 19.2.3, TS 5, Supabase 2.97, Anthropic SDK, Lucide. `vercel.json` uses `npm install --legacy-peer-deps` — masks peer-dep conflicts; worth investigating.

---

---

## 11. Code conflicts, duplication & bloat — dedicated pass

This section consolidates duplication, dead-code, dependency, and abandoned-work findings that are spread across §3 above, plus 4 new findings from a targeted sweep.

### 11.1 Merge conflicts in tracked code
**None.** `grep -rIn '^<<<<<<< \|^>>>>>>> \|^=======$'` across tracked source returns one apparent hit at [`frontend/app/api/supplier/insight/quote-coaching/[id]/route.ts:107`](frontend/app/api/supplier/insight/quote-coaching/[id]/route.ts) but it is a markdown horizontal-rule inside a prompt string (the line below has `================` as a section break). Verified false positive. No real merge markers anywhere.

### 11.2 Duplication / conflicting implementations
| ID | Severity | Description | Where |
|---|---|---|---|
| F4-02 | 🟠 | Two parallel persona-view component trees | `drugs/[id]/{Pharmacist,Procurement,Supplier}View.tsx` vs `chat/components/cards/{Pharmacist,Procurement,Supplier}Card.tsx` |
| B3-02 | 🟠 | FastAPI legacy duplicates Next.js Route Handler logic | `api/routers/*` vs `frontend/app/api/*` |
| B3-05 | 🟡 | Typed client `lib/api.ts` references endpoints that don't exist as handlers | `getShortages`, `getRecalls`, etc. wrap FastAPI-only routes |
| B3-06 | 🟢 | Business-logic shape duplicated across 6 route handlers | `drug-resilience`, `predictive-signals`, `regulatory-calendar`, `pipeline/[drug_id]`, `market-data`, `intelligence/briefing` — none share helpers |
| B3-07 | 🟢 | Wide `select(...)` strings duplicated across routes with schema-drift fallback dance | `frontend/lib/chat/tools.ts:601-619` |
| D2-01 | 🔴 | **5 parallel cron execution paths disagree on which scrapers run** | `crontab_fixed.txt`, `railway/railway.toml`, `railway/shortage_cron_daily/run.py`, `railway/shortage_cron_frequent/run.py`, `cron/run_shortage_scrapers.py`, `railway/scheduler.py` |
| UX-08 | 🟡 | Two design token systems coexist (shadcn `oklch()` + Mederti hex) | `frontend/app/globals.css:50-117` vs `:130-168` |
| F4-03 (parser) | 🟠 | `parser.tsx` + `parser2.tsx` co-exist in chat components | `frontend/app/chat/components/{parser,parser2}.tsx` |
| D1-03 | 🟠 | Three competing drug-entity tables | `drugs`, `drug_catalogue`, `drug_products` |
| D1-04 | 🟠 | Two competing status enums | `shortage_events.status` vs `drug_availability.status` |
| D1-07 | 🟠 | Same target, two FK column names | `recalls.source_id` vs `shortage_events.data_source_id` |

### 11.3 Dead code
| ID | Severity | Description | Where |
|---|---|---|---|
| F4-03 | 🟠 | Unimported components shipping or compiled | `SpinningGlobe.tsx` (8.4KB), `world-map.tsx` (6.9KB, zero imports), `drugs/[id]/{CrossBorderAvailability,PipelineRegulatory,SupplyChainResilience,ai-insight-chips,forecast}.tsx` (zero imports) |
| F4-05 | 🟠 | Dead routes; page files still present | `/alerts/page.tsx`, `/watchlist/page.tsx` — 308-redirected to `/account` in `next.config.ts:13-14` |
| F4-11 | ⚠ | `drugs/[id]/v4/` directory — page redirected away, two components inside still used | `frontend/app/drugs/[id]/v4/{bell-button, header-actions}.tsx` |
| B3-02 | 🟠 | Stale `NEXT_PUBLIC_API_URL` reference; variable declared, never used | `frontend/app/search/page.tsx:13` |
| Q6-07 | 🟡 | Legacy FastAPI in tree — 1,697 LOC | `api/main.py` + `api/routers/*` (11 files) |
| D2-13 | 🟢 | `railway/scheduler.py` imports class names that no longer exist; instant crash if invoked | `railway/scheduler.py:16-25`, plus orphaned `railway/scrapers/` (9 files), `railway/Procfile`, `railway/regulatory_cron/` |
| D1-11 | 🟡 | `drug_universe` Postgres views are orphans | `v_au_drug_universe`, `v_gb_drug_universe`, `v_drug_universe_global` from migration 011 — zero frontend imports |
| (new) Q6-08 | 🟡 | **3 git stashes containing real WIP, oldest from `sprint1/step3-migration-clean`** | `stash@{0}` (migration-clean WIP across CLAUDE.md + 5 files); `stash@{1}` (TGA scraper improvements + supplier dashboard auth bypass for demo); `stash@{2}` (severity colour backgrounds on landing-nav). Some may already be re-shipped via subsequent commits, others may be lost work. |

### 11.4 File-size bloat (≥ 600 lines)

Surfaced from `wc -l` across `frontend/app`, `frontend/lib`, `backend/`, `api/`:

| Lines | File | Note |
|---|---|---|
| **3,551** | `frontend/lib/chat/tools.ts` | **New finding** — biggest file in the entire repo. 30 chat tools + DB-backed handlers inline; should be split per-tool (`lib/chat/tools/{search-drugs, get-drug-details, ...}.ts`) with a thin registry. |
| 1,480 | `frontend/app/drugs/[id]/page.tsx` | F4-01 god-component |
| 1,029 | `backend/scrapers/portugal_infarmed_scraper.py` | Largest backend file |
| 964 | `frontend/app/drugs/[id]/ProcurementView.tsx` | Persona view bloat |
| 963 | `frontend/app/supplier-dashboard/SupplierDashboardClient.tsx` | |
| 957 | `frontend/app/chat/components/Sidebar.tsx` | |
| 926 | `frontend/app/drugs/[id]/SupplierView.tsx` | |
| 842 | `frontend/app/components/landing-page-client.tsx` | |
| 820 | `frontend/app/components/bulk-upload.tsx` | |
| 782 | `backend/scrapers/israel_moh_scraper.py` | Quarantined (D2-04) |
| 768 | `frontend/app/drugs/[id]/PharmacistAnswerCard.tsx` | |
| 760 | `frontend/app/chat/components/PreviewPane.tsx` | |
| 679 | `frontend/app/components/landing-nav.tsx` | |
| 660 | `backend/scrapers/hk_drugoffice_scraper.py` | |
| 647 | `frontend/app/chat/components/parser.tsx` | Plus the duplicate `parser2.tsx` (see 11.2) |
| 624 | `backend/scrapers/base_scraper.py` | OK for a base class |

#### 🟠 FINDING-Q6-09 (new) — `frontend/lib/chat/tools.ts` is 3,551 lines and is the chat surface's single source of truth
- **Artifact:** `frontend/lib/chat/tools.ts` (3,551 lines).
- **Issue:** Contains all 30 tool definitions, handler bodies, schema-drift fallback logic, wide-select fallback dance, plus the helpers used by chat orchestration. Every chat regression has to be diagnosed by paging through this file. Cache invalidation surface for `cache_control: ephemeral` is whatever Anthropic decides — small edits to this file can blow the cache repeatedly.
- **Risk:** Highest-traffic file in the AI surface is also the hardest to read. Tool-level testability is zero. Token-cost regressions from a single tool can't be attributed.
- **Remediation:** **M.** Split per-tool into `lib/chat/tools/{search_drugs, get_drug_details, …}.ts`; export a `TOOL_DEFINITIONS` registry from `lib/chat/tools/index.ts`. Each tool gets its own file with the schema + handler + tests. Side benefit: per-tool eval coverage becomes natural.

### 11.5 Unused npm dependencies (install-bloat)

Heuristic grep across `frontend/{app,lib}` looking for `from 'X'` / `require('X')` / `import('X')`:

| Dep | Status | node_modules size | Note |
|---|---|---|---|
| `country-flag-icons` | **Unused** | **19 MB** | Biggest single waste — install bloat |
| `radix-ui` (the meta-package) | **Unused** | small | shadcn convention is per-component `@radix-ui/react-X` — the meta-package is leftover |
| `shadcn` (CLI as a dep) | **Unused** | small | Should be `devDependency` or globally invoked; remove |
| `class-variance-authority` | **Unused** | small | Standard shadcn helper; never imported because the team didn't build on shadcn |
| `tw-animate-css` | **Unused** | small | Tailwind animation plugin; pulled in by shadcn init, never used |
| `canvg` | **Unused** | small | Likely a transitive dependency assumption for `jspdf`; verify before removing |

Plus heavy deps that ARE used but may not be lazy-loaded:

| Dep | Size | Lazy-loaded? |
|---|---|---|
| `lucide-react` | 45 MB | Imported direct in 51 files; needs `experimental.optimizePackageImports` in `next.config.ts` (P5-05) |
| `jspdf` | 31 MB | Used by `bulk-upload.tsx`; ⚠ **verify** with `next build --profile` — should be `dynamic(() => import('jspdf'))`. Cross-ref P5-04. |
| `xlsx` (0.18.5) | included | Lazy-loaded ✅ (`bulk-upload.tsx:159` uses `await import("xlsx")`). But Q6-05 CVE risk still applies — pin to 0.20.2+. |
| `d3` | included | Imported in landing/visualizations; not verified lazy. |
| `react-simple-maps` + `topojson-client` | included | Likely used for the world-map; if `world-map.tsx` is dead (F4-03), the deps may be too. |

#### 🟡 FINDING-Q6-10 (new) — 6 unused npm dependencies (~20 MB install bloat); 5 of them are shadcn-init leftover
- **Artifact:** `frontend/package.json`.
- **Issue:** `country-flag-icons` (19MB, unused), `radix-ui` (meta-package), `shadcn` (should be devDep or global), `class-variance-authority`, `tw-animate-css`, `canvg` — none imported anywhere in `app/` or `lib/`. 5 of 6 are leftover from `npx shadcn init` that was then never built on (cross-ref UX-01).
- **Risk:** Install / build time inflation; `npm audit` surface inflation; future engineer assumes shadcn is wired when it isn't.
- **Remediation:** **S.** `npm uninstall country-flag-icons radix-ui shadcn class-variance-authority tw-animate-css`. Verify `canvg` isn't a transitive peer-dep of `jspdf` first. Should knock ~20 MB off `node_modules` and clean `package.json` signal.

### 11.6 Type-safety escape hatches (cross-ref F4-06)
- **74 `: any`** declarations across `frontend/app` + `frontend/lib`
- **125 `as any`** casts
- **Zero `@ts-ignore` / `@ts-expect-error`** — escapes flow through `any` instead, which is silently worse (no IDE signal)
- **28 `eslint-disable @typescript-eslint/no-explicit-any`** in `drugs/[id]/page.tsx` alone

### 11.7 Stale code activity signals
- **5 TODO/FIXME/XXX/HACK** comments across all `app/`, `lib/`, `backend/` (low — clean signal here)
- **0 `*.bak` / `*.old` / `*.copy` / `*.orig` / `*~`** files (clean)
- **0 `*legacy*` / `*classic*`** in active path (some redirected routes in `next.config.ts` reference `/classic` but no files)
- **26+ stale git branches** + **3 open stashes** (Q6-03 + new Q6-08)

### 11.8 Bloat findings summary

Add these to the §5 risk register:

| ID | Pillar | Severity | Mitigation effort |
|---|---|---|---|
| Q6-08 (new) | 6 | 🟡 | Audit 3 stashes; either re-apply or drop |
| Q6-09 (new) | 6 / 9 | 🟠 | Split `lib/chat/tools.ts` per-tool |
| Q6-10 (new) | 6 | 🟡 | Remove 6 unused deps (≤ 30 min) |

**Quickest win to add to §6 list:** *Run `npm uninstall country-flag-icons radix-ui shadcn class-variance-authority tw-animate-css` (after verifying `canvg`). 5 min. Closes Q6-10, saves ~20 MB, cleans `package.json` signal.*

---

**End of audit.** Cross-ref the companion: [`persona-coverage-audit.md`](persona-coverage-audit.md).
