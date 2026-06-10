# INN Resolution — molecule identity via free authoritative identifiers

**Status:** pipeline shipped (code + migration). Migration `050` must be applied
before the backfill importer can run. Scraper-side UNII crosswalk is already
live against the current schema (the `unii`/`rxcui` columns exist since `024`).

## The problem

`drugs` accumulates a separate row for every spelling of the same molecule.
Each row holds a slice of the shortage history, so brand→generic and salt→base
rollups silently fail. Observed for **atorvastatin** (live, before):

| drug row (generic_name) | active shortages |
|---|---|
| `Atorvastatin` | 78 |
| `Atorvastatina Viatris` | 15 |
| `Atorvastatin-Calcium-Trihydrat (Ph.Eur.)` | 7 |
| `Atorvastatin-Calcium-Trihydrate` | 5 |
| `Atorvastatin Calcium Tablets` | 3 |
| …9 more salt/form/language variants | ~7 |

14 rows, one molecule. A pharmacist viewing `Atorvastatin` saw 78 active
shortages; the true molecule total is **115 active / 188 all-time**.

Root causes:
1. Resolution was pure string-matching on `generic_name_normalised` + a
   first-word prefix fallback. No salt stripping, no identifier crosswalk.
2. Salt qualifiers (`(as calcium trihydrate)`, `sodium`, `-Calcium-Trihydrate`)
   produced distinct normalised keys → distinct rows.
3. Foreign spellings (`Atorvastatina`, `Atorvastatinkalsiumtrihydrat`) and brand
   names stored as their own rows (`Gazyva`) never folded into the INN.
4. FDA `openfda.rxcui` / `substance_name` were parsed into `raw_record` but never
   used; `openfda.unii` was not parsed at all.

## Current per-country ingredient mapping (as inspected)

| Source | Active-ingredient field | Identifiers captured | Normalisation |
|---|---|---|---|
| FDA (`fda_scraper`) | `generic_name` + `openfda.substance_name` | rxcui ✓, **unii now ✓**, substance_name ✓ | dosage-form strip + (now) UNII crosswalk |
| France (`ansm`) | DCI / `substance active` (bracketed) | — | bracket extraction |
| Canada (`health_canada`) | first of `Ingredients` (`;`-split) | atc in notes | first-ingredient only |
| Belgium (`belgium_famhp`) | `activeSubstancesLong*` (JSON) | atc in notes | JSON parse |
| Singapore (`hsa`) | `Active Ingredient(s)` | — | title-case |
| EMA (`ema`) | INN aliases / medicine name | — | multi-field fallback |
| Japan (`pmda`) | CSV column | — | title-case |
| All others | `generic_name` | — | `base_scraper` string match |

The shared resolution chokepoint is `base_scraper._find_or_create_drug`; fixing
it (UNII-aware) lifts every shortage scraper at once.

## The fix — molecule identity keyed on UNII

Every ingredient string resolves to: **INN + RxNorm CUI + UNII + ATC**, using
only free authoritative services:

```
raw string
  → inn_normalize.normalise()            strip salt/hydrate/dosage/strength/maker noise
  → RxNav get_rxcui (search=2)           name → RxCUI                 (rxnav.nlm.nih.gov)
  → RxNav get_rxcui_approx (fallback)    foreign brand → US concept   (e.g. Gazyvaro→Gazyva)
  → RxNav get_base_ingredient (tty=IN)   salt/brand → base ingredient = INN
  → RxNav get_unii (UNII_CODE)           base RxCUI → UNII
  → UNII registry get_unii_by_name       fallback when RxNorm lacks UNII (heparin, mAbs)
                                          (gsrs.ncats.nih.gov — FDA SRS / fdasis)
  → RxNav get_atc_code                   ATC class
```

Rows sharing a UNII are the same molecule. Variant rows point
`drugs.canonical_drug_id` at the single canonical INN head so the application
layer aggregates across them (`molecule_rollup` view).

### Confidence & the review queue

- **high** → RxCUI found, single base ingredient, INN text-consistent (or an
  approximate match independently confirmed by the UNII registry). Auto-applied.
- **medium / low** → combination product, no RxCUI, INN mismatch, or
  unconfirmed approximate match → written to **`drug_resolution_review`** for a
  human. The pipeline never guesses.

## Components

| File | Role |
|---|---|
| `backend/utils/inn_normalize.py` | salt/hydrate/dosage/strength/maker stripping (shared) |
| `backend/importers/rxnorm_client.py` | RxNav: `get_rxcui`, `get_rxcui_approx`, `get_base_ingredient`, `get_unii`, `get_atc_code` |
| `backend/importers/unii_client.py` | UNII registry (GSRS/SRS) name→UNII fallback |
| `backend/importers/substance_resolver.py` | orchestrates the chain → INN/RxCUI/UNII/ATC + confidence |
| `backend/importers/inn_resolution.py` | backfill importer: auto-apply / roll up / queue review (dry-run default) |
| `backend/scrapers/fda_scraper.py` | extracts `openfda.unii` (single-substance only) + surfaces rxcui/substance_name |
| `backend/scrapers/base_scraper.py` | UNII crosswalk + identifier backfill in `_find_or_create_drug` |
| `supabase/migrations/050_inn_resolution.sql` | `canonical_drug_id`, `resolved_inn`, crosswalk indexes, `drug_resolution_review`, `molecule_rollup` view |
| `scripts/validate_inn_rollup.py` | before/after rollup harness (read-only) |

## Running it

```bash
# 1. Apply the migration (via your Supabase migration flow — CLI / dashboard / CI)
supabase/migrations/050_inn_resolution.sql

# 2. Dry-run (default) — see decisions without writing
python3 -m backend.importers.inn_resolution --like 'atorvastatin*'

# 3. Apply, scoped to a molecule first (dry-run → verify → execute, per house rule)
python3 -m backend.importers.inn_resolution --like 'heparin*' --execute

# 4. Full backfill of unresolved rows
python3 -m backend.importers.inn_resolution --missing-unii --execute

# Validate before/after rollup (read-only)
python3 -m scripts.validate_inn_rollup atorvastatin heparin obinutuzumab
```

## Validation — before / after rollup (live)

| Molecule | UNII | Before (fragmented) | After (rolled up) | To review |
|---|---|---|---|---|
| **atorvastatin** | `A0JWA85V8F` | 14 rows; head showed **78** active | 1 molecule, **115 active / 188 total** | 3 combos (atorvastatin+ezetimibe) |
| **heparin** | `T2410KM04A` (registry fallback — RxNorm had none) | 7 rows; `Heparin` head had **0** | 1 molecule, **11 active / 16 total** | heparin/lido combos, "heparin pork", protamine |
| **obinutuzumab** | `O43472U9X8` | brand `Gazyva` was a separate 0-shortage row, unlinked | `Gazyva` (AU) **and** `Gazyvaro` (EU) both resolve to obinutuzumab | mangled packaging-string row |

The biologic case proves brand divergence handling: **Gazyva** resolves via
RxNorm directly; **Gazyvaro** (EU-only, absent from US RxNorm) resolves via
`approximateTerm` and is confirmed high-confidence by an independent UNII-registry
lookup — both land on the same molecule `O43472U9X8`.

## Known limitations / follow-ons

- Persisting the rollup needs migration `050` applied; until then `validate_inn_rollup`
  computes it in-memory from live resolution (no writes).
- The application layer (`/api/drugs/[id]`, search) still reads per-row; wiring it
  to `molecule_rollup` / `canonical_drug_id` is the remaining step to surface the
  rolled-up numbers to users.
- `base_recall_scraper` has its own `_find_or_create_drug`; the UNII crosswalk was
  added to the shortage `base_scraper` only. Mirroring it for recalls is a
  follow-on.
- Combination products are deliberately never auto-collapsed — they queue for review.
