# Mederti — Project Briefing for Claude Code

> **Vision:** the world's leading source of short-supply drug data and insights — a fusion of the Mederti database with Claude-level synthesis, serving pharmacists, hospital procurement, regulators, suppliers, doctors, and government.

**Live:** https://mederti.vercel.app — serving real data. Spot-check:
`/api/search?q=amoxicillin` returns 8 results; canonical Amoxicillin has 17 active shortages, Insulin aspart 27, Insulin glargine 20.

> **Note for the next agent:** the prior version of this file (Mar 2025) was badly out of date and described a FastAPI-backed architecture that no longer matches reality. If you find a claim here that doesn't match the code, **trust the code and update this file**. Stale source-of-truth is a credibility killer.

---

## Architecture (May 2026)

```
Scrapers (Python, 28 active jobs on Mac cron — Railway migration documented)
    ↓ upsert via Supabase REST API (service-role key)
Supabase (PostgreSQL, RLS on, FTS + trigram, 32 migrations)
    ↑
Next.js Route Handlers (frontend/app/api/*) — 30+ endpoints, talk to Supabase directly
    ↑
Next.js 16 frontend (App Router, React 19, Tailwind 4)
    → Deployed on Vercel
```

**Key change from old docs:** the FastAPI app in `api/` is no longer on the critical path. The frontend uses Next.js Route Handlers (`frontend/app/api/*`) that go straight to Supabase via the service-role key. FastAPI may still be deployed as "mederti API" on Railway per `cron/RAILWAY_SERVICES.md`, but the live site does not depend on it. Treat `api/` as legacy until proven otherwise — verify before relying on it.

---

## Project Structure

```
mederti/
├── api/                          # FastAPI (legacy — not on frontend critical path)
│   ├── main.py
│   └── routers/                  # search, drugs, shortages, summary, sources, recalls, data_quality, intelligence_sources
├── backend/
│   ├── scrapers/                 # 66 scraper files (.py)
│   ├── alerts/                   # Resend email alerts
│   ├── importers/                # WHO ATC/DDD, WHO EML (who_eml_importer), RxNorm, PharmaCompass, etc.
│   └── utils/                    # db.py (Supabase client), logger.py, retry.py
├── frontend/
│   ├── app/
│   │   ├── api/                  # 30+ Next.js Route Handlers (production data path)
│   │   ├── drugs/[id]/           # Persona-aware drug detail (PharmacistAnswerCard, ProcurementView, SupplierView)
│   │   └── [persona]/            # pharmacists/, doctors/, hospitals/, government/, suppliers/, supplier-dashboard/
│   ├── lib/
│   │   ├── api.ts                # Typed client (uses /api relative URLs — no external backend dep)
│   │   ├── supabase/             # admin.ts (service role, server-only), client.ts (browser), server.ts (SSR)
│   │   ├── ai/                   # Supplier insights, etc.
│   │   └── rss.ts
│   ├── .env.local                # GITIGNORED
│   └── vercel.json
├── supabase/
│   └── migrations/               # 32 migrations (001 → 032)
├── cron/
│   ├── crontab_fixed.txt         # Current Mac cron (28 jobs, staggered 19:00–06:45 UTC)
│   ├── run_shortage_scrapers.py
│   ├── run_recall_scrapers.py
│   ├── setup_cron.sh
│   └── RAILWAY_SERVICES.md       # In-flight migration plan (3 cron services + always-on API)
├── logs/                         # Daily scraper logs + cron.log (currently ~500MB, unrotated)
├── railway/                      # Railway service configs (e.g. tga_audit_cron/)
├── nixpacks.toml                 # Python 3.11 for Railway
├── railway.toml
├── .env                          # GITIGNORED (backend creds)
└── run_all_scrapers.py           # Master scraper orchestrator
```

---

## Database — 32 migrations, key surfaces

Beyond the original shortage/recall core, the schema has grown into:

- **Drug intelligence layer** — `drugs`, `drug_catalogue`, `drug_universe` (multi-country), `drug_synonyms`, `drug_rxnorm`, `atc_codes`, `drug_alternatives`, `drug_pricing`, `who_essential_medicines` (WHO Model List of Essential Medicines, eEML — migration 051; denormalised onto `drugs.who_essential_medicine`/`who_eml_section`/`who_eml_year`)
- **Shortage core** — `shortage_events` (with structured reason fields, MD5 dedup), `shortage_status_log`, `live_status_layer`
- **Recall core** — `recalls`, `recall_shortage_links`
- **Supplier & supply intelligence** — `manufacturers`, `supplier_inventory`, `supplier_enquiries`, `supplier_marketplace`, `supply_intelligence_layer`, `pipeline_and_regulatory`
- **Intelligence & content** — `intelligence_sources` (catalog), `intelligence_articles`, `ai_insights_cache`
- **Users & personas** — `user_profiles` (with `role`: pharmacist | procurement | supplier | doctor | government | hospital; `is_admin` locked against self-elevation), `user_watchlists`, `alert_notifications`, `email_subscribers`
- **Ops & audit** — `data_sources`, `raw_scrapes`, `audit_logs` (immutable mutation + TGA audit log)

RLS is enabled on the previously-unguarded tables (migration 029). `user_profiles.is_admin` is locked (028). `supplier_inventory` has a `WITH CHECK` policy (030).

---

## Scraper Coverage — 28 active cron jobs + 38 additional scraper files

**Active in cron (`cron/crontab_fixed.txt`), all daily UTC:**

| Phase | Scrapers (cron-scheduled) |
|---|---|
| 1–7 Shortage (core) | tga, fda, health_canada, mhra, ema, bfarm, ansm, aifa, aemps, fda_enforcement, hsa, pharmac |
| 8 Shortage (additional) | medsafe, cbg_meb, dkma, fimea, hpra, lakemedelsverket, sukl, ogyei, swissmedic, noma, ages |
| 9+ New country | anvisa, pmda, mfds, cofepris, sahpra, nafdac, sfda |
| Recalls | tga_recalls, fda_recalls, health_canada_recalls, ema_recalls, mhra_recalls, fda_medwatch |
| Pricing (→ `drug_pricing_history`) | nadac (US acquisition cost, weekly), nhs_drug_tariff (GB Cat M + price concessions, weekly), france_bdpm (FR public retail price TTC per CIP13, weekly), aifa (IT public retail + SSN reference price per AIC, weekly), spain_nomenclator (ES PVP con IVA per Código Nacional, weekly — needs migration 059) — `backend/scrapers/pricing/`, requires migration 055 |

**Scraper files present but not yet in cron** (38): argentina_anmat, ashp, belgium_famhp, china_nmpa, clinicaltrials, edqm_cep, ema_chmp, eudragmdp, fda_adcomm, fda_inspections, greece_eof, hk_drugoffice, india_cdsco, israel_moh, malaysia_npra, nhs_drug_tariff, poland_mz, portugal_infarmed, turkey_titck, uae_mohap, plus the unscheduled recall counterparts (aemps_recalls, aifa_recalls, ansm_recalls, bfarm_recalls, hsa_recalls, medsafe_recalls, drugs_at_fda) and `recall_linker.py` (recall→shortage causal-link populator).

**Cadence:** 30-min stagger on the core phase, 15-min stagger on phases 8–9+. All scrapers dedupe via MD5 `shortage_id` so repeated runs are idempotent.

**TGA audit:** a daily Railway cron samples 50 active AU shortage records and diffs against the live TGA MSI, writing results to `audit_logs`. Was weekly; promoted to daily after the baseline hit 100%.

---

## Frontend — 24 pages, 30+ API routes, persona-aware

**Pages (public):** `/`, `/about`, `/pricing`, `/contact`, `/privacy`, `/terms`, `/login`, `/signup`, `/onboarding`, `/account`, `/dashboard`, `/home`, `/search`, `/shortages`, `/recalls`, `/intelligence`, `/drugs/[id]`, `/chat`, `/alerts`, `/watchlist`, `/pharmacists`, `/doctors`, `/hospitals`, `/government`, `/suppliers`, `/supplier-dashboard`, `/coming-soon`.

**Persona routing:** `/drugs/[id]` auto-routes to the persona view based on `user_profiles.role`:
- Pharmacist → `PharmacistAnswerCard` (radical simplification — answer + actions)
- Procurement → `ProcurementView`
- Supplier → `SupplierView` (F bento layout, default fallback)

**API routes (selected — see `frontend/app/api/*` for the full list of 30+):**
- Data: `/api/search`, `/api/drugs/[id]`, `/api/drugs/[id]/shortages|alternatives|recalls`, `/api/drug-resilience/[drug_id]`, `/api/drug-autocomplete`, `/api/bulk-lookup`, `/api/market-data`
- Intelligence: `/api/predictive-signals` (peer-set lead-time analysis across 16 EU peers), `/api/regulatory-calendar`, `/api/intelligence/briefing`, `/api/pipeline/[drug_id]`
- Chat/AI: `/api/chat` (Claude Sonnet, tool-using, with rule-based fallback when `ANTHROPIC_API_KEY` is unset — fallback is a degraded experience), `/api/daily-question`, `/api/chip-answer`
- Supplier marketplace: `/api/suppliers/directory`, `/api/supplier/{analytics,demand-signals,inbox,market-gaps,opportunities,pathways,quotes,regulatory}`, `/api/supplier-enquiry`
- Admin: `/api/admin/intelligence`, `/api/admin/cohorts`
- User: `/api/user/role`, `/api/user/profile`
- Email/comms: `/api/subscribe`, `/api/contact`

---

## Environment Variables

**Backend (`.env` at repo root, gitignored):**
```
SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
MEDERTI_DRY_RUN=0
```

**Frontend (`frontend/.env.local`, gitignored — also set in Vercel):**
```
NEXT_PUBLIC_SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon JWT>
SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
ANTHROPIC_API_KEY=<for /api/chat — without it, chat falls back to rule-based handler>
RESEND_API_KEY=<resend key>
RESEND_FROM_EMAIL=intelligence@mederti.com
```

`NEXT_PUBLIC_API_URL` is **not used** by the live frontend — `lib/api.ts` uses relative `/api/*` URLs.

---

## Local Development

```bash
# Frontend (the real app)
cd frontend && npm run dev                       # http://localhost:3000

# FastAPI (legacy — only if you need it)
source .env && python3 -m uvicorn api.main:app --port 8000

# Run all scrapers
python3 run_all_scrapers.py
python3 run_all_scrapers.py tga fda              # specific
MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.tga_scraper   # dry run

# Migrations
ls supabase/migrations/                          # 001 → 032
```

---

## Honest Known Issues

| Issue | Severity | Notes |
|---|---|---|
| Scrapers still on Mac cron (laptop sleep = downtime) | **High** | `cron/RAILWAY_SERVICES.md` documents the migration plan; uncertain whether deployed. Verify with Railway dashboard before assuming. |
| `cron.log` unrotated (~500MB and growing) | Medium | Set up logrotate or move to structured logging in Railway. |
| `last_scraped_at` on `data_sources` not updated by scrapers | Medium | No per-source freshness signal visible to users. Wire this up + expose as a public freshness dashboard. |
| Some recall scraper files exist but aren't in cron (aemps_recalls, aifa_recalls, ansm_recalls, bfarm_recalls, hsa_recalls, medsafe_recalls) | Medium | Add to `crontab_fixed.txt` once tested. |
| Major scraper files exist but never wired to cron (china_nmpa, india_cdsco, israel_moh, malaysia_npra, poland_mz, portugal_infarmed, turkey_titck, uae_mohap, greece_eof, belgium_famhp, hk_drugoffice, argentina_anmat) | High | Each is a meaningful coverage gain — pharma market size, geopolitical relevance. |
| `recall_linker.py` exists; unclear if it's wired into the pipeline | Medium | Causal recall→shortage links are a strong differentiator if populated. |
| Chat fallback (when `ANTHROPIC_API_KEY` is unset) is rule-based pattern matching | Medium | Degraded experience; verify Vercel env var is set. See `frontend/app/api/chat/route.ts`. |
| No public methodology page or freshness dashboard | Medium | Credibility lever for "world's leading source" positioning. |
| No public API tier / data exports for institutional users | Medium | Citations from regulators/researchers = moat. |
| Forward-signal modelling (which drugs are *about* to shortage) — early | Medium | `predictive-signals` is peer-set based; could go deeper with API supplier concentration, demand spikes, recall precursors. |

---

## Tech Stack

- **Backend (data):** Python 3.11, Supabase Python SDK, httpx, BeautifulSoup4, lxml, Resend
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, `@supabase/ssr`, Anthropic SDK, Lucide, React Simple Maps
- **Database:** PostgreSQL via Supabase (RLS, FTS via `tsvector` + trigram, JSONB structured fields)
- **Deployment:** Vercel (frontend + Route Handlers), Supabase (DB), Mac cron + Railway (scrapers — hybrid during migration)
- **AI:** `claude-sonnet-4-6` in `/api/chat`, with Anthropic's `web_search_20250305` server tool enabled. Tool surface covers per-drug lookups, cross-cutting event search (`query_shortage_events` over 29k events) and the macro signals catalogue (`query_intelligence_sources` over 124 entries). Source-priority guidance (regulators → journals → specialist → investigative → national press) is in the system prompt. When `ANTHROPIC_API_KEY` is missing, the route falls back to rule-based pattern matching that handles drug/country/summary lookups but tells the user macro questions are unanswerable — does not pretend to understand them.

---

## Git

- **Repo:** `github.com/mederti/mederti` (private)
- **Branch:** `main`
- **HEAD:** `335edd0` (recent: bento empty states, RxNorm + PharmaCompass ingests, WHO ATC, persona-aware drug pages, security hardening on RLS)
- **Recent direction:** persona-driven UX, supplier/procurement workflows, Path A data ingests (RxNorm, ATC, PharmaCompass), security/RLS cleanup, bento empty-state polish.
