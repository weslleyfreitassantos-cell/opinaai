#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL precisa estar definida}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$BACKUP_DIR/opinaai-$STAMP.dump"

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$OUTPUT"
find "$BACKUP_DIR" -type f -name 'opinaai-*.dump' -mtime "+$RETENTION_DAYS" -delete
printf 'Backup criado em %s\n' "$OUTPUT"
