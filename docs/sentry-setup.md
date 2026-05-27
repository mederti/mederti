# Sentry setup — frontend + Python scrapers

The Sentry scaffold is already in the repo (Sprint 1 of [`architecture-audit.md`](architecture-audit.md), closes FINDING-O10-01). It's inert until DSN env vars are set. This doc is what Rob needs to do to make it live.

## What's already wired

### Frontend (`@sentry/nextjs`)

| File | Purpose |
|---|---|
| `frontend/instrumentation.ts` | Boots Node + Edge Sentry; forwards Route Handler errors via `captureRequestError` |
| `frontend/instrumentation-client.ts` | Boots browser Sentry; exports `onRouterTransitionStart` for navigation traces |
| `frontend/sentry.server.config.ts` | Node-runtime init (most route handlers) |
| `frontend/sentry.edge.config.ts` | Edge-runtime init (middleware + `/api/og/*`) |
| `frontend/app/global-error.tsx` | Root error boundary that reports to Sentry and renders a fallback UI |
| `frontend/next.config.ts` | Wrapped with `withSentryConfig(nextConfig, {...})` |

### Backend (`sentry-sdk`)

| File | Purpose |
|---|---|
| `backend/utils/sentry.py` | `init_sentry(component)` helper |
| `run_all_scrapers.py` | Calls `init_sentry("run-all-scrapers")` |
| `cron/run_shortage_scrapers.py` | Calls `init_sentry("shortage-scrapers")` |
| `cron/run_recall_scrapers.py` | Calls `init_sentry("recall-scrapers")` |
| `backend/requirements.txt` | Adds `sentry-sdk>=2.0,<3.0` |

## Rob action — to make it live (~10 minutes)

### 1. Create the Sentry project (if not done)

1. Go to https://sentry.io → New Project
2. Platform: **Next.js**
3. Project name: `mederti-frontend`
4. Copy the **DSN** (looks like `https://...@...ingest.sentry.io/...`)
5. Repeat for **Python** platform; name `mederti-scrapers`. Copy that DSN too.

### 2. Set Vercel env vars (frontend)

In the Vercel project dashboard → Settings → Environment Variables, add:

| Key | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | DSN from `mederti-frontend` | Production + Preview |
| `SENTRY_DSN` | Same DSN | Production + Preview |
| `SENTRY_ORG` | Your Sentry org slug | Production + Preview |
| `SENTRY_PROJECT` | `mederti-frontend` | Production + Preview |
| `SENTRY_AUTH_TOKEN` | Auth token with `project:releases` scope ([create here](https://sentry.io/settings/account/api/auth-tokens/)) | Production only |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Production (optional; default 0.1) |

Note: `SENTRY_AUTH_TOKEN` is what unlocks **source-map upload at build time**. Without it, errors will still report but with unreadable minified stacks. With it, you get original source mappings in Sentry.

### 3. Set Railway env vars (Python scrapers)

In each Railway scraper service (`shortage_cron_daily`, `shortage_cron_frequent`, `recall_cron`, etc.), Settings → Variables:

| Key | Value |
|---|---|
| `SENTRY_DSN` | DSN from `mederti-scrapers` |
| `SENTRY_ENVIRONMENT` | `production` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.05` (optional; default 0.05) |

### 4. Verify

**Frontend:** trigger a deliberate error in dev:

```bash
curl http://localhost:3000/api/_sentry-test  # or visit /api/_sentry-test
```

If you need a test endpoint, the `@sentry/wizard` install typically creates `/sentry-example-page` and `/api/sentry-example-api`; failing those, throw from any route and check Sentry's Issues dashboard within ~60 s.

**Backend:** run a scraper with a forced exception in dev:

```bash
SENTRY_DSN=<paste> python3 -c "
from backend.utils.sentry import init_sentry
init_sentry('manual-test')
raise RuntimeError('Sentry smoke test')
"
```

Check Sentry within ~60 s. If you see `component=manual-test` tag on the event, the integration is healthy.

### 5. Enable alert rules (Sentry dashboard)

Recommended starter rules:

- **All new issues** → email `ops@mederti.com` (or Slack channel)
- **Issue regresses** → same channel
- **Error rate > 5%** for 5 min → email + page on-call
- Per-route alert thresholds: `/api/chat` is the highest blast-radius — alert on any 5xx within 1 min.

## What you'll see once live

- Every Next.js Route Handler unhandled error → Sentry issue with route path, method, headers (no body by default).
- Every browser JS error → Sentry issue with breadcrumbs, source map decoded.
- Every scraper exception → Sentry issue tagged `component=<entry-point>`.
- Every `log.error(...)` in Python that isn't caught becomes a Sentry event (via `LoggingIntegration`).
- Source-map decoded stacks if `SENTRY_AUTH_TOKEN` is set.

## Why the scaffold is inert by default

`@sentry/nextjs` and `sentry-sdk` both gate their init on a non-empty DSN. Without it, every Sentry call is a no-op — no network traffic, no overhead, no leaked PII. This means the Sprint 1 PR can land before the Sentry project is provisioned without risk.

## Cost

Sentry's Team plan is $26/mo for the first 50k events; Mederti's current scale (one scraper run / 4h, ~30 chat sessions/day) will sit well under that. The 10% trace sample on the frontend keeps performance event volume linear with traffic.

## Removing source-map exposure

`hideSourceMaps: true` in `next.config.ts` keeps the `.map` files server-side only — they're uploaded to Sentry for unminification but don't ship in the public bundle. This is the standard production setup; flip to `false` only when debugging a specific browser issue.
