# Mederti — Production Launch Runbook (mederti.com + mederti.ai)

Steps that must run in dashboards (Supabase, Vercel, DNS, Railway) — the parts
Claude can't execute from the repo. Pairs with the code fixes in PR #122.

**Project refs**
- Supabase project: `mleblwjozjvpbuztggxp` → `https://mleblwjozjvpbuztggxp.supabase.co`
- Vercel project: the `mederti` Next.js app (currently `mederti.vercel.app`)
- Recommended canonical: **`mederti.com`** primary, **`mederti.ai`** 301-redirects to it.
  (Pick one — split only if `.ai` will host a distinct product surface later.)

Work top to bottom. Each section has a ✅ check you can run to confirm it's done.

---

## 0. Pre-flight: get a known-good build/deploy state

- [ ] Merge PR #122 (`fix/launch-blockers`).
- [ ] In the dev tree `frontend/`, run `npm install` — `node_modules` there is stale
      (`posthog-js` is in `package.json` but not installed; a local build will fail until you do).
- [ ] Confirm Vercel is building from `main` and the latest deploy is green.

---

## 1. DNS + Vercel custom domains

### 1a. Add domains in Vercel
Vercel → Project → **Settings → Domains**:
- [ ] Add `mederti.com`
- [ ] Add `www.mederti.com` (set to redirect → `mederti.com`)
- [ ] Add `mederti.ai`
- [ ] Add `www.mederti.ai`
- [ ] Set **`mederti.com` as the Primary Domain**. Configure `mederti.ai`
      (and both `www`) to **Redirect to `mederti.com`** (308/permanent).

### 1b. DNS records (at each registrar)
Use whatever Vercel's Domains panel shows for your setup. Typical:

| Host | Type | Value |
|---|---|---|
| `mederti.com` (apex) | `A` | `76.76.21.21` *(use the IP Vercel shows)* |
| `www.mederti.com` | `CNAME` | `cname.vercel-dns.com` |
| `mederti.ai` (apex) | `A` | `76.76.21.21` *(use the IP Vercel shows)* |
| `www.mederti.ai` | `CNAME` | `cname.vercel-dns.com` |

> If your DNS provider supports ALIAS/ANAME/flattening at the apex, prefer that
> CNAME-style target over a raw A record.

- [ ] Wait for Vercel to show **Valid Configuration** + issued SSL on all four.

✅ **Check:**
```bash
curl -sI https://mederti.com | grep -i "HTTP/\|strict-transport"
curl -sI https://mederti.ai  | grep -i "HTTP/\|location"   # expect 308 → https://mederti.com
```

---

## 2. Environment variables (Vercel → Settings → Environment Variables, Production)

The code is ready for all of these; most are inert until set.

| Variable | Value / source | Why it matters |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://mederti.com` | **Required** — canonical URLs, OG/Twitter, sitemap, email links. Without it, metadata falls back to the Vercel URL. |
| `CRON_SECRET` | a long random string | `/api/cron/generate-intelligence` **fails closed (503) without it** — set it or daily intelligence won't generate. |
| `ANTHROPIC_API_KEY` | Anthropic key | `/api/chat` + intelligence generation. Without it, chat degrades to rule-based. |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (frontend) | Frontend error monitoring (else zero visibility). |
| `SENTRY_DSN` | Sentry DSN (server) | Server/route + backend errors. |
| `UPSTASH_REDIS_REST_URL` | Upstash | Real cross-region rate limiting. Without it, limiter silently uses per-instance in-memory (≈ no protection). |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | as above |
| `RESEND_API_KEY` | Resend | Transactional email (contact, enquiry, alerts). |
| `RESEND_FROM_EMAIL` | `intelligence@mederti.com` | From address (must be a verified Resend domain — see §4). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | existing | server data path (confirm present). |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing | browser SSR client. |

- [ ] Set all of the above for **Production** (and Preview where it makes sense).
- [ ] **Redeploy** after setting (env changes need a new build to take effect).

✅ **Check (`NEXT_PUBLIC_SITE_URL` landed):**
```bash
curl -s https://mederti.com | grep -o 'property="og:url" content="[^"]*"'
# expect https://mederti.com..., NOT vercel.app
curl -s https://mederti.com/sitemap.xml | head -5   # URLs should be mederti.com
```

---

## 3. Supabase — verify RLS migrations are actually live (migration drift)

Migrations were applied manually via the dashboard, so 047 (anon revoke) and
028 (is_admin lock) **cannot be assumed live**. Verify both.

### 3a. Migration 047 — anon cannot bulk-read via PostgREST
Run with the **anon** key (the public `NEXT_PUBLIC_SUPABASE_ANON_KEY`):
```bash
ANON="<NEXT_PUBLIC_SUPABASE_ANON_KEY>"
curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "https://mleblwjozjvpbuztggxp.supabase.co/rest/v1/drugs?select=id&limit=1"
```
- ✅ **PASS** if it returns `permission denied for table drugs` (or empty `[]` with 401/403).
- ❌ **FAIL** if it returns drug rows → **047 not applied**. Apply it in the SQL editor:
  `supabase/migrations/047_revoke_anon_postgrest_access.sql`. Repeat for
  `shortage_events`, `recalls`, and a couple of the tables added after 047
  (e.g. `parallel_trade_*` once that migration lands) — Supabase default grants
  can re-open `anon` on newly-created tables.

### 3b. Migration 028 — users cannot self-promote to admin
In the SQL editor (as `postgres`):
```sql
SELECT grantee, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='user_profiles' AND column_name='is_admin'
 ORDER BY grantee;
```
- ✅ **PASS** if `authenticated` and `anon` have **no UPDATE/INSERT** on `is_admin`.
- ❌ **FAIL** if `authenticated` has UPDATE → apply `supabase/migrations/028_*.sql`.

Live behavioural check (as a normal signed-in user's JWT):
```bash
USER_JWT="<a logged-in non-admin user's access token>"
curl -s -X PATCH -H "apikey: $ANON" -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  "https://mleblwjozjvpbuztggxp.supabase.co/rest/v1/user_profiles?user_id=eq.<their-uid>" \
  -d '{"is_admin":true}'
```
- ✅ **PASS** if `403` / code `42501`. ❌ **FAIL** if it returns the row with `is_admin:true`.

### 3c. Quick pass over other drift-prone migrations
Confirm these are live (app code already depends on them): **029** (RLS enable),
**030** (supplier_inventory WITH CHECK), **040** (regulatory_eligibility),
**050** (inn_resolution), **051** (who_essential_medicines), **052** (entity_type),
**053** (search_suggestion_fuzzy), **055/056** (pricing). A fast probe is to hit the
feature that uses each (e.g. `/api/search` filters, drug-page eligibility) and
confirm no PostgREST `PGRST205 table not found` errors in logs.

---

## 4. Email deliverability (Resend) for @mederti.com

All transactional mail sends from `@mederti.com`. The domain must be verified in
Resend or mail lands in spam / is rejected.

- [ ] In Resend, add + verify the `mederti.com` domain.
- [ ] Add the **SPF**, **DKIM**, and a **DMARC** record Resend provides to DNS.
- [ ] Confirm `RESEND_FROM_EMAIL` uses a verified address.

✅ **Check:** send a test (e.g. submit `/contact`) and confirm delivery + that the
message passes SPF/DKIM (view "show original" in Gmail).

---

## 5. Scrapers — commit to one always-on runner

Today there are two divergent definitions (Mac cron + Railway) and neither is
verified reliable; the Mac sleeps (= downtime + a visibly stale public
`/freshness` page), and the root `railway.toml` still starts the legacy
crash-looping FastAPI.

- [ ] **Choose Railway** (always-on) as canonical for launch.
- [ ] Regenerate the Railway `run.py` scraper lists from `cron/crontab_fixed.txt`
      (the source of truth) — they have drifted — or have Railway invoke
      `run_all_scrapers.py` directly instead of a parallel hardcoded list.
- [ ] **Set env vars on every Railway service** (`SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`, `OPS_ALERT_EMAIL`). The
      documented failure was `shortage-cron-daily` never succeeding — almost
      certainly missing env vars.
- [ ] Add the new **`run_mark_stale.py`** job (PR #122 adds it to the Mac crontab;
      mirror it on Railway — daily ~07:00 UTC).
- [ ] Add the **`backend/health/daily_check.py`** digest to Railway (it currently
      only runs from Mac cron — migrating without it kills the only failure alert).
- [ ] Delete / repoint the crash-looping FastAPI service (root `railway.toml`).
- [ ] Keep Mac cron as backup until Railway is verified for ~48h; then retire it.

✅ **Check:** after a full cycle, `https://mederti.com/api/freshness` shows recent
`last_scraped_at` per regulator (no widespread "stale"). Set `OPS_ALERT_EMAIL`
and confirm the daily digest email arrives.

---

## 6. Monitoring + dead-man's-switch

- [ ] Confirm Sentry receives events (frontend + server) after DSNs are set —
      trigger a test error and see it land.
- [ ] Add an external uptime monitor (e.g. cron-monitor / BetterStack) hitting
      `https://mederti.com/api/freshness` every ~15 min, alerting if it 5xx's or
      reports all sources stale — catches a fully-dead runner even if the digest
      itself doesn't run.

---

## 7. Go-live smoke test (run against https://mederti.com)

- [ ] Home loads; live stats render (no vercel.app in page source / OG tags).
- [ ] `/search?q=amoxicillin` returns results; a drug page renders with real data.
- [ ] `/freshness` shows recent timestamps.
- [ ] `/sitemap.xml` and `/robots.txt` resolve and reference `mederti.com`.
- [ ] Sign up → confirm email → land logged-in (PKCE callback works on the new domain;
      check Supabase Auth **Redirect URLs** include `https://mederti.com/auth/callback`).
- [ ] Submit `/contact` → email delivered.
- [ ] `/api/chat` returns a Claude (not rule-based) answer → confirms `ANTHROPIC_API_KEY`.
- [ ] `mederti.ai` 308-redirects to `mederti.com`.
- [ ] Anon PostgREST bulk-read is blocked (re-run §3a).

> **Supabase Auth note:** add `https://mederti.com` (and `https://mederti.ai` if
> kept) to Supabase → Authentication → URL Configuration → **Site URL** +
> **Redirect URLs**, or signup/magic-link/OAuth will bounce on the new domain.

---

## Appendix — items deferred (not launch-blocking)
- Rate-limit XFF spoof hardening (`lib/chat/rate-limit.ts`) + add limits to
  `detect-columns`, `contact`, `lead`, `subscribe`.
- Generic 500 messages (stop leaking raw Supabase `error.message` in ~20 routes).
- Gate the parallel-trade `recalculate` route when that module merges to main.
- Reconcile scrapers the playbook calls "quarantined" but cron still runs
  (`china_nmpa`, `turkey_titck`, `poland_mz`, `hk_drugoffice`).
- Build hygiene: set `turbopack.root` / remove duplicate `package-lock.json`;
  rename `middleware` → `proxy` (Next 16 deprecation).
</content>
