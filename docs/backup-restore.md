# Backup and Restore

Status: MVP VPS procedure.

The backend keeps business state in PostgreSQL and menu photos/uploads in the
uploads mount visible inside the app container at `/app/uploads`. In production
templates this mount is a host directory (`MEDIA_VOLUME_HOST_PATH`, default
`/srv/tk-delivery/uploads`) so Nginx can serve `/media/` directly. Both
PostgreSQL and uploads must be backed up.

## Script

Run on the VPS from the repository checkout:

```sh
cd /path/to/TL
BACKUP_DIR=/var/backups/tk-delivery sh ./deploy/backup.sh
```

The script creates:

- `postgres-YYYYMMDDTHHMMSSZ.dump` with `pg_dump -Fc`;
- `uploads-YYYYMMDDTHHMMSSZ.tar.gz`;
- a temporary restore-check database, restored from the dump and then deleted.

If restore check fails, the script exits non-zero.

## Environment

Optional variables:

```sh
COMPOSE_FILE=/path/to/deploy/docker-compose.api.yml
BACKUP_DIR=/var/backups/tk-delivery
RETENTION_DAYS=14
BACKUP_RSYNC_DEST=backup-user@backup-host:/backups/tk-delivery
BACKUP_RCLONE_REMOTE=remote:tk-delivery
```

`BACKUP_DIR` must be a dedicated directory. The script refuses broad locations
like `/`, `/var`, and `/var/backups`.

## Cron

Example daily run at 03:20 Belgrade server time:

```cron
20 3 * * * cd /home/codex/TL && BACKUP_DIR=/var/backups/tk-delivery sh ./deploy/backup.sh >> /var/log/tk-delivery-backup.log 2>&1
```

## Off-VPS Copy

A backup that stays only on the same VPS is not enough. `deploy/backup.sh`
can copy the exact dump and uploads archive after the local restore check:

- set `BACKUP_RSYNC_DEST` to push both files to another server with `rsync`;
- or set `BACKUP_RCLONE_REMOTE` to push both files to an rclone remote.

If either variable is set and the external copy fails, the script exits non-zero.

The external copy must include both dump and uploads archive from the same
timestamp.

## PII Retention

`PII_RETENTION_DAYS` controls automatic cleanup of old personal data. Closed
orders older than this value keep totals/status/history but clear phone,
address and customer comment. User phone data is also cleared when the user has
no active or recent orders. Default: `730` days.

## Manual Restore Check

To inspect a dump manually without touching production DB:

```sh
docker compose -f deploy/docker-compose.api.yml exec -T postgres createdb -U tk_delivery tk_delivery_restore_manual
docker compose -f deploy/docker-compose.api.yml exec -T postgres pg_restore -U tk_delivery -d tk_delivery_restore_manual --exit-on-error < /var/backups/tk-delivery/postgres-YYYYMMDDTHHMMSSZ.dump
docker compose -f deploy/docker-compose.api.yml exec -T postgres dropdb -U tk_delivery tk_delivery_restore_manual
```

To inspect uploads:

```sh
tar -tzf /var/backups/tk-delivery/uploads-YYYYMMDDTHHMMSSZ.tar.gz
```

## Production Gate

Before active launch:

- run `sh ./deploy/backup.sh` successfully on the VPS;
- verify that the restore check passes;
- verify that an off-VPS copy exists;
- record where backups are stored and who can restore them.
