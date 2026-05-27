# Uptime monitor setup

Closes audit FINDING-O10-03 — no uptime monitor exists in the repo. Vercel only notifies you when the deploy itself fails; it does not notify when `/api/search` starts returning 500s.

## Recommendation: Better Stack (free tier)

Better Stack (formerly Better Uptime) gives 10 monitors free with 3-min check intervals and a single status page. That's enough to cover Mederti's hot endpoints. Alternatives: UptimeRobot (50 monitors free, 5-min checks), Checkly (more powerful but paid), Pingdom (paid).

## Monitors to set up

In Better Stack → New monitor, set up these 5:

| Name | URL | Check type | Expected response | Frequency |
|---|---|---|---|---|
| Landing | `https://mederti.vercel.app/` | HTTP(S) GET | 200 + body contains `Mederti` | 3 min |
| Search API | `https://mederti.vercel.app/api/search?q=amoxicillin` | HTTP(S) GET | 200 + JSON body contains `"results"` | 3 min |
| Freshness API | `https://mederti.vercel.app/api/freshness` | HTTP(S) GET | 200 + JSON body | 5 min |
| Drug detail | `https://mederti.vercel.app/drugs/<stable-known-id>` | HTTP(S) GET | 200 + body contains the drug generic name | 5 min |
| Chat API (HEAD) | `https://mederti.vercel.app/api/chat` | HTTP HEAD | 405 (Method Not Allowed — proves the route is registered, doesn't hit Anthropic) | 5 min |

**Picking the stable drug ID** for the drug detail monitor: pick something universally present like the canonical Amoxicillin or Insulin glargine row. Query Supabase once for the UUID and pin it.

## Alert routing

For each monitor, configure:

- **Email** to `ops@mederti.com` (or Rob's inbox until ops alias exists)
- **Slack** webhook if you have a channel set up
- **Trigger** = "Down for at least 2 consecutive checks" (avoids alerting on a single transient 502)
- **Recovery** notification on (so you know when it's back up)

## Status page (optional)

Better Stack's free tier includes a single hosted status page. Recommend:

- URL: `status.mederti.com` (CNAME to better-stack-provided host)
- Public — supplier / hospital procurement contacts can subscribe to incident updates
- Group monitors as: **Site** (landing), **API** (search + freshness + drug detail + chat), **Data freshness** (link to `/freshness`)

## What this catches that Sentry doesn't

- Vercel function returns 502 due to platform issue (not your code → no Sentry event)
- Supabase outage (your route doesn't throw, just returns empty / 500 from a wrapped `try/catch`)
- DNS / SSL cert expiry
- Anthropic API outage cascading into `/api/chat` 5xx

## What this does NOT catch

- Slow-but-up endpoints (Better Stack flags response time but doesn't alert by default; add a threshold per monitor for p95 > 5s if useful)
- Stale data (e.g. scraper hasn't run for 48h but `/api/freshness` returns 200) — that's what the `detect_stale_sources` cron + `OPS_ALERT_EMAIL` already cover; cross-ref `backend/health/detectors.py:120`

## Estimated time to set up: 15 minutes

Most of which is creating the Better Stack account and finding the stable drug UUID. Once configured, no maintenance.
