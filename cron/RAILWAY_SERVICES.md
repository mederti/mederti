# Railway Cron Services

Create these as **separate services** in the Railway dashboard (same project, same repo).

## 1. shortage-cron (replaces carefree-cat)
- **Start command:** `python cron/run_shortage_scrapers.py`
- **Cron schedule:** `0 */6 * * *` (every 6 hours)
- **Env vars:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDERTI_DRY_RUN=0

## 2. recall-cron (replaces feisty-imagination)
- **Start command:** `python cron/run_recall_scrapers.py`
- **Cron schedule:** `0 3,9,15,21 * * *` (every 6 hours, offset)
- **Env vars:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDERTI_DRY_RUN=0

## 3. tga-audit-cron
- **Config:** `railway/tga_audit_cron/railway.toml`
- **Start command:** `python railway/tga_audit_cron/run.py`
- **Cron schedule:** `0 8 * * *` (daily at 08:00 UTC)
- **Env vars:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- **Purpose:** Samples 50 active AU shortage records, diffs against live TGA MSI, writes results to `audit_logs`. Promoted from weekly to daily after the audit baseline hit 100%.

## Existing services (keep as-is)
- **mederti API** — `python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT` (always on)

## Notes
- Each service uses nixpacks.toml for Python 3.11 build
- Scrapers run sequentially within each service to avoid rate-limit issues
- Each scraper has built-in dedup (MD5 shortage_id) so multiple runs are safe
