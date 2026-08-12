# Backup and Restore

Status: MVP VPS procedure.

The backend keeps business state in PostgreSQL and menu photos/uploads in the
Docker volume mounted at `/app/uploads`. Both must be backed up.

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
```

`BACKUP_DIR` must be a dedicated directory. The script refuses broad locations
like `/`, `/var`, and `/var/backups`.

## Cron

Example daily run at 03:20 Belgrade server time:

```cron
20 3 * * * cd /home/codex/TL && BACKUP_DIR=/var/backups/tk-delivery sh ./deploy/backup.sh >> /var/log/tk-delivery-backup.log 2>&1
```

## Off-VPS Copy

A backup that stays only on the same VPS is not enough. Sync the backup
directory to external storage after each successful run. Use the provider chosen
for the restaurant, for example S3-compatible storage, rsync to another server,
or another encrypted backup tool.

The external copy must include both dump and uploads archive from the same
timestamp.

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
