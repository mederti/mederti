# Mederti — Project Briefing for Claude Code

## What is Mederti?
A global pharmaceutical shortage intelligence platform. It scrapes drug shortage and recall data from 40 regulatory sources across 20+ countries, stores it in a PostgreSQL database, and serves it through a REST API and Next.js frontend.

**Live site:** https://mederti.vercel.app (currently shows empty data — see "Critical Blockers" below)

---

## Architecture

```
Scrapers (Python, local cron)
    ↓ upsert via Supabase REST API
Supabase (PostgreSQL, cloud)
    ↑ service-role key
FastAPI backend (api/)
    ↑ NEXT_PUBLIC_API_URL
Next.js frontend (frontend/)
    → Deployed on Vercel
```

- **Database:** Supabase PostgreSQL at `https://mleblwjozjvpbuztggxp.supabase.co`
- **Backend API:** FastAPI, configured for Railway deployment (not yet deployed)
- **Frontend:** Next.js 16 + React 19 + Tailwind 4, deployed on Vercel
- **Scrapers:** Python, run locally via cron every 30 min

---

## Project Structure

```
mederti/
├── api/                    # FastAPI backend
│   ├── main.py             # App entry point (uvicorn api.main:app)
│   └── routers/            # 8 routers: search, drugs, shortages, summary, sources, recalls, data_quality, intelligence_sources
├── backend/
│   ├── scrapers/           # 47+ country-specific scrapers
│   ├── alerts/             # Email alert system (Resend)
│   ├── importers/          # Data importers (alternatives, intelligence sources)
│   └── utils/
│       ├── db.py           # Supabase client singleton (get_supabase_client())
│       ├── logger.py
│       └── retry.py
├── frontend/
│   ├── app/                # Next.js App Router pages
│   ├── lib/
│   │   ├── api.ts          # TypeScript API client (all endpoints typed)
│   │   ├── rss.ts          # RSS feed parser
│   │   └── supabase/       # client.ts (browser) + server.ts (SSR)
│   ├── .env.local          # Frontend env vars (GITIGNORED)
│   └── vercel.json         # Vercel deployment config
├── supabase/
│   ├── migrations/         # 8 migration files (001-008)
│   └── seed.sql            # Seed data
├── cron/                   # Cron job configs
├── logs/                   # Scraper logs (daily files)
├── .env                    # Backend env vars (GITIGNORED)
├── .env.example            # Template
├── railway.toml            # Railway deployment config
├── nixpacks.toml           # Explicit Python 3.11 build for Railway
└── run_all_scrapers.py     # Master scraper orchestrator
```

---

## Database Schema (key tables)

| Table | Records (Mar 3) | Purpose |
|-------|-----------------|---------|
| drugs | 7,161 | Master drug registry with full-text search (tsvector + trigram) |
| shortage_events | 14,108 | Deduplicated shortage signals (MD5 hash dedup via shortage_id) |
| recalls | 12,864 | Drug recall tracking (Class I/II/III) |
| data_sources | 40 | Regulatory bodies (25 active, 15 inactive) |
| raw_scrapes | 195 | Raw scraper output log |
| drug_alternatives | — | Therapeutic alternatives with evidence grading |
| drug_pricing | — | Historical pricing by country |
| user_watchlists | — | User drug watches (links to Supabase Auth) |
| alert_notifications | — | Alert dispatch ledger |
| audit_logs | — | Immutable mutation log |
| email_subscribers | 1 | Landing page signups |
| manufacturers | 5 | Pharma companies |
| intelligence_sources | 124+ | Macro data source catalog |

### Shortage statuses: active (9,113) | resolved (4,068) | anticipated (917) | stale (10)
### Recall statuses: active (1,959) | completed (10,905)

---

## API Endpoints

Base: `http://localhost:8000` (local) or Railway URL (production — TBD)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /health | GET | Health check |
| /search?q=&limit= | GET | Fuzzy drug search with shortage counts |
| /drugs/{id} | GET | Drug detail |
| /drugs/{id}/shortages | GET | Shortages for a drug |
| /drugs/{id}/alternatives | GET | Therapeutic alternatives |
| /drugs/{id}/recalls | GET | Recall history + resilience score |
| /shortages | GET | Browse shortages (paginated, filterable by country/status/severity) |
| /shortages/summary | GET | Dashboard KPIs |
| /sources | GET | List regulatory data sources |
| /recalls | GET | Browse recalls (paginated, filterable) |
| /recalls/summary | GET | Recall aggregate counts |
| /intelligence-sources | GET | Browse 124+ intelligence sources |
| /intelligence-sources/summary | GET | Counts by category |
| /intelligence-sources/{id} | GET | Single source detail |
| /health/data-quality | GET | Data quality health checks |

---

## Frontend Pages

### Data pages (require backend API):
- `/dashboard` — KPIs, world heatmap, shortage timeline, news, video
- `/shortages` — filterable shortage table
- `/recalls` — filterable recall table
- `/search` — drug search with shortage breakdowns
- `/home` — home feed (AU-focused shortages, recalls, watchlist)
- `/drugs/[id]` — drug detail (shortages, alternatives, recalls, resilience score)

### Auth pages (Supabase Auth):
- `/login`, `/signup` — authentication
- `/alerts` — drug watchlist management
- `/watchlist` — saved drugs
- `/account` — settings & notifications

### Static pages:
- `/` — landing page
- `/about`, `/pricing`, `/contact`, `/privacy`, `/terms`, `/chat`

---

## Environment Variables

### Backend (.env at project root — GITIGNORED):
```
SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
MEDERTI_DRY_RUN=0
```

### Frontend (frontend/.env.local — GITIGNORED):
```
NEXT_PUBLIC_API_URL=http://localhost:8000          # ← MUST be Railway URL in production
NEXT_PUBLIC_SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon JWT>
SUPABASE_URL=https://mleblwjozjvpbuztggxp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role JWT>
RESEND_API_KEY=<resend key>
RESEND_FROM_EMAIL=intelligence@mederti.com
```

---

## CRITICAL BLOCKERS — Live site shows empty data

The live site at mederti.vercel.app shows zero data because the frontend can't reach the backend API. The fix requires these steps in order:

### 1. Push unpushed commit to GitHub
Commit `bd3ebbe` is on local `main` but never pushed. It contains:
- `nixpacks.toml` — explicit Python 3.11 build config for Railway
- All recall scrapers (15+ countries)
- Intelligence sources router + importer
- Frontend pages: shortages, recalls, home, alerts, watchlist, chat
- World map, news feed, video embed components
- DB migrations 007 (recalls) and 008 (intelligence sources)

Previous push was blocked by git-defender (corporate tool on old machine). New machine should be able to push.

### 2. Deploy backend on Railway
- Go to railway.app → project → connect GitHub repo `mederti/mederti`
- Add env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDERTI_DRY_RUN=0
- Deploy (nixpacks.toml will handle Python 3.11 setup)
- Settings → Networking → Generate public domain
- Result: `https://something.up.railway.app`

### 3. Configure Vercel environment variables
In Vercel dashboard → frontend project → Settings → Environment Variables:
- `NEXT_PUBLIC_API_URL` = Railway public domain URL
- `NEXT_PUBLIC_SUPABASE_URL` = Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key
- `RESEND_API_KEY` = Resend key
- `RESEND_FROM_EMAIL` = intelligence@mederti.com

Then redeploy.

---

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `last_scraped_at` never updates on data_sources | Low | Scrapers don't write back to this field |
| 3 raw_scrapes stuck in `processing` status | Low | May need manual cleanup |
| Scrapers run from local Mac cron | Medium | Stops when laptop sleeps — move to Railway/VPS |
| EMA scraper stale since Feb 24 | Medium | Returns duplicate/failed repeatedly |
| BfArM scraper failed on Mar 1 | Medium | Worked fine Feb 28 |
| Recall scrapers not in cron | Medium | No new recalls since Feb 25 |
| Only 5 manufacturers seeded | Low | Sparse data |
| CORS allows only GET | Fine for now | Update if POST endpoints added |

---

## Local Development

```bash
# Backend (from project root)
source .env && python3 -m uvicorn api.main:app --port 8000

# Frontend (from frontend/)
cd frontend && npm run dev

# Run all scrapers
python3 run_all_scrapers.py

# Run single scraper (dry run)
MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.tga_scraper
```

---

## Tech Stack

**Backend:** Python 3.11, FastAPI, Supabase Python SDK, httpx, BeautifulSoup4, lxml
**Frontend:** Next.js 16.1.6, React 19.2.3, TypeScript, Tailwind CSS 4, @supabase/ssr, Lucide icons, React Simple Maps, Resend
**Database:** PostgreSQL via Supabase (RLS enabled, full-text search, trigram indexes)
**Deployment:** Vercel (frontend), Railway (backend — not yet deployed), Supabase (database)
**Scrapers:** 47+ Python scrapers covering FDA, TGA, EMA, MHRA, Health Canada, BfArM, ANSM, AIFA, AEMPS, HPRA, Fimea, NoMA, Swissmedic, Pharmac, and more

---

## Git Info

- **Repo:** github.com/mederti/mederti (private)
- **Branch:** main
- **Latest pushed commit:** `aebb975` (Feb 23) — deployment configs
- **Unpushed commit:** `bd3ebbe` — recalls, intelligence sources, nixpacks fix (NEEDS PUSH)
- **Vercel project ID:** prj_YEn45c67WshFBA6D6jP6NwkYBwk5
