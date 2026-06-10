#!/usr/bin/env bash
# Apply 1 raw SQL migration file vào Postgres container.
#
# Usage:
#   bash packages/db/scripts/apply-raw-mig.sh 0036_group_v2_custom_roles.sql
#
# Reason: `drizzle-kit migrate` không work vì _journal.json out of date so
# với hand-written SQL từ 0003 trở đi. Tạm dùng docker exec psql.
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: $0 <migration-file-name>"
  exit 1
fi

MIG_PATH="packages/db/migrations/$FILE"
if [ ! -f "$MIG_PATH" ]; then
  echo "❌ Migration file không tồn tại: $MIG_PATH"
  exit 1
fi

CONTAINER="${POSTGRES_CONTAINER:-cogniva-postgres}"
DB_USER="${POSTGRES_USER:-cogniva}"
DB_NAME="${POSTGRES_DB:-cogniva}"

echo "📦 Applying $FILE to $CONTAINER ($DB_USER@$DB_NAME)..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$MIG_PATH"
echo "✅ Done"
