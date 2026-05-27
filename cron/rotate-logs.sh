#!/usr/bin/env bash
# =============================================================================
# Mederti — fallback log rotation script (no root required)
# =============================================================================
# Closes audit FINDING-D2-03 for environments where installing the
# newsyslog config (cron/newsyslog-mederti.conf) isn't possible.
#
# Behaviour:
#   • Truncates cron.log to its last 5,000 lines (preserves the recent tail
#     for incident triage; drops everything older)
#   • Gzips daily scraper_YYYY-MM-DD.log files older than 1 day
#   • Deletes gzipped logs older than 14 days
#
# Install as a daily cron alongside the scrapers:
#   # in crontab:
#   30 12 * * * /usr/bin/env bash /Users/findlaysingapore/mederti/cron/rotate-logs.sh >> /Users/findlaysingapore/mederti/logs/cron.log 2>&1
#
# Or run manually after a session: `bash cron/rotate-logs.sh`
# =============================================================================
set -euo pipefail

LOGDIR="${LOGDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs}"
KEEP_LINES="${KEEP_LINES:-5000}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [ ! -d "$LOGDIR" ]; then
  echo "[rotate-logs] log dir not found: $LOGDIR" >&2
  exit 1
fi

# ── 1. Truncate cron.log to last N lines ────────────────────────────────────
CRONLOG="$LOGDIR/cron.log"
if [ -f "$CRONLOG" ]; then
  size_before=$(wc -c < "$CRONLOG" | tr -d ' ')
  # tail+atomic-replace avoids racing with a concurrent appending cron
  tail -n "$KEEP_LINES" "$CRONLOG" > "$CRONLOG.tmp"
  mv "$CRONLOG.tmp" "$CRONLOG"
  size_after=$(wc -c < "$CRONLOG" | tr -d ' ')
  echo "[rotate-logs] cron.log: ${size_before}B → ${size_after}B (kept last ${KEEP_LINES} lines)"
fi

# ── 2. Gzip daily scraper logs older than 1 day ─────────────────────────────
# -mtime +0 = older than 24h; -size +1c = non-empty
gzipped=0
for f in $(find "$LOGDIR" -maxdepth 1 -type f -name 'scraper_*.log' -mtime +0 -size +1c 2>/dev/null); do
  if [ -f "$f" ] && [ ! -f "$f.gz" ]; then
    gzip -f "$f"
    gzipped=$((gzipped + 1))
  fi
done
echo "[rotate-logs] gzipped $gzipped daily scraper log(s)"

# ── 3. Delete gzipped logs older than KEEP_DAYS ─────────────────────────────
deleted=$(find "$LOGDIR" -maxdepth 1 -type f -name 'scraper_*.log.gz' -mtime "+$KEEP_DAYS" -delete -print 2>/dev/null | wc -l | tr -d ' ')
echo "[rotate-logs] deleted $deleted gzipped log(s) older than ${KEEP_DAYS} days"

echo "[rotate-logs] done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
