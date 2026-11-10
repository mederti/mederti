# Search & AI discoverability: audit, changes, plan

Branch `feat/search-ai-discoverability`, 2026-11-11. This doc covers the audit, what changed, the steps that need a human, and the proposed public API and measurement plan.

## 1. Audit (before this branch)

Much of the brief was already built (PR #163 SEO layer, #178 Edge/Bing + IndexNow, #199 AI-citation tracking, #214 OG cards, #243/#251 medicine/country landing pages).

| Area | State found |
|---|---|
| Framework | Next.js 16 App Router, React 19, Vercel. Public pages are server components with ISR (`revalidate = 3600`) that query Supabase directly, so all content is in the initial HTML with no client fetch needed. |
| Public medicine URLs | `/medicine/{slug}` (slug derived from `generic_name`). The product page `/drugs/{uuid}` is metered/login-gated and disallowed in robots. Both are deliberate CEO decisions and stay unchanged. |
| Country URLs | `/country/{country}/medicine-shortages` registers plus `/regulator/{abbr-cc}`. |
| **Gap: medicine × country** | No `/medicine/{slug}/{country}` page, so "X shortage in Australia" queries had no matching URL and no per-notice product/formulation detail. |
| Index gate | `isIndexableDrug()` requires ≥1 event, an RxCUI or ATC code, and a clean slug. It is applied identically in the sitemap and in `robots` meta. About 3,100 medicines pass. |
| Sitemap | Dynamic `app/sitemap.ts`. **Issues:** every name in `COUNTRY_NAMES` was listed, including countries with zero rows (thin pages). `lastModified` was `new Date()` or `drugs.updated_at`, neither of which reflects data freshness. |
| robots.txt | Gated paths disallowed; AI crawlers welcome on public paths. **Gap:** the current answer-time agents (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `Perplexity-User`) weren't named. They were allowed via `*`, so nothing was blocked, but the policy wasn't explicit. |
| Structured data | Organization + WebSite (layout), Drug + WebPage + BreadcrumbList + FAQPage (medicine), Dataset (country). **Defect:** shortages were emitted as schema.org `MedicalCondition` nodes with invented `status`/`severity` properties, plus `isProprietary: false` for controlled substances. That is invalid and misleading markup. |
| Source attribution | Present per country row. The summary didn't name regulators or a verification date. |
| "No shortage" vs "no data" | **Not distinguished.** The global page listed only countries with active notices; silence was ambiguous. |
| Demo vs live data | **Homepage product mock-up was unlabelled.** It showed amoxicillin "Critical shortage · verified 3h ago", "2 suppliers", "96% match · in stock" and "3 prior shortages (2018, 2021, 2023)" as plain crawlable text. |
| llms.txt | **Inflated figures:** "50+ countries", "55,000+ events (40,000+ active)", "24,000+ recalls". These contradict `COVERAGE_COPY` (35+ countries) and the post-dedupe data. |
| Soft 404s | Unknown `/medicine/*` and `/country/*` return HTTP 200 + `noindex` (root `app/loading.tsx` streams before `notFound()`). Pre-existing on prod; acceptable to Google but not ideal. |
| Entity fragmentation | **Largest remaining risk.** Amoxicillin notices are split across "Amoxicillin", "Amoxicillina", "Amoxicillinum", "Amoxicillin-Trihydrate" etc. That causes near-duplicate indexable pages and per-record facts that understate where a molecule is short. `canonical_drug_id` exists but is contaminated (combos mapped to mono). See §6. |

## 2. Implemented

1. **`/medicine/{slug}/{country}`** (`app/medicine/[slug]/[country]/page.tsx`): one medicine in one jurisdiction.
   - A deterministic "Current shortage summary" built only from stored records: counts, regulator names, last-verified date, estimated resolution dates still ahead, and a count of notices whose estimate has passed.
   - A status/jurisdiction/regulator/last-verified fact list.
   - A per-notice table: product (regulator's own string, or "Ingredient-level notice"), normalised form, status, start, estimated resolution ("Date passed; still listed" when lapsed), source link, verified date.
   - A resolved-history table, links to other countries, the global page and the country register, status definitions, and an independence/not-clinical-advice disclaimer.
   - A staleness warning when the source hasn't been re-verified in 30+ days (e.g. Health Canada, blocked since Sep).
   - Indexed only when the medicine passes the gate **and** the country has ≥1 open notice (`isIndexableCountryView`). Otherwise `noindex, follow`.
2. **Global medicine page** (`/medicine/{slug}`):
   - A deterministic summary naming regulators and the last-verified date.
   - Country names now link to the country view.
   - A new "status in other countries" section: anticipated / resolved-only / *covered but no notice linked to this record* / *data unavailable*, with stale sources flagged.
   - Status definitions, a stronger independence disclaimer, and deduplicated history.
3. **Coverage truth** (`trackedCountries()` in `lib/pseo.ts`): countries with ≥1 real shortage row, plus latest verification, cached 6h. It drives the no-notice vs unavailable split, country-register `noindex` for zero-data countries, and sitemap country entries.
4. **Sitemap:** adds about 5,400 medicine × country URLs (open notices only, same gate as the page). Country entries are limited to countries with data. `lastModified` now comes from source verification (`last_verified_at`). Total about 8,600 URLs (single file, under the 50k limit). The open-pair scan is cached 6h and fetched 5 pages in parallel.
5. **Structured data:** removed the invalid `MedicalCondition` shortage nodes and the bogus `isProprietary`. `WebPage` now carries `publisher` (Mederti), `dateModified`, `isBasedOn` (official notice URLs, so regulators are cited, never as author or endorser) and `about`/`mainEntity` → `Drug`.
6. **robots.txt:** answer-time AI agents named explicitly. Training crawlers are kept in a separate group with unchanged (allowed) policy; see §5 for the open decision.
7. **Homepage demo:** a visible "Illustrative example of the product. Not live shortage data." note. `data-nosnippet` is set on the mock-up and the illustration tiles so search/AI snippets don't quote sample data. The design is unchanged.
8. **llms.txt:** figures aligned to `COVERAGE_COPY`. Added the new URL pattern, the status vocabulary, the independence statement, and the illustrative-data note.
9. Refactor: the product/form parser moved from the episodes API route to `lib/event-product.ts` (shared, behaviour unchanged).

Example URLs (live after deploy):
- `/medicine/amoxicillin/canada` (indexed: 10 active + 1 anticipated HC notices)
- `/medicine/amoxicillin` (global, 7 countries)
- `/medicine/amoxicillin/australia` (`noindex`: resolved history only for this record)
- `/medicine/semaglutide/united-kingdom` (`noindex`: no notice linked)

## 3. Verified locally (dev server against prod data)

- Pages render server-side, with the summary, tables and JSON-LD present in the raw HTML (curl, Googlebot UA). No horizontal overflow at 375px.
- `robots` meta matches the gate on each example above. The country register is `noindex` for Lithuania (0 rows) and Israel (unknown), and indexable for Australia.
- JSON-LD parses; the graph is Drug + WebPage(publisher, isBasedOn), plus BreadcrumbList.
- `/sitemap.xml`: 8,618 unique URLs, about 8s cold (then cached). `/robots.txt` groups as intended.
- `/api/drugs/{id}/shortage-episodes` unchanged after the refactor. `tsc` and ESLint are clean on the touched files.
- **Vercel preview (2026-11-11):** both builds pass. Pages, sitemap (8,624 URLs), robots and llms.txt match local. Rich Results Test on `/medicine/amoxicillin/canada`:
  - Breadcrumbs ✅ and Organisation ✅ are valid.
  - "Crawl failed" is only Vercel's `X-Robots-Tag: noindex` on preview deployments.
  - **Product snippets: 1 invalid item.** Google treats schema.org `Drug` as a `Product` and wants `offers`/`review`/`aggregateRating`. This has been the case on prod since Aug (not introduced here). Fixing it would mean fabricating commercial data, so it's left as is: the item is just ineligible for a product rich result. Indexing is unaffected, but expect this error in Search Console's Product snippets report.
- **Not verified:** Search Console on the production URL.

## 4. Deployment and registration steps (human)

1. Merge the PR; Vercel deploys.
2. Vercel env (carried over from earlier PRs, still outstanding per memory): trim the trailing newline from `NEXT_PUBLIC_SITE_URL`; set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION` and `INDEXNOW_KEY`.
3. Google Search Console: verify `https://www.mederti.com`, submit `/sitemap.xml`, then URL-inspect `/medicine/amoxicillin/canada` and request indexing.
4. Bing Webmaster Tools: import from GSC and submit the sitemap. Then trigger `/api/cron/indexnow?all=1` once (it pushes the new URLs to Bing/Yandex/Seznam; Bing also feeds Copilot).
5. Run Google's Rich Results Test and the Schema.org validator on one medicine and one medicine × country URL.
6. Re-run the AI benchmark (§7) about 4 weeks after indexing.

## 5. Decisions for the CEO

- **AI training crawlers** (GPTBot, ClaudeBot, Google-Extended, CCBot): currently allowed on public pages only. Allowing them aids brand/entity recall in model answers; blocking them protects the public summary data from training use. Gated product data is unaffected either way. One-line change in `app/robots.ts`.
- **/methodology** is public but deliberately unlisted. Linking it from medicine pages and adding it to the sitemap would strengthen E-E-A-T and AI trust signals.
- Homepage heading "Track and **forecast** the world's shortages" conflicts with the finding that the forecast backtest failed (memory: show facts, not risk). Consider rewording.

## 6. Outstanding issues and recommendations (priority order)

1. **Molecule entity consolidation.** One INN should have one public URL. Make `resolved_inn` and `canonical_drug_id` trustworthy (exclude combos), then 301 salt/language variants (`amoxicillina`, `amoxicillin-trihydrate`) to the INN page and aggregate their notices. This is the biggest win for both accuracy and ranking (it removes near-duplicates and consolidates signals). Until then, negative claims are scoped to "this medicine record" with a caveat.
2. **Combination products linked to mono records** (e.g. APO-AMOXY/CLAV under Amoxicillin in AU). This is data linkage, not presentation.
3. **True 404s** for unknown slugs: move the root `loading.tsx` under the app-shell group, or validate country slugs in `proxy.ts`.
4. **Freshness dashboard / methodology** as public pages, linked site-wide.
5. **Health Canada source** blocked since Sep: pages now warn, but the fix is the API account (memory: `e1-stale-sources`).
6. Sitemap index (`generateSitemaps`) once URLs approach about 40k.

## 7. Measurement

**Existing:** `.github/workflows/seo-weekly.yml` (Mondays) runs `scripts/seo_weekly_report.py` and `scripts/seo_ai_visibility.py`. It reports PageSpeed, AI citation checks (Claude + optional OpenAI/Perplexity) and AI-assistant referrals from Vercel Web Analytics (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com referrers). It needs repo secrets that are still unset: `ANTHROPIC_API_KEY`, `PSI_API_KEY`, `VERCEL_ANALYTICS_TOKEN`, optionally `OPENAI_API_KEY`/`PERPLEXITY_API_KEY`.

| Metric | Source |
|---|---|
| Index coverage, crawl errors, queries, impressions/clicks per page | Google Search Console + Bing Webmaster Tools (Performance and Pages reports; filter URL contains `/medicine/`) |
| Medicine-page traffic | Vercel Web Analytics / PostHog (consent-gated) by path prefix |
| AI referrals | Referrer host (above). ChatGPT also appends `utm_source=chatgpt.com`. |
| AI citations | Weekly benchmark (below). Conventional analytics **cannot** see citations that produce no click, or answers given without browsing. |

**Benchmark:** `scripts/seo_ai_prompts.json`, now 20 fixed questions (10 original plus 10 added 2026-11-11 across AU/UK/EU/US/FR). The baseline before this branch deploys is in `docs/seo/ai-benchmark-baseline-2026-11-11.json`.

**Baseline (2026-11-11, Claude + web search, 20 questions): 0 cited, 0 retrieved, 0 mentioned, 20 absent.** The searches surfaced official regulators (apps.tga.gov.au, cas.mhra.gov.uk, ansm.sante.fr, bfarm.de, aifa.gov.it, ema.europa.eu), ASHP, pharmacy bodies (cpe.org.uk, abda.de), news (abc.net.au, cbc.ca) and trackers (medfinder.com, mobidoctor.eu, drugshortagescanada.ca). ChatGPT/Perplexity weren't checked (no keys). Re-run with:

```bash
ANTHROPIC_API_KEY=… python3 -c "import sys,json;sys.path.insert(0,'scripts');import seo_ai_visibility as m;print(json.dumps(m.citation_check(),indent=1))"
```

## 8. Public read-only API (design only; not built)

Don't expose the internal `/api/*` routes (service-role backed, shaped for the UI, rate-limited per IP). Build a separate, versioned surface:

- **Endpoints:** `GET /api/public/v1/medicines?q=&atc=` · `GET /api/public/v1/medicines/{inn-slug}` (global rollup, per-country status, `last_verified_at`) · `GET /api/public/v1/shortages?country=AU&status=active&updated_since=` (cursor paging) · `GET /api/public/v1/sources` (regulator, cadence, last success).
- **Contract:** every record carries `status` (the vocabulary above), `regulator`, `source_url`, `published_date`, `retrieved_at`/`last_verified_at`, `data_quality_flags` (stale source, ingredient-level, lapsed estimate), and `attribution` text. Never expose `raw_data` or synthetic rows.
- **Auth:** API keys (hashed, in `api_keys`), scoped tiers. Optionally an anonymous tier of summary-only fields with a low quota for AI agents and researchers.
- **Rate limiting:** per key, token bucket (Upstash/Vercel KV); 429 with `Retry-After`; responses cacheable at the edge (`s-maxage=3600`).
- **Data licensing:** facts from regulators are public, but the normalisation, linkage and history are Mederti's work. Proposal: CC BY 4.0 for the summary tier (citation required: "Mederti, based on {regulator}"), and a commercial licence for bulk/history/product-level data and SLAs.
- **Freshness:** `last_verified_at` per record plus `/sources` health; `ETag`/`Last-Modified`; a webhook or `updated_since` for change feeds.
- **Agent surfaces:** an OpenAPI spec at `/api/public/v1/openapi.json`, linked from `llms.txt`. An MCP server wrapping the same endpoints is a natural follow-on for Claude/ChatGPT integrations.
- **Commercial:** free summary tier → paid institutional tier (hospital procurement, wholesalers, EHR/pharmacy software vendors, researchers) → enterprise data licence.
- **Prerequisite:** entity consolidation (§6.1). Otherwise API consumers inherit the fragmented records.
