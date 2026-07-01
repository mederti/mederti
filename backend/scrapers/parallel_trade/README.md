# Parallel Trade Intelligence

Identifies whether **parallel-import licences** (national) or **parallel-distribution
notices** (EMA, centrally-authorised) have been granted for a product across the
EU27/EEA and the UK, and surfaces them on the drug page with a confidence score.

> Two regimes, stored separately (`licence_type`):
> - `EMA_PARALLEL_DISTRIBUTION` — centrally-authorised product reshipped between EU/EEA states (EMA notice).
> - `NATIONAL_PARALLEL_IMPORT` — nationally-authorised product imported under a national authority's licence.

This module is built **on the existing Mederti scraper/INN/Supabase stack**, not as
a parallel system. Connectors extend `ParallelTradeScraper` → `BaseScraper`, so
raw-scrape logging, content-hash dedup, drug resolution and the freshness
heartbeat are inherited.

---

## Status (Phase 1)

| Source | Legal | Tech | Connector | Notes |
|---|---|---|---|---|
| 🇧🇪 **FAMHP (Belgium)** | 🟢 open (RD 2019) | 🟢 XML export | ✅ built (`famhp_parallel_import_scraper.py`) | First source. `is_active=TRUE`. Two field-level checks before first prod run (see connector header). |
| 🇪🇺 **EMA parallel distribution** | 🟢 reuse w/ attribution | 🟡 headless + token replay | ⏳ scaffold (template) | `is_active=FALSE` until headless harvester built. |
| 🇬🇧 **MHRA (PLPI)** | 🔴 Crown ©/DB-right, **fees** | 🟡 PDF parse | ⛔ **blocked — legal sign-off** | Do NOT ingest until reuse cleared with `copyright@mhra.gov.uk`. |
| 🇩🇪 **BfArM (Parallelimport)** | 🔴 terms forbid resale | 🟡 headless | ⛔ **blocked — legal sign-off** | Richest data (source country + foreign brand + foreign auth no.), but terms prohibit redistribution. |

The legal/tech verdicts come from the Phase-0 source spike. They are also recorded
in `data_sources.notes` (migration 060) so the state is visible at the data layer.

**Before adding any source:** check robots.txt + terms of use + reuse licence. If
reuse is not permitted for a commercial product, set `is_active=FALSE` with a RED
note and build a manual-upload / monitored-download path instead of scraping.

---

## Architecture

```
ParallelTradeScraper (base.py)              extends BaseScraper
  ├─ fetch()       [subclass]               pull raw payload (XML/HTML/PDF/JSON)
  ├─ normalize()   [subclass]               → list[licence dict]
  └─ upsert()      [base]                    parallel_trade_licences (idempotent
                                             on dedup_hash) → resolve INN →
                                             score_match → product_parallel_trade_matches

matching.py        score_match()            confidence ladder (pure, unit-tested)
```

### Tables (migration 060)
- `parallel_trade_licences` — one row per licence/notice (all brief fields).
- `product_parallel_trade_matches` — drug ⇄ licence + `confidence`, `match_basis`,
  derived `needs_review` (confidence < 0.65), `review_state` (auto/confirmed/rejected).

Source registry = `data_sources` (UUID block `…200`+). Ingestion runs + raw docs =
`raw_scrapes`. (Reused, not duplicated — see the design note in migration 060.)

### Confidence ladder (`matching.py` — source of truth)
| Score | Corroborated |
|---|---|
| 1.00 | brand + INN + strength + form + pack + MA number |
| 0.90 | brand + INN + strength + form |
| 0.80 | INN + strength + form + pack |
| 0.65 | INN + strength + form |
| 0.50 | INN only |
| < 0.65 | ⇒ `needs_review` (UI demotes + warns) |

**Honest caveat:** we have no pack-size or reference-MA source on the Mederti side
today, so the 1.00/0.80 tiers (both need pack) effectively never auto-fire; the
realistic ceiling is 0.90. The full ladder is implemented so higher tiers light up
automatically if pack/MA corroboration is added later. The TS port in
`frontend/lib/parallel-trade/score.ts` mirrors this for the recalculate endpoint.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/drugs/[id]/parallel-trade` | Panel feed: EMA notices + national licences + review bucket for a molecule. Self-heals to `available:false` if migration 060 isn't applied (never 500s the drug page). |
| `GET /api/parallel-trade/search?product_name=&inn=&country=&type=` | Free search over licences. |
| `GET /api/parallel-trade/countries/[country_code]` | Per-destination-market view + top sources/distributors. |
| `POST /api/parallel-trade/recalculate/[product_id]` | Re-score existing matches against current drug facts (after metadata enrichment). |

> Routes are **Next.js route handlers** (the live data path), not the legacy
> FastAPI `api/`. The brief's `/products/{id}/...` paths map to `/api/drugs/[id]/...`.

UI: `frontend/app/drugs/[id]/parallel-trade-panel.tsx` — a `.sec` panel on the V1
drug page, inheriting the V1 design tokens. Renders nothing until the API reports
`available:true`.

---

## Run / test / deploy

```bash
# Unit tests (no pytest needed)
python3 -m unittest backend.scrapers.parallel_trade.test_matching -v

# Dry run a connector
MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.parallel_trade.famhp_parallel_import_scraper

# Apply schema (manual — dev has no migration runner; use Supabase SQL editor)
supabase/migrations/060_parallel_trade_intelligence.sql
```

**Deploy checklist**
1. Apply migration 060 (Supabase SQL editor).
2. Verify FAMHP pre-prod checks (connector header) against a live SAM export + XSD v6.
3. Run FAMHP once, confirm `parallel_trade_licences` + `product_parallel_trade_matches` populate.
4. Wire FAMHP into cron (weekly).
5. EMA / MHRA / BfArM: **do not enable** until headless harvester (EMA) and legal
   sign-off (MHRA, BfArM) are in place.

## Adding a national source
Copy `national_parallel_import_connector_template.py`, fill identity + `fetch()` +
`normalize()`, seed a `data_sources` row (UUID block `…204`+) in a new migration,
run the robots/terms/reuse check, test, then wire into cron.
