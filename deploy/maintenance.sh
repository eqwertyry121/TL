#!/usr/bin/env sh
set -eu

DISK_PATH=${DISK_PATH:-/}
MIN_FREE_DISK_MB=${MIN_FREE_DISK_MB:-1024}
BUILDER_CACHE_MAX_AGE=${BUILDER_CACHE_MAX_AGE:-24h}

case "$MIN_FREE_DISK_MB" in
  ""|*[!0-9]*)
    echo "MIN_FREE_DISK_MB must be an integer" >&2
    exit 2
    ;;
esac

# Only disposable build cache and dangling images are removed. Containers,
# named volumes, PostgreSQL data and uploaded media are never touched.
docker builder prune --all --force --filter "until=$BUILDER_CACHE_MAX_AGE" >/dev/null
docker image prune --force >/dev/null

free_disk_mb=$(df -Pk "$DISK_PATH" | awk 'NR == 2 { print int($4 / 1024) }')
if [ "$free_disk_mb" -lt "$MIN_FREE_DISK_MB" ]; then
  # A build performed moments ago may itself consume the remaining disk. In
  # that case reclaim all disposable builder cache before declaring failure.
  docker builder prune --all --force >/dev/null
  free_disk_mb=$(df -Pk "$DISK_PATH" | awk 'NR == 2 { print int($4 / 1024) }')
fi
printf 'Free disk: %s MB\n' "$free_disk_mb"
if [ "$free_disk_mb" -lt "$MIN_FREE_DISK_MB" ]; then
  echo "Free disk is below ${MIN_FREE_DISK_MB} MB" >&2
  exit 1
fi
