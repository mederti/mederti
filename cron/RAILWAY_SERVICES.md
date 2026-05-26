# Railway Cron Services — Deployment Playbook

Three cron services + one always-on API, all in the same Railway project, all on the same GitHub repo.

After deploy, decommission the Mac crontab (`crontab_fixed.txt`) so the laptop isn't a single point of failure.

---

## Pre-flight (run locally)

```bash
# 1. Confirm the local repo matches what Railway will deploy
git status                          # expect "clean" or only intentional changes
git log -1                          # note the SHA — match it post-deploy

# 2. Verify scraper runners import cleanly
python3 -c "from cron.run_shortage_scrapers import CORE_SHORTAGE_SCRAPERS, run_scraper; print(len(CORE_SHORTAGE_SCRAPERS), 'shortage scrapers'); print(run_scraper.__doc__)"
python3 -c "from cron.run_recall_scrapers import RECALL_SCRAPERS; print(len(RECALL_SCRAPERS), 'recall scrapers')"

# 3. Verify .env locally (do not commit)
grep -E "^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=" .env | wc -l   # expect 2
```

Expected counts (post 2026-05-26 changes): **38 shortage scrapers**, **9 recall scrapers**.

---

## Service 1 — `shortage-cron`

- **Source:** GitHub repo (this monorepo), branch `main`
- **Build:** nixpacks (`nixpacks.toml` pins Python 3.11)
- **Start command:** `python cron/run_shortage_scrapers.py`
- **Cron schedule:** `0 */6 * * *` (every 6 hours)
- **Restart policy:** never (cron-triggered, not long-running)
- **Env vars:**
  - `SUPABASE_URL` — `https://mleblwjozjvpbuztggxp.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` — service-role JWT (from Supabase → Settings → API)
  - `MEDERTI_DRY_RUN` — `0`
  - `PYTHONUNBUFFERED` — `1` (so logs stream live)

---

## Service 2 — `recall-cron`

- **Start command:** `python cron/run_recall_scrapers.py`
- **Cron schedule:** `0 3,9,15,21 * * *` (every 6 hours, offset 3h from shortage-cron to spread load)
- **Env vars:** same as Service 1.

---

## Service 3 — `tga-audit-cron`

- **Config:** `railway/tga_audit_cron/railway.toml`
- **Start command:** `python railway/tga_audit_cron/run.py`
- **Cron schedule:** `0 8 * * *` (daily 08:00 UTC)
- **Env vars:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
- **Purpose:** Samples 50 active AU shortage records, diffs against live TGA MSI, writes results to `audit_logs`. Promoted from weekly to daily after audit baseline hit 100%.

---

## Service 4 — `mederti-api` (existing, keep)

- **Start command:** `python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT`
- **Always on.** Legacy FastAPI — not on the frontend critical path today (Next.js Route Handlers in `frontend/app/api/*` go straight to Supabase). Keep deployed only if any external consumer still hits it. Otherwise candidate for deletion.

---

## Post-deploy verification (run within 1 hour of each cron firing)

```bash
# 1. Tail Railway logs — confirm scrapers run and report counts
#    Railway dashboard → service → Logs tab. Expect lines like:
#    argentina_anmat            success         320 records   12.4s

# 2. Confirm fresh data in Supabase
#    Run these as SQL in Supabase Studio (or via psql against the connection string):
SELECT name, last_scraped_at
FROM data_sources
WHERE country_code IN ('AR','BE','GR','HK','MY','PT','TR','AE')
ORDER BY last_scraped_at DESC NULLS LAST;
-- Expect last_scraped_at to be within the last 6 hours for active sources.

SELECT country_code, COUNT(*) AS active_shortages
FROM shortage_events
WHERE status = 'active'
  AND country_code IN ('AR','BE','GR','HK','MY','PT','TR','AE')
GROUP BY country_code
ORDER BY active_shortages DESC;
-- Expect (within ~10%): AR 320, BE 632, GR 230, HK 1, MY 142, PT 34, TR 10, AE 9.

SELECT status, COUNT(*) FROM recalls GROUP BY status;
-- Expect non-zero recent rows.
```

If any query returns 0 or nothing fresh, check the corresponding service's last-run log in Railway.

---

## Decommission Mac cron (only after 48h of clean Railway runs)

```bash
# 1. Snapshot the current Mac crontab in case you need to roll back
crontab -l > ~/mederti-mac-crontab-backup-$(date +%Y%m%d).txt

# 2. Remove Mederti entries from the Mac crontab
crontab -l | grep -v "mederti\|run_all_scrapers" | crontab -

# 3. Verify
crontab -l                                    # no mederti lines should remain

# 4. Free up disk — cron.log is currently ~500MB
mv logs/cron.log logs/cron.log.archive-$(date +%Y%m%d)
gzip logs/cron.log.archive-*

# 5. Stop further appends from any orphaned process
ps aux | grep -E "scrapers|cron" | grep -v grep   # expect nothing Mederti-related
```

Keep `cron/crontab_fixed.txt` in the repo as historical reference; mark it deprecated in a header comment.

---

## Rollback (if Railway runs fail or data goes stale)

```bash
# 1. Re-install the Mac crontab from snapshot
crontab ~/mederti-mac-crontab-backup-YYYYMMDD.txt

# 2. Pause the Railway services (don't delete — keeps env vars + history)
#    Railway dashboard → service → Settings → Pause Service

# 3. Verify Mac cron is running
launchctl list | grep -i cron       # macOS cron daemon
crontab -l | wc -l                   # expect non-zero lines
```

---

## Scraper status (as of 2026-05-26)

### Active in Railway shortage-cron (38 scrapers)

**Core (Phase 1–7):** tga, fda, health_canada, mhra, ema, bfarm, ansm, aifa, aemps, fda_enforcement, hsa, pharmac
**Phase 8 (additional EU/AP):** medsafe, cbg_meb, dkma, fimea, hpra, lakemedelsverket, sukl, ogyei, swissmedic, noma, ages
**Phase 9+ (global expansion):** anvisa, pmda, mfds, cofepris, sahpra, nafdac, sfda
**Phase 10 (verified working 2026-05-26):** argentina_anmat, belgium_famhp, greece_eof, hk_drugoffice, malaysia_npra, portugal_infarmed, turkey_titck, uae_mohap

### Active in Railway recall-cron (9 scrapers)

**Core:** tga_recalls, fda_recalls, fda_medwatch, health_canada_recalls, ema_recalls, mhra_recalls
**Verified 2026-05-26:** ansm_recalls, aifa_recalls, medsafe_recalls

### Quarantined — needs fixing before re-enabling

| Scraper | Failure | Fix |
|---|---|---|
| china_nmpa | 0 relevant items out of 42 fetched (content filter too tight or schema drift) | Re-investigate the relevance filter; the page format may have shifted. |
| india_cdsco | "PDF links not found" — 0 PDFs on the NSQ page | Update the PDF-link selector; CDSCO restructured the page. |
| israel_moh | SPA with `#!/drugShortage` hash routes; static HTML returns 0 records | Either discover the underlying JSON API or use a headless browser (Playwright). |
| poland_mz | 404 on `gov.pl/web/zdrowie/lista-lekow-zagrozonych-brakiem-dostepnosci` | Source page moved — find new URL. |
| aemps_recalls | 403 Forbidden on AEMPS recall index | Add browser-like User-Agent / handle anti-bot; or switch to an alternative AEMPS endpoint. |
| bfarm_recalls | 404 on `pharmnet-bund.de/dynamic/de/ru/rueckrufliste.html` | URL changed — find new endpoint on PharmNet-Bund. |
| hsa_recalls | 404 on `hsa.gov.sg/announcements/safety-alerts-and-product-recalls` | URL changed — find new HSA Singapore endpoint. |

### Notes

- Each service uses `nixpacks.toml` for Python 3.11 build.
- Scrapers run sequentially within each service to avoid rate-limit issues.
- Each scraper has built-in dedup (MD5 `shortage_id` / `recall_id`) so repeated runs are safe.
- `cron/run_*.py` catches per-scraper exceptions — one broken scraper does not halt the run.
