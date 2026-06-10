#!/bin/bash
# Mederti log rotation — run weekly (Sun 18:30 UTC, before the 19:00 scraper cycle).
# cron.log grows ~50MB/week unrotated and had reached 500MB+ before this existed.
set -u
cd "$(dirname "$0")/.." || exit 1

# Rotate cron.log once it passes 50MB.
if [ "$(stat -f%z logs/cron.log 2>/dev/null || echo 0)" -gt 52428800 ]; then
  stamp=$(date +%Y%m%d)
  mv logs/cron.log "logs/cron.log.$stamp"
  touch logs/cron.log
  gzip "logs/cron.log.$stamp"
fi

# Compress per-day scraper logs once they stop being written (>7 days old).
find logs -name "scraper_*.log" -mtime +7 -exec gzip {} \;

# Drop compressed archives after 60 days.
find logs -name "*.gz" -mtime +60 -delete
