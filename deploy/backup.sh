#!/usr/bin/env sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$SCRIPT_DIR/docker-compose.api.yml"}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-takolako}
COMPOSE_ENV_FILE=${COMPOSE_ENV_FILE:-"$SCRIPT_DIR/.env.production"}
BACKUP_DIR=${BACKUP_DIR:-"/var/backups/tk-delivery"}
RETENTION_DAYS=${RETENTION_DAYS:-14}
BACKUP_RSYNC_DEST=${BACKUP_RSYNC_DEST:-}
BACKUP_RCLONE_REMOTE=${BACKUP_RCLONE_REMOTE:-}

case "$BACKUP_DIR" in
  ""|"/"|"/var"|"/var/backups")
    echo "Refusing unsafe BACKUP_DIR: $BACKUP_DIR" >&2
    exit 1
    ;;
esac

mkdir -p "$BACKUP_DIR"

compose() {
  if [ -f "$COMPOSE_ENV_FILE" ]; then
    docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
    return
  fi
  docker compose --project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

timestamp=$(date -u +"%Y%m%dT%H%M%SZ")
db_file="$BACKUP_DIR/postgres-$timestamp.dump"
uploads_file="$BACKUP_DIR/uploads-$timestamp.tar.gz"
db_tmp="$db_file.partial"
uploads_tmp="$uploads_file.partial"
restore_db="tk_delivery_restore_check_$(date -u +%s)"
trap 'rm -f "$db_tmp" "$uploads_tmp"' EXIT

compose exec -T postgres \
  pg_dump -U tk_delivery -d tk_delivery -Fc > "$db_tmp"

compose exec -T app \
  tar -czf - -C /app/uploads . > "$uploads_tmp"

compose exec -T postgres \
  dropdb -U tk_delivery --if-exists "$restore_db" >/dev/null 2>&1 || true

compose exec -T postgres \
  createdb -U tk_delivery "$restore_db"

restore_ok=0
if compose exec -T postgres \
  pg_restore -U tk_delivery -d "$restore_db" --exit-on-error < "$db_tmp"; then
  restore_ok=1
fi

compose exec -T postgres \
  dropdb -U tk_delivery --if-exists "$restore_db" >/dev/null

if [ "$restore_ok" -ne 1 ]; then
  echo "Restore check failed for $db_tmp" >&2
  exit 1
fi

tar -tzf "$uploads_tmp" >/dev/null
mv "$db_tmp" "$db_file"
mv "$uploads_tmp" "$uploads_file"

if [ -n "$BACKUP_RSYNC_DEST" ]; then
  rsync -a -- "$db_file" "$uploads_file" "$BACKUP_RSYNC_DEST"/
fi

if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  rclone copy "$db_file" "$BACKUP_RCLONE_REMOTE"
  rclone copy "$uploads_file" "$BACKUP_RCLONE_REMOTE"
fi

find "$BACKUP_DIR" -type f \( -name "postgres-*.dump" -o -name "uploads-*.tar.gz" \) -mtime +"$RETENTION_DAYS" -delete

printf 'Backup OK\nPostgreSQL: %s\nUploads: %s\nRestore check DB: %s\n' "$db_file" "$uploads_file" "$restore_db"
if [ -n "$BACKUP_RSYNC_DEST" ]; then
  printf 'Offsite rsync: %s\n' "$BACKUP_RSYNC_DEST"
fi
if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  printf 'Offsite rclone: %s\n' "$BACKUP_RCLONE_REMOTE"
fi
