# Soft-Launch Mode

Toggle a slim, public-facing version of Mederti — only the five pages
we want for the initial release — without removing any code.

## What's exposed under soft-launch

| Page | Path |
|---|---|
| Homepage | `/` |
| Sign in | `/login` |
| Sign up | `/signup` |
| Drug search | `/search` |
| Drug detail | `/drugs/[id]` |
| Pharma intelligence | `/intelligence` (and subpages) |

Plus the auth scaffolding needed for the above to work: `/onboarding`,
`/account`, `/auth/*`, `/forgot-password`, `/reset-password`,
`/coming-soon`, `/privacy`, `/terms`, all `/admin/*` (separately gated),
all `/api/*`, and static assets.

Everything else (e.g. `/dashboard`, `/shortages`, `/recalls`, `/watchlist`,
`/supplier-dashboard`, `/pharmacists`, `/hospitals`, `/doctors`,
`/government`, `/suppliers`, `/home`, `/chat`) 308-redirects to
`/coming-soon`.

## Toggle it on

Single env var:

```
NEXT_PUBLIC_SOFT_LAUNCH=true
```

Unset it (or set to `false`) and the full site reappears.

## Three deployment patterns

### Local preview

```bash
cd frontend
NEXT_PUBLIC_SOFT_LAUNCH=true npm run dev
```

Visit `http://localhost:3000` — you'll see the trimmed nav, footer,
and any non-allowlisted URL redirects to `/coming-soon`.

### Vercel preview environment (recommended for testing)

In Vercel → Project → Settings → Environment Variables:

1. Add `NEXT_PUBLIC_SOFT_LAUNCH = true`
2. Tick **Preview** only (leave Production unchecked)
3. Redeploy preview

Result: every preview URL (including PR previews) shows the soft-launch
version. Production stays as the full site. This gives you a "duplicate
site" without forking the codebase.

### Vercel production rollout

When you're ready to go live with soft-launch:

1. Vercel → Settings → Environment Variables → `NEXT_PUBLIC_SOFT_LAUNCH = true`
2. Tick **Production**
3. Redeploy

To go full-launch later: delete the env var or set to `false`, redeploy.

## What changes when the flag is on

- **`SiteNav`** — only renders Search + Intelligence + Sign in / Account
- **`SiteFooter`** — strips Dashboard / Shortages / Recalls / Alerts /
  Supplier / Resources column / About / Pricing / Contact links
- **`middleware.ts`** — non-allowlisted paths 308 to `/coming-soon`
- **Onboarding routing** — final-step landing for any role is `/search`
  (or `/intelligence` for gov/researcher), since `/home` and
  `/supplier-dashboard` are hidden
- **Logo link** — for signed-in users, takes them to `/search` instead
  of `/home`

## Things that are NOT changed

- The user_profiles schema — full questionnaire still runs at signup
  so the data is consistent for the BI dashboard later
- Admin pages (`/admin/*`) — still admin-only; they aren't exposed
  publicly even when soft-launch is off
- Any backend scrapers, cron jobs, or data ingestion
- API routes (`/api/*`) — pass through unchanged

## Backlog when going full-launch

- Re-enable the Resources footer column
- Re-add `/shortages`, `/recalls`, `/dashboard`, `/watchlist` to nav
- Revisit `/home` as the default logged-in landing
- Surface the `/supplier-dashboard` link to manufacturer/wholesaler users
- Decide whether persona-marketing pages (`/pharmacists` etc.) should
  return as deep links or stay as part of an SEO sitemap only
