#!/bin/sh
set -eu

media_dir="${MEDIA_DIR:-/app/uploads}"
seed_dir="/app/seed-media/menu"

if [ -d "$seed_dir" ]; then
  mkdir -p "$media_dir/menu"
  for file in "$seed_dir"/*.jpg; do
    [ -f "$file" ] || continue
    target="$media_dir/menu/$(basename "$file")"
    if [ ! -f "$target" ]; then
      cp "$file" "$target"
    fi
  done
fi

exec "$@"
