#!/usr/bin/env sh
set -eu

# Installs an idempotent cron entry for daily backups.
# Run this ON THE SERVER (Linux) as the same user that runs the app/pm2.

PROJECT_DIR=${PROJECT_DIR:-"$(pwd)"}
BACKUPS_DIR=${BACKUPS_DIR:-"/var/www/visolux_store/backups"}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-"7"}

# Default: 23:59 daily
CRON_MIN=${CRON_MIN:-"59"}
CRON_HOUR=${CRON_HOUR:-"23"}

LOG_FILE=${LOG_FILE:-"$BACKUPS_DIR/backup.log"}

if ! command -v crontab >/dev/null 2>&1; then
  if [ "${SOFT_FAIL:-}" = "1" ]; then
    echo "WARNING: crontab not found; skipping cron install (SOFT_FAIL=1)" >&2
    exit 0
  fi
  echo "ERROR: crontab not found. Install cron (e.g., apt install cron)" >&2
  exit 1
fi

# Ensure backups dir exists (best-effort)
mkdir -p "$BACKUPS_DIR" || true

# Unique marker so we can update/remove safely.
MARKER="# visolux:daily-backup"

NPM_BIN="npm"
if command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
fi

CRON_LINE="$CRON_MIN $CRON_HOUR * * * cd \"$PROJECT_DIR\" && BACKUPS_DIR=\"$BACKUPS_DIR\" BACKUP_RETENTION_DAYS=\"$BACKUP_RETENTION_DAYS\" \"$NPM_BIN\" run backup >> \"$LOG_FILE\" 2>&1 $MARKER"

# Read existing crontab (if any)
EXISTING=""
if crontab -l >/dev/null 2>&1; then
  EXISTING=$(crontab -l | sed '/^no crontab for/d' || true)
fi

# Remove any old visolux backup lines, then append the new one.
NEW=$(printf "%s\n" "$EXISTING" | grep -v "visolux:daily-backup" || true)
NEW=$(printf "%s\n%s\n" "$NEW" "$CRON_LINE")

printf "%s\n" "$NEW" | crontab -

echo "Installed cron entry:"
echo "$CRON_LINE"
