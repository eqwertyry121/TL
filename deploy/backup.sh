#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$SCRIPT_DIR/docker-compose.api.yml"}
BACKUP_DIR=${BACKUP_DIR:-"/var/backups/tk-delivery"}
RETENTION_DAYS=${RETENTION_DAYS:-14}

case "$BACKUP_DIR" in
  ""|"/"|"/var"|"/var/backups")
    echo "Refusing unsafe BACKUP_DIR: $BACKUP_DIR" >&2
    exit 1
    ;;
esac

mkdir -p "$BACKUP_DIR"

timestamp=$(date -u +"%Y%m%dT%H%M%SZ")
db_file="$BACKUP_DIR/postgres-$timestamp.dump"
uploads_file="$BACKUP_DIR/uploads-$timestamp.tar.gz"
restore_db="tk_delivery_restore_check_$(date -u +%s)"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U tk_delivery -d tk_delivery -Fc > "$db_file"

docker compose -f "$COMPOSE_FILE" exec -T app \
  tar -czf - -C /app/uploads . > "$uploads_file"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  dropdb -U tk_delivery --if-exists "$restore_db" >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  createdb -U tk_delivery "$restore_db"

restore_ok=0
if docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U tk_delivery -d "$restore_db" --exit-on-error < "$db_file"; then
  restore_ok=1
fi

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  dropdb -U tk_delivery --if-exists "$restore_db" >/dev/null

if [ "$restore_ok" -ne 1 ]; then
  echo "Restore check failed for $db_file" >&2
  exit 1
fi

tar -tzf "$uploads_file" >/dev/null

find "$BACKUP_DIR" -type f \( -name "postgres-*.dump" -o -name "uploads-*.tar.gz" \) -mtime +"$RETENTION_DAYS" -delete

printf 'Backup OK\nPostgreSQL: %s\nUploads: %s\nRestore check DB: %s\n' "$db_file" "$uploads_file" "$restore_db"
