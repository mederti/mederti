#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Mederti — Cron Job Setup
# ─────────────────────────────────────────────────────────────────────────────
# Installs daily cron jobs for all 9 scrapers.
# Schedule: staggered 30 min apart from 06:00 AEST (UTC+11) = 19:00 UTC
#
# Usage (from repo root):
#   bash cron/setup_cron.sh
#
# To remove all Mederti cron jobs:
#   crontab -l | grep -v "mederti" | crontab -
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$(command -v python3)"
LOGDIR="$REPO_DIR/logs"
DOTENV="$REPO_DIR/.env"

echo "Repo  : $REPO_DIR"
echo "Python: $PYTHON"
echo "Logs  : $LOGDIR"
echo ""

mkdir -p "$LOGDIR"

# Helper: build a cron command for a single scraper key
cron_cmd() {
    local key="$1"
    echo "cd $REPO_DIR && $PYTHON run_all_scrapers.py $key >> $LOGDIR/cron.log 2>&1"
}

# ── New cron entries (UTC times = AEST/UTC+11 minus 11h) ────────────────────
NEW_ENTRIES="
# Mederti scrapers — staggered 30 min from 19:00 UTC (06:00 AEST/UTC+11)
0 19 * * *   $(cron_cmd tga)
30 19 * * *  $(cron_cmd fda)
0 20 * * *   $(cron_cmd health_canada)
30 20 * * *  $(cron_cmd mhra)
0 21 * * *   $(cron_cmd ema)
30 21 * * *  $(cron_cmd bfarm)
0 22 * * *   $(cron_cmd ansm)
30 22 * * *  $(cron_cmd aifa)
0 23 * * *   $(cron_cmd aemps)
30 23 * * *  $(cron_cmd fda_enforcement)
0 0 * * *    $(cron_cmd hsa)
30 0 * * *   $(cron_cmd pharmac)
# Phase 8 scrapers — staggered 15 min apart from 01:00 UTC
0 1 * * *    $(cron_cmd medsafe)
15 1 * * *   $(cron_cmd cbg_meb)
30 1 * * *   $(cron_cmd dkma)
45 1 * * *   $(cron_cmd fimea)
0 2 * * *    $(cron_cmd hpra)
15 2 * * *   $(cron_cmd lakemedelsverket)
30 2 * * *   $(cron_cmd sukl)
45 2 * * *   $(cron_cmd ogyei)
0 3 * * *    $(cron_cmd swissmedic)
15 3 * * *   $(cron_cmd noma)
30 3 * * *   $(cron_cmd ages)
"

# ── Merge with existing crontab (remove old Mederti entries first) ───────────
EXISTING=$(crontab -l 2>/dev/null | grep -v "mederti" | grep -v "run_all_scrapers" || true)

(
  echo "$EXISTING"
  echo "$NEW_ENTRIES"
) | crontab -

echo "Cron jobs installed. Current crontab:"
echo "──────────────────────────────────────"
crontab -l | grep -E "mederti|run_all_scrapers|Mederti"
echo "──────────────────────────────────────"
echo "Done."
