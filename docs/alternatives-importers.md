# Verified alternatives: source importers

Every row of `drug_alternatives` is an automated WHO-ATC prefix pairing. Its evidence grade, score and dose note are fixed lookups, not evidence (see PR #183). Its replacement is `alternative_evidence` (migration `071_alternative_evidence.sql`): **one row per statement a source actually makes**, cited and verbatim.

The `verified_alternatives` view rates each directed pair as one of:

| Status | Meaning |
|---|---|
| `regulator_authorised` | A currently valid `regulator_legal` statement exists. |
| `verified` | Two or more distinct `publisher`s state it. |
| `single_source` | One publisher states it. It's shown with its citation, never as verified. |

## Mandatory accuracy rules (all importers)

1. Every stored value must trace to the source document. Never infer a substitution, a reverse direction, a dose or an equivalence.
2. `statement` is a verbatim excerpt, 500 chars max. `dose_statement` is set only when the source itself states a dose or conversion, verbatim.
3. Resolve `drug_id` / `alternative_drug_id` only by **exact** match of the active ingredient against `drugs.generic_name_normalised` (lowercased). Never fuzzy-match. Leave unresolved ids NULL; the raw names keep the row auditable.
4. If a document or row is ambiguous, **skip it and list it** in the run output. Don't guess.
5. Set `valid_from` / `valid_until` from the source, so expired legal instruments stop counting automatically.
6. `licence`: only what the source states, otherwise NULL.
7. Each importer must support `MEDERTI_DRY_RUN=1` (no writes; print counts and samples) and upsert idempotently on `(source_code, source_ref, drug_name_raw, alternative_name_raw, indication)`. `indication` is `''` when none is stated.
8. Before calling it done, hand-check 3 rows against the source and record which ones in the commit message.

Use `backend/importers/who_eml_alternatives_importer.py` as the template (structure, `_hash`, upsert, printout). Supabase client: `backend.utils.db.get_supabase_client`. Credentials: repo-root `.env`.

Migration 071 is **not applied to prod yet**, so only dry runs are possible until it is.

## Per-source specs

### TGA Serious Scarcity Substitution Instruments: `tga_sssi_alternatives_importer.py`

- **Source:** the table at https://www.tga.gov.au/serious-scarcity-substitution-instruments-sssis. Fetch with plain httpx (WebFetch times out).
  - Each row links to a legislative instrument on legislation.gov.au. Those pages render with JS, so use each instrument's PDF/Word version.
  - Expect about 3 current instruments (diltiazem, dapsone, estradiol) and about 23 lapsed ones.
- **One row per substitution the instrument permits:**
  - `kind='same_molecule'`, `authority_type='regulator_legal'`, `publisher='TGA'`, `source_code='tga_sssi'`, `country_code='AU'`
  - `source_ref` = instrument id
  - `drug_name_raw` = the scarce product line; `alternative_name_raw` / `alternative_product` = the substitute product line, verbatim
  - `product_ref` = the AUST R number, if given
  - `dose_statement` = the instrument's dose-equivalence text, verbatim
  - `valid_from` / `valid_until` = commencement / repeal dates

### UK Serious Shortage Protocols: `uk_ssp_alternatives_importer.py`

- **Source:** the NHSBSA SSP index page. It links signed SSP PDFs: about 8 active (SSP061–SSP089) and about 81 expired.
  - Parse each SSP's "Details of medication to be supplied under this SSP" section.
- **One row per permitted supply:**
  - `kind='same_molecule'`, `authority_type='regulator_legal'`, `publisher='DHSC'`, `source_code='uk_ssp'`, `country_code='GB'`
  - `source_ref` = the SSP number
  - `drug_name_raw` = the prescribed product; `alternative_name_raw` / `alternative_product` = the product to supply, verbatim
  - `dose_statement` = the SSP's own quantity/dose text
  - `valid_from` / `valid_until` = the SSP's start/end dates

### FDA Orange Book TE codes: `fda_orange_book_alternatives_importer.py`

- **Source:** the ZIP at https://www.fda.gov/media/76860/download. Use `Products.txt` (tilde-delimited).
- **Grouping rule:**
  - Group Rx products (Type=RX) by identical Ingredient + `DF;Route` + Strength + **identical TE_Code string**.
  - Within each group, each A-rated product (TE code starting with "A") is equivalent to the group's reference standard (RS=Yes), or to the RLD if there is no RS.
  - Never pair B-rated or unrated products.
- **One row per equivalent product:**
  - `kind='same_molecule'`, `authority_type='regulator_legal'`, `publisher='FDA'`, `source_code='fda_orange_book'`, `country_code='US'`
  - `source_ref` = Appl_Type+Appl_No+Product_No
  - `drug_name_raw` = the reference product line; `alternative_name_raw` / `alternative_product` = the equivalent product line (Trade_Name, Strength, `DF;Route`, Applicant)
  - `product_ref` = the application number
  - `statement` = the exact fields used, e.g. `TE_Code=AB; RS=…; Ingredient=…; DF;Route=…; Strength=…`
  - `licence='US Government work (public domain)'`
- **Volume:** thousands of rows, so batch the upserts.
- Don't modify `backend/scrapers/drugs_at_fda_scraper.py`.

### BfArM Alternativpräparat: `bfarm_alternatives_importer.py`

- **Source:** the CSV at https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv. It has about 935 rows; `Alternativpräparat` is filled on about 194.
  - Reuse the parse approach of `backend/scrapers/bfarm_scraper.py`, but don't modify that scraper.
- **One row per non-empty `Alternativpräparat`:**
  - `publisher='BfArM'`, `source_code='bfarm_alternativpraeparat'`, `country_code='DE'`
  - `authority_type='regulator_guidance'`: the alternative is declared by the marketing-authorisation holder and published by BfArM; it isn't a legal authorisation
  - `source_ref` = a stable notification id (check which CSV columns are stable)
  - `drug_name_raw` = the affected product; `alternative_name_raw` / `alternative_product` = the Alternativpräparat text, verbatim
  - `product_ref` = the PZN, if present
  - `statement` = `Alternativpräparat: <verbatim>` plus any verbatim note
  - `valid_from` / `valid_until` = the shortage start / expected-end dates
- **`kind`:**
  - `same_molecule` only when the affected product's Wirkstoff exactly equals the alternative's active ingredient
  - `therapeutic` only when it's clearly a different named active ingredient
  - otherwise skip the row and list it as ambiguous

### TFDA Drug Supply Information Platform: `tfda_alternatives_importer.py`

- **Source:** data.fda.gov.tw open-data feeds 104 (shortages with a recommended alternative) and 105 (no alternative), the same feeds `backend/scrapers/taiwan_tfda_scraper.py` reads.
  - Each notice's 供應狀態 text recommends substitutes and cites each one's TFDA licence number.
  - Shared parsing lives in `backend/scrapers/tfda_opendata.py`.
- **One row per (notice, cited substitute licence):**
  - `publisher='TFDA'`, `source_code='tfda_supply_platform'`, `country_code='TW'`, `authority_type='regulator_guidance'` (TFDA recommends; it doesn't legally authorise)
  - `source_ref` = the shortage product's licence; `product_ref` = the substitute's licence
  - `statement` = the verbatim notice item; `alternative_name_raw` / `alternative_product` = the verbatim segment naming the product
  - `dosage_form` comes from the licence register
- **`kind`** is decided by comparing both licences' active ingredients in TFDA's licence register (open-data set 36), salts stripped. It is never decided from product names.
  - The notice's own wording ("同成分" = same ingredient; "同藥理" / "其他成分" = different) must not contradict the register.
  - Conflicts, near-spelling pairs (epoetin alfa/beta, testosterone esters) and licences missing from the register are skipped and listed.
- **Expiry:** `valid_from` = the notice-update date. When a notice leaves 104/105, or stops citing a substitute, `valid_until` is set to TFDA's restored date from feed 106, or else to the run date.
- **Cadence:** daily at 12:20 UTC, after the scraper.
- **2026-10-26 dry run:** 381 statements (204 same-molecule, 177 therapeutic), 130 with both sides resolved, 83 skipped.
