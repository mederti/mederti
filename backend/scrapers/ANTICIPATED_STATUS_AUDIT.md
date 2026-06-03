# Anticipated-shortage status audit

> How every active shortage scraper maps its source status/type values onto our
> canonical `shortage_events.status` enum — and, specifically, whether
> forward-looking ("anticipated" / "upcoming") shortages survive as a distinct
> signal or get collapsed into `active`.
>
> Canonical enum (`001_initial_schema.sql`): `active | anticipated | resolved | stale`.
> `stale` is assigned by `mark_stale_shortages()` (no scraper emits it). Every
> scraper emits some subset of `active | anticipated | resolved`.
>
> Last audited: 2026-06-03. Re-run the greps in this file's "Method" section
> after touching any `_STATUS_MAP` / `_map_status`.

## TL;DR

- The `anticipated` enum value **already exists** end-to-end (DB enum, the
  `/api/shortages` filter, the `/shortages` page chip). The gap was **upstream**:
  most scrapers never emit it.
- **7 scrapers** emit `anticipated`: `tga` (newly fixed — see below),
  `health_canada`, `ansm`, `hsa`, `noma`, `sfda`, and `china_nmpa` (the last not
  yet in cron).
- **The rest collapse forward-looking signal into `active`** (or never receive
  it from their source).
- **Headline finding — TGA (`tga`), FIXED.** TGA's MSI feed encodes anticipated
  shortages as status code **`A`**, which `_STATUS_MAP` mis-mapped to `resolved`
  ("Archived"). Verified 2026-06-03 against the live feed: of 88 `A` records,
  **86 have a FUTURE `shortage_start`**, all are currently `availability=Available`,
  and none have a `deleted_date` (e.g. DAPSONE, onset 15 Jul 2026). `A` is
  unambiguously **Anticipated**, not Archived — the old mapping buried 88
  future-onset early-warning records as resolved. Now mapped `A → anticipated`
  with `shortage_start` flowing into `anticipated_start_date`. A live `normalize()`
  dry-run yields `active=659, resolved=254, anticipated=88` (was `0`).
- **anticipated_start_date** (the >= 6-month-ahead onset Canada mandates) now
  has a dedicated nullable column (migration 049), populated by `health_canada`
  and `tga`. Previously it lived only inside `raw_data` / didn't exist for TGA.

## Per-scraper inventory (active cron jobs)

| Scraper | Country | Source status values | → canonical | Anticipated? |
|---|---|---|---|---|
| `health_canada` | CA | "Active shortage", **"Anticipated shortage"**, "Resolved", "Discontinued" | active / **anticipated** / resolved | ✅ emits + now persists `anticipated_start_date` |
| `ansm` | FR | "rupture", **"tension d'approvisionnement"/"tension"**, "remis à disposition" | active / **anticipated** / resolved | ✅ emits (no separate onset date; `start_date` carries it) |
| `hsa` | SG | supply disruption vs **MAH-change risk** vs permanent end | active / **anticipated** / resolved | ✅ emits (MAH change → anticipated) |
| `noma` | NO | "mangel/utilgjengelig", **"forventet/planlagt/expect"**, "tilgjengelig/opphevet" | active / **anticipated** / resolved | ✅ emits (`_map_status`) |
| `sfda` | SA | shortage_type incl. **"anticipated"/"expected"**, "discontinuation" | active / **anticipated** / resolved | ✅ emits |
| `tga` | AU | `C`/`R`/`D`/**`A`** codes | active / resolved / active / **anticipated** | ✅ emits (fixed 2026-06-03) + persists `anticipated_start_date` from `shortage_start` |
| `fda` | US | "Current", "To Be Discontinued", "Resolved" | active / active / resolved | ❌ no anticipated in this feed¹ |
| `ema` | EU | "ongoing/current/monitoring", "resolved/closed" | active / resolved | ❌ |
| `mhra` | UK | table "active"/"expired" | active / resolved | ❌ |
| `aemps` | ES | active / resolved heuristic | active / resolved | ❌ |
| `aifa` | IT | active / resolved heuristic | active / resolved | ❌ |
| `bfarm` | DE | "Erstmeldung"/"Änderungsmeldung"/"Abschlussmeldung" | active / active / resolved | ❌ (no anticipated category in feed) |
| `ages` | AT | active / resolved heuristic | active / resolved | ❌ |
| `fimea` | FI | `K` / `E` | active / resolved | ❌ |
| `hpra` | IE | active / resolved heuristic | active / resolved | ❌ |
| `pharmac` | NZ | page-status heuristic | active / resolved | ❌ |
| `swissmedic` | CH | (hardcoded) | active | ❌ |
| `cbg_meb` | NL | (hardcoded) | active | ❌ |
| `anvisa` | BR | "normaliz/resolvid" vs else | resolved / active | ❌ |
| `pmda` | JP | ①normal / ②③④limited / ⑤suspended | resolved / active / active | ❌² |
| `mfds` | KR | end-date heuristic | active / resolved | ❌ |
| `cofepris` | MX | (hardcoded) | active | ❌ |
| `sahpra` | ZA | (hardcoded) | active | ❌ |
| `nafdac` | NG | (hardcoded) | active | ❌ |
| `fda_enforcement` | US | fetches Ongoing only | active | n/a (recall enforcement) |
| `medsafe` | NZ | — | returns `[]` (stub: no shortage table parsed) | n/a |
| `dkma` `sukl` `ogyei` `lakemedelsverket` | DK/CZ/HU/SE | — | return `[]` (graceful-empty: 404 / SPA) | n/a |

Additional (not in cron): **`china_nmpa`** ✅ emits `anticipated` (facility
suspension / GMP violation / safety notice → anticipated). Other unwired
country scrapers were not audited in depth — re-run the Method greps when
wiring them.

### Non-scraper producer: `recall_linker` (IMPORTANT for counts)

`recall_linker._maybe_auto_create_shortage()` auto-creates `anticipated`
shortage rows from Class I recalls (a Class I recall is a forward signal that a
shortage may follow). These are **synthetic** rows (migration 046's `synthetic`
flag) and should be EXCLUDED from public "anticipated regulator signal" counts.

Verified against prod 2026-06-03 — the raw `anticipated` count is dominated by
these recall-derived rows, NOT genuine regulator anticipated notifications:

| Country | genuine (shortage feed) | recall-derived (synthetic) |
|---|---|---|
| FR (ANSM) | 245 | 0 |
| CA (Health Canada) | 274 | 367 |
| AU (TGA) | 0 → ~88 after TGA fix runs | 32 |
| US (FDA) | 0 | 1,163 |
| NZ | 0 | 22 |

**Caveat on `v_shortage_status_by_country`:** until migration 046 (`synthetic`)
is applied AND those recall-linker rows are backfilled `synthetic=TRUE` AND
migration 049 is re-run (to enable the now-dormant filter), the view's
`anticipated`/`active` counts INCLUDE synthetic recall-derived rows and overstate
the genuine regulator early-warning signal. Real anticipated signal today ≈ 519
(FR 245 + CA 274), growing by ~88 when the TGA `A→anticipated` fix next scrapes.

¹ **FDA forward signal lives in a different dataset.** `fda_scraper` reads the
openFDA Drug Shortages feed, which only carries Current/Resolved. FDA's
*6-month advance notification of potential disruptions* (FD&C §506C) is a
separate publication and would need a new source, not a mapping change.

² **PMDA ⑤供給停止 (supply suspended)** is treated as `active`. If a future
requirement wants "suspended-but-not-yet-out-of-stock" as forward-looking, this
is the candidate to reclassify — but only with onset evidence from the feed.

## What changed (migration 049 + scraper wiring)

> **Latent bug found & fixed:** commit `3259cf1` shipped the
> `anticipated_start_date` *write path* (base-scraper passthrough + HC emission)
> but **never added the column** — no migration defines it (migrations stopped at
> 048). Those HC upserts have been failing the unknown-column write (swallowed by
> `upsert()`'s try/except → counted as "skipped"). Migration 049 closes the gap;
> `ADD COLUMN IF NOT EXISTS` is a no-op if the column was added out-of-band.

1. `shortage_events.anticipated_start_date DATE` (nullable, no default) — the
   anticipated ONSET date, distinct from `start_date`. **No existing row is
   reclassified**; column starts NULL everywhere and the daily Health Canada
   re-scrape backfills it idempotently. Reversible (DROP COLUMN — see the DOWN
   block in the migration).
2. `base_scraper.upsert()` now passes `anticipated_start_date` through (it uses
   an explicit whitelist of optional columns).
3. `health_canada_scraper` emits `anticipated_start_date` for `anticipated`
   rows (it already parsed HC's "Anticipated start date"; it was previously
   only stashed in `raw_data`).
4. `tga_scraper` — `A → anticipated` (was `resolved`); `shortage_start` →
   `anticipated_start_date`; `estimated_resolution_date` now set for anticipated
   too. Verified against the live feed (88 records recovered). **Note:** the
   next TGA scrape will move these 88 rows from `resolved` → `anticipated` via
   the normal idempotent upsert (shortage_id is unchanged), and log the
   transition to `shortage_status_log`. This is a *correction of a mis-mapping*,
   not a destructive historical reclassification — and it self-heals on the
   next run with no migration data movement.
5. `v_shortage_status_by_country` view + `/api/shortages/status-breakdown`
   endpoint — per-country `active | anticipated | resolved | stale` counts plus
   `next_anticipated_start`, so we can see how much early-warning signal we hold.

## Open verification (do NOT change blind)

- **Other anticipated-emitting scrapers' onset dates.** `ansm`, `hsa`, `noma`,
  `sfda` emit `anticipated` but pass their only date as `start_date`. If any
  carries a *distinct* anticipated-onset field, wire it to
  `anticipated_start_date` too.

## Method (reproduce this audit)

```bash
# Status maps / mappers across all scrapers:
grep -n "_STATUS_MAP\|_map_status\|anticipated" backend/scrapers/*_scraper.py
# Canonical enum + staleness:
grep -n "status" supabase/migrations/001_initial_schema.sql
```
