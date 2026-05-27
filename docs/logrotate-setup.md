# Log rotation setup (Mac cron)

Closes audit FINDING-D2-03 — `logs/cron.log` reached 538 MB by audit time with no rotation; daily `scraper_YYYY-MM-DD.log` files accumulate at 30-40 MB each indefinitely.

Two install paths — pick one. Both achieve the same outcome; the first is OS-native, the second works without root.

## Path A — macOS `newsyslog` (recommended, needs sudo once)

```bash
sudo cp cron/newsyslog-mederti.conf /etc/newsyslog.d/mederti.conf
sudo newsyslog -F   # rotate now; validates the config
ls -lh logs/
```

After this, `launchd` invokes `newsyslog` daily and the config is respected. Rotated files become `cron.log.0.gz`, `cron.log.1.gz`, etc. Up to 7 generations of `cron.log`, 14 generations of `scraper_*.log`, all gzipped.

Verify it's wired:

```bash
sudo newsyslog -nv -f /etc/newsyslog.d/mederti.conf
# -n no-op, -v verbose — shows what WOULD rotate without doing it
```

Uninstall:

```bash
sudo rm /etc/newsyslog.d/mederti.conf
```

## Path B — fallback shell script (no root)

Use if you can't install to `/etc/newsyslog.d/` (locked-down work laptop, etc.).

```bash
chmod +x cron/rotate-logs.sh

# Add to your existing crontab — runs once a day at 12:30 local
( crontab -l 2>/dev/null; \
  echo "30 12 * * * /usr/bin/env bash $(pwd)/cron/rotate-logs.sh >> $(pwd)/logs/cron.log 2>&1" ) \
  | crontab -

crontab -l | grep rotate-logs    # confirm it's in there
```

The script:

- Truncates `cron.log` to its last 5,000 lines (preserves recent tail for triage; drops everything older)
- Gzips `scraper_YYYY-MM-DD.log` files older than 24h
- Deletes gzipped logs older than 14 days

Tune with env vars if needed:

```bash
KEEP_LINES=10000 KEEP_DAYS=30 bash cron/rotate-logs.sh
```

## One-time cleanup of the existing backlog

Whichever path you take, **manually clean the existing oversized files first** so you don't carry forward the 538 MB. Run once before installing:

```bash
# 538 MB cron.log → last 5,000 lines
tail -n 5000 logs/cron.log > logs/cron.log.new && mv logs/cron.log.new logs/cron.log

# gzip the older scraper logs (saves ~80%)
find logs/ -maxdepth 1 -name 'scraper_*.log' -mtime +1 -exec gzip -f {} \;

du -sh logs/   # expect dramatic drop (was ~2 GB; should be ~50 MB after)
```

## Railway side

Railway scraper services log to stdout. Railway's log retention (configurable per-service) handles rotation automatically. **No config needed.** Once Open Decision #1 is settled and the Mac side is fully decommissioned, this whole setup becomes vestigial.

## What this does NOT do

- It does not back up logs anywhere off-disk. If you want long-term retention, pipe to a log aggregator (Better Stack, Logtail, Papertrail) instead of writing local files.
- It does not alert on log content. That's Sentry's job (see [`sentry-setup.md`](sentry-setup.md)).
- It does not rotate `logs/scraper_*.log` on the Path B shell-script path with the granularity newsyslog has (newsyslog can rotate by size *or* time; the script rotates by age only).

## Estimated setup time: 2 minutes for Path A, 1 minute for Path B + one-time cleanup
