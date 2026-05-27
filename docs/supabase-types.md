# Supabase types — adoption and regeneration

Closes audit FINDING-F4-06 incrementally. The frontend has 74 `: any` declarations and 125 `as any` casts because the Supabase client was untyped. This doc explains the typing strategy and how to expand it.

## Current state

`frontend/types/db.ts` hand-types **5 hot tables**: `shortage_events`, `drugs`, `data_sources`, `drug_alternatives`, `recalls`. The remaining ~46 tables fall through to `Record<string, unknown>` via an index-signature fallback so existing untyped code keeps working unchanged.

Two clients in `frontend/lib/supabase/admin.ts`:

- `getSupabaseAdmin()` — untyped, for backward-compat with legacy code
- `getSupabaseAdminTyped()` — types from `frontend/types/db.ts`

**Use the typed flavour for new / refactored routes.** Existing code keeps working until you opt it in by swapping the import.

## Adoption pattern

Before:

```ts
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const sb = getSupabaseAdmin();
const { data, error } = await sb
  .from("shortage_events")
  .select("severity, country_code")
  .eq("status", "active");
// data: any[] | null  ← every field is `any`
```

After:

```ts
import { getSupabaseAdminTyped } from "@/lib/supabase/admin";

const sb = getSupabaseAdminTyped();
const { data, error } = await sb
  .from("shortage_events")
  .select("severity, country_code")
  .eq("status", "active");
// data: Array<{ severity: string | null; country_code: string | null }> | null
```

The chat tools, the route handlers I implemented in `eda964f` (`/api/shortages`, `/shortages/summary`, `/recalls`), and any new code are the right first migrations. As each route is touched, swap the import and the consumer code becomes type-safe for free.

## Full regeneration (Rob action, ~10 minutes one-off)

The hand-typed 5 tables are the floor. The ceiling is the full ~51-table Database type auto-generated from the live Supabase schema. To get there:

### One-time CLI install

```bash
# macOS via Homebrew
brew install supabase/tap/supabase

# Or: npm global
npm install -g supabase

# Verify
supabase --version
```

### Authenticate against the Mederti project

```bash
supabase login   # opens browser, requires Supabase account
supabase link --project-ref mleblwjozjvpbuztggxp
```

(Project ref is in `frontend/.env.local` as `NEXT_PUBLIC_SUPABASE_URL` — `mleblwjozjvpbuztggxp.supabase.co`.)

### Regenerate types

```bash
cd frontend
npm run db:types
```

This runs `supabase gen types typescript --project-id mleblwjozjvpbuztggxp --schema public > types/db.ts`.

### Review the diff

The output **replaces** `frontend/types/db.ts` wholesale — the hand-typed 5 tables get overwritten by the CLI's full schema introspection. Diff to confirm:

- Same 5 tables still present (with potentially more columns the hand-types missed)
- ~46 additional tables added with proper Row/Insert/Update types
- The `UnknownTable` fallback becomes vestigial — remove it if the generated Database is complete

Commit the regenerated file with a message like `db: regenerate types/db.ts from prod schema (CLI auto-gen)`.

### Ongoing

Re-run `npm run db:types` after every migration that adds/changes columns:

```bash
git checkout main
git pull
# (apply migrations to prod)
npm run db:types
git diff types/db.ts
git add types/db.ts && git commit -m "db: refresh types after migration NNN"
```

Optional: wire it into CI so a PR that adds a migration also has a green-tick on regenerated types.

## What this does NOT do

- It does not type the chat-side Supabase client (`lib/chat/tools.ts`) — that's a separate ~3,551-line refactor (Q6-09).
- It does not type the browser-side `lib/supabase/client.ts` or SSR `lib/supabase/server.ts` clients. Those use `@supabase/ssr`'s `createServerClient`/`createBrowserClient` — same pattern applies; flip when the full Database type lands.
- It does not retroactively type the 74 `: any` / 125 `as any` sites the audit flagged. Those are opt-in: when a file is next touched, change the import to `getSupabaseAdminTyped()` and let TypeScript flag the consequent type errors.

## Cost

Zero runtime cost (types are erased at compile time). The npm script needs the Supabase CLI which is a ~30 MB go binary; install on the machine that runs the regen (typically your laptop and CI, not Vercel).
