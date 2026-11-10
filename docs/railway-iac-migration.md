# Railway: Config as Code → Infrastructure as Code migration

**Deadline:** Railway stops reading `railway.toml` / `railway.json` files on **2026-12-01**, with no grace period. Every Mederti cron service on Railway depends on them today.
**Project:** `disciplined-analysis`, environment `production`.
**Written:** 2026-10-17. Checked against docs.railway.com (Config as Code, Infrastructure as Code, IaC reference, `railway config` CLI), Railpack 0.42.0, Railway CLI 5.70.0 and the `railway` npm SDK 3.16.0.

## What changes

| | Before (Config as Code) | After (Infrastructure as Code) |
|---|---|---|
| Where settings live | `railway/<svc>/railway.toml`, read from the repo **on every deploy** | Stored on the Railway service. `.railway/railway.ts` is the source of truth, and it reaches Railway only when someone runs `railway config apply`. **Railway never reads it on deploy.** |
| Builder | Nixpacks + `railway/<svc>/nixpacks.toml` (installs `python311` into `/opt/venv`) | **Railpack**, with the repo-root `railpack.json` forcing the Python provider |
| Python | `nixPkgs = ["python311"]` | `.python-version` (`3.11`, resolves to 3.11.17) |
| Start | `/opt/venv/bin/python railway/<svc>/run.py` | `python railway/<svc>/run.py` (Railpack puts `/app/.venv/bin` first on PATH) |
| Cron and restart policy | `cronSchedule`, `restartPolicyType = "never"` in the toml | `deploy: { cronSchedule, restartPolicyType: "NEVER" }` in `railway.ts` |

Why Railpack and not Nixpacks: Railway's current Config-as-Code reference lists only `RAILPACK` (the default) and `DOCKERFILE` as builders, and the dashboard already shows `builder: RAILPACK` for all three services. Without a config file, a build falls back to that. The IaC schema does still accept `NIXPACKS` + `nixpacksConfigPath`, but carrying a builder that is on its way out into the new system would be a mistake.

### Services and settings carried over

| Railway service | Script | `cronSchedule` | Restart | Notes |
|---|---|---|---|---|
| `shortage-cron-frequent` | `railway/shortage_cron_frequent/run.py` | `0 */4 * * *` | NEVER | private endpoint `incredible-vibrancy` |
| `shortage-cron-daily` | `railway/shortage_cron_daily/run.py` | `0 2 * * *` | NEVER | |
| `feisty-imagination` (recall cron) | `railway/recall_cron/run.py` | `0 */6 * * *` | NEVER | source `rootDirectory: "/"` |

All three keep `us-east4-eqdc4a × 1` replicas, `buildEnvironment: V3`, and repo `mederti/mederti@main`.

**Variables are unmanaged** (`variables: { managed: false }`). The IaC file never creates, changes or deletes a variable, and the secrets stay in the dashboard only. The 8 existing variables are left exactly as they are.

## Traps found while preparing this (read before running anything)

1. **`railway config migrate --apply` would break the crons.** Its generated file keeps `builder: "nixpacks"` but drops `nixpacksConfigPath`, so Nixpacks would autodetect Node from `package.json`. That is the "python3: command not found" failure again, plus a start command pointing at a `/opt/venv` that no longer exists. It also turns `cronSchedule` into a **comment** (`// cronSchedule from CaC: "0 */4 * * *"`), so every cron would stop firing. It drops `restartPolicyType` too. **Use the hand-written `.railway/railway.ts` in this repo, not the `migrate --apply` output.** `migrate cutover` (step 3 below) is still the right tool for switching services off Config as Code.
2. **Railpack's default install step copies only `requirements.txt`.** Ours contains just `-r backend/requirements.txt`, so `pip` would fail without the file it points to. `railpack.json` adds `backend/requirements.txt` to the install step. This was verified with `railpack plan .`, where the install step now copies it before `pip install`.
3. **Cutover leaves the services half-configured until apply runs.** `cutover` clears the Railway Config File field, and from that moment the dashboard values apply: Railpack, **no start command, no cron schedule**. The IaC `apply` then fills those in. Run the two back to back and don't merge anything to `main` in between, because a push would trigger a deploy that has no cron and no start command.
4. **The installed CLI (5.26.1) is too old.** It has no `config migrate`, and the SDK needs CLI ≥ 5.42.1 because the IaC engine now ships inside the CLI. Upgrade first (step 1 below).
5. **One file covers the whole project.** Any service in the environment that `railway.ts` doesn't list is planned for **deletion**. The plan marks deletions, and applying them needs explicit confirmation. Read the plan before typing yes.

## Pre-existing problems spotted (not caused by this migration)

- **`feisty-imagination` has `SUPABASE_URL` set to a JWT** (the service-role key) instead of `https://mleblwjozjvpbuztggxp.supabase.co`. Even once the build works, the recall cron can't reach Supabase. Fix it in the dashboard: set `SUPABASE_URL` to `${{shortage-cron-frequent.SUPABASE_URL}}`, as `shortage-cron-daily` already does.
- **`carefree-cat` still shows in `railway environment config -e production`** (no config file, cron `*/30 * * * *`), even though `railway list` no longer lists it. The deletion may be staged but not deployed. Check the canvas for a pending "Apply changes" banner. If it is still there at cutover, the IaC plan will list `- Delete service carefree-cat`, which is the intended outcome.
- **`tga-audit-cron` isn't on Railway at all.** No service in `disciplined-analysis` (or `aware-analysis`) runs it, so `railway/tga_audit_cron/` is unused config and the CLAUDE.md line "daily Railway cron" is not true today. It is out of scope here. If it gets revived, add it to `railway.ts` the same way as the others (`cronSchedule: "0 8 * * *"`).

## Runbook (user, roughly 15 minutes, any time before 2026-12-01)

Run these from a checkout of `main` **after this PR is merged**. Merging the PR on its own changes nothing in production: the services keep reading their tomls, and the tomls stay in the repo until the cleanup PR.

```bash
# 1. Upgrade the CLI (needs >= 5.42.1; 5.70.0 is current)
brew upgrade railway        # or: npm i -g @railway/cli@latest
railway --version

# 2. Link and check where things stand
npm install                 # installs the `railway` IaC SDK (devDependency)
railway link                # project disciplined-analysis, env production
railway config migrate status   # expect the 3 services "Still on Config as Code"

# 3. Switch the 3 services off Config as Code (reversible: `railway config migrate undo`)
railway config migrate cutover

# 4. Right after cutover, preview the IaC changes
railway config plan --show-values
```

**What the plan should show:** updates to the 3 services only, covering builder/start/`cronSchedule`/`restartPolicyType`. It may also show `- Delete service carefree-cat` (see above). **Stop and run `railway config migrate undo` if** it shows any variable change, a delete of any of the 3 cron services, or anything else unexpected.

```bash
# 5. Apply
railway config apply
```

Then in the dashboard:

6. For each of the 3 services, open **Settings** and confirm: *Railway Config File* is empty, Builder is Railpack, Custom Start Command is `python railway/<svc>/run.py`, and Cron Schedule matches the table above.
7. Fix `feisty-imagination` → **Variables** → `SUPABASE_URL` (see the pre-existing problems above).
8. Trigger a deploy of each service (**⋯ → Redeploy**, or wait for the next cron fire). In the build log, look for `Using provider Python from config`, `python 3.11.17`, and `pip install -r requirements.txt` succeeding. In the deploy log, look for the scraper run starting and not `command not found`.
9. Check that data is landing in Supabase: `data_sources` / `shortage_events` rows updated after the run.

**Rollback:** `railway config migrate undo` restores the old Config File paths. The toml and nixpacks files stay in the repo until the cleanup PR, so undo brings back exactly the old behaviour.

## Follow-up cleanup PR (only after step 9 passes on all 3 services)

Delete files that are no longer read: `railway/{shortage_cron_daily,shortage_cron_frequent,recall_cron,tga_audit_cron}/{railway,nixpacks}.toml`, `railway/railway.toml`, root `railway.toml`, root `nixpacks.toml`. Any of these left in the repo is a trap, because `railway config migrate` keeps finding them. Update `cron/RAILWAY_SERVICES.md` and CLAUDE.md to point at `.railway/railway.ts`. Optionally add the `railwayapp/config` GitHub Action (plan on PR, apply on merge), which needs a project token stored as the `RAILWAY_TOKEN` secret.

## Changing cron settings from now on

Edit `.railway/railway.ts`, then run `railway config plan` and `railway config apply`. **Editing the file and pushing does nothing on its own.** Dashboard edits still work, but the next `apply` overwrites them with whatever the file says, so keep the file as the source of truth.
