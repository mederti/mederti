#!/usr/bin/env bash
# =============================================================================
# Mederti — fallback log rotation script (no root required)
# =============================================================================
# Closes audit FINDING-D2-03 for environments where installing the
# newsyslog config (cron/newsyslog-mederti.conf) isn't possible.
#
# Behaviour:
#   • Truncates cron.log to its last KEEP_LINES lines (default 5,000) —
#     preserves the recent tail for incident triage; drops everything older.
#   • Gzips daily scraper_YYYY-MM-DD.log files older than 1 day.
#   • Deletes gzipped logs older than KEEP_DAYS (default 14) days.
#
# Flags:
#   --dry-run     Print what WOULD happen without touching files. Always use
#                 this first when changing KEEP_LINES / KEEP_DAYS. Added after
#                 a real run with KEEP_LINES=1000000 truncated cron.log
#                 unexpectedly (the user intended a no-op; the actual file
#                 had > 1M lines). Lesson logged.
#
# Env vars:
#   LOGDIR        Override the log directory (default: <repo>/logs)
#   KEEP_LINES    cron.log tail length (default: 5000)
#   KEEP_DAYS     gzipped-log retention (default: 14)
#
# Install as a daily cron alongside the scrapers:
#   # in crontab:
#   30 12 * * * /usr/bin/env bash /Users/findlaysingapore/mederti/cron/rotate-logs.sh >> /Users/findlaysingapore/mederti/logs/cron.log 2>&1
#
# Or run manually after a session: `bash cron/rotate-logs.sh --dry-run` first.
# =============================================================================
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "[rotate-logs] unknown flag: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

LOGDIR="${LOGDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs}"
KEEP_LINES="${KEEP_LINES:-5000}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [ ! -d "$LOGDIR" ]; then
  echo "[rotate-logs] log dir not found: $LOGDIR" >&2
  exit 1
fi

prefix() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[rotate-logs DRY-RUN]"
  else
    echo "[rotate-logs]"
  fi
}

# ── 1. Truncate cron.log to last N lines ────────────────────────────────────
CRONLOG="$LOGDIR/cron.log"
if [ -f "$CRONLOG" ]; then
  size_before=$(wc -c < "$CRONLOG" | tr -d ' ')
  current_lines=$(wc -l < "$CRONLOG" | tr -d ' ')
  if [ "$current_lines" -le "$KEEP_LINES" ]; then
    echo "$(prefix) cron.log: ${current_lines} lines ≤ KEEP_LINES=${KEEP_LINES} → no-op"
  elif [ "$DRY_RUN" = "1" ]; then
    estimated_drop=$(( current_lines - KEEP_LINES ))
    echo "$(prefix) cron.log: WOULD truncate from ${current_lines} → ${KEEP_LINES} lines (${size_before}B; drop ~${estimated_drop} oldest lines)"
  else
    # tail+atomic-replace avoids racing with a concurrent appending cron
    tail -n "$KEEP_LINES" "$CRONLOG" > "$CRONLOG.tmp"
    mv "$CRONLOG.tmp" "$CRONLOG"
    size_after=$(wc -c < "$CRONLOG" | tr -d ' ')
    echo "$(prefix) cron.log: ${size_before}B → ${size_after}B (kept last ${KEEP_LINES} lines, dropped $(( current_lines - KEEP_LINES )))"
  fi
fi

# ── 2. Gzip daily scraper logs older than 1 day ─────────────────────────────
# -mtime +0 = older than 24h; -size +1c = non-empty
gzipped=0
would_gzip=()
for f in $(find "$LOGDIR" -maxdepth 1 -type f -name 'scraper_*.log' -mtime +0 -size +1c 2>/dev/null); do
  if [ -f "$f" ] && [ ! -f "$f.gz" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      would_gzip+=("$(basename "$f")")
    else
      gzip -f "$f"
      gzipped=$((gzipped + 1))
    fi
  fi
done
if [ "$DRY_RUN" = "1" ]; then
  echo "$(prefix) WOULD gzip ${#would_gzip[@]} daily scraper log(s): ${would_gzip[*]:-(none)}"
else
  echo "$(prefix) gzipped $gzipped daily scraper log(s)"
fi

# ── 3. Delete gzipped logs older than KEEP_DAYS ─────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  candidates=$(find "$LOGDIR" -maxdepth 1 -type f -name 'scraper_*.log.gz' -mtime "+$KEEP_DAYS" 2>/dev/null)
  count=$(echo "$candidates" | grep -c . || true)
  echo "$(prefix) WOULD delete $count gzipped log(s) older than ${KEEP_DAYS} days"
  [ "$count" -gt 0 ] && echo "$candidates" | sed 's/^/[rotate-logs DRY-RUN]   /'
else
  deleted=$(find "$LOGDIR" -maxdepth 1 -type f -name 'scraper_*.log.gz' -mtime "+$KEEP_DAYS" -delete -print 2>/dev/null | wc -l | tr -d ' ')
  echo "$(prefix) deleted $deleted gzipped log(s) older than ${KEEP_DAYS} days"
fi

echo "$(prefix) done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
