#!/usr/bin/env bash
# DISMODO database backup: pg_dump from the running db container into a
# dated, gzipped file under deploy/backups/, keeping the newest 14.
#
# Cron (daily at 03:15, from the repository checkout on the VPS):
#   15 3 * * * cd /opt/dismodo && ./deploy/backup.sh >> deploy/backups/backup.log 2>&1
#
# Restore (into the running stack; this overwrites current data):
#   gunzip -c deploy/backups/dismodo-YYYY-MM-DD-HHMMSS.sql.gz \
#     | docker compose -f deploy/docker-compose.prod.yml exec -T db \
#         sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
BACKUP_DIR="$SCRIPT_DIR/backups"
KEEP=14

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F-%H%M%S)"
OUT="$BACKUP_DIR/dismodo-$STAMP.sql.gz"
TMP="$OUT.tmp"

# Remove a partial file if the dump or the compression fails.
cleanup_partial() {
  rm -f "$TMP"
}
trap cleanup_partial ERR

# POSTGRES_USER / POSTGRES_DB are read inside the container, where the
# db service already has them; -T keeps this usable from cron.
docker compose -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip -9 >"$TMP"

gzip -t "$TMP"
mv "$TMP" "$OUT"
trap - ERR

echo "Backup written: $OUT"

# Keep the newest $KEEP dumps; delete the rest.
# (Filenames sort by date, so the shell glob is already chronological.)
shopt -s nullglob
dumps=("$BACKUP_DIR"/dismodo-*.sql.gz)
count=${#dumps[@]}
if ((count > KEEP)); then
  for old in "${dumps[@]:0:count-KEEP}"; do
    rm -f -- "$old"
    echo "Pruned old backup: $old"
  done
fi
