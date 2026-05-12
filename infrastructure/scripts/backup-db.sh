#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — Daily Postgres backup → R2 cold storage
# =============================================================================
# Plan v2 §15.1 W7 — risk T4 + data loss mitigation.
#
# Strategy:
#   1. pg_dump custom format (-Fc) — restore-friendly, parallel
#   2. Compress với zstd (5-10% smaller than gzip, 3x faster decompress)
#   3. Upload R2 với rclone hoặc aws-cli S3-compat
#   4. Retention: daily 30 ngày → weekly 1 năm → monthly 7 năm
#   5. Log success/fail + size về Inngest webhook (Stage 2)
#
# Cron (cron.daily hoặc Inngest schedule):
#   0 2 * * *  /opt/cogniva/scripts/backup-db.sh
#
# Manual:
#   DATABASE_URL=postgresql://... ./backup-db.sh
#
# Required env:
#   DATABASE_URL              postgres connection string
#   R2_ACCESS_KEY_ID          R2 IAM
#   R2_SECRET_ACCESS_KEY
#   R2_ACCOUNT_ID
#   R2_BACKUP_BUCKET          default "cogniva-backups"
#
# Required tools:
#   pg_dump (>= 15), zstd, rclone or aws-cli
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET:-cogniva-backups}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"

DATE_STAMP="$(date -u +%Y%m%d_%H%M%S)"
DATE_FOLDER="$(date -u +%Y/%m/%d)"
DAY_OF_WEEK="$(date -u +%u)"   # 1=Mon, 7=Sun
DAY_OF_MONTH="$(date -u +%d)"

TMP_DIR="$(mktemp -d /tmp/cogniva-backup.XXXXXX)"
trap "rm -rf $TMP_DIR" EXIT

BACKUP_FILE="${TMP_DIR}/cogniva_${DATE_STAMP}.dump"
COMPRESSED_FILE="${BACKUP_FILE}.zst"

echo "[backup] $(date -u +%FT%TZ) Starting backup..."

# ── Step 1: pg_dump ───────────────────────────────────────────────
# -Fc: custom format (compressed, restorable subset)
# -j 2: 2 parallel workers (cẩn thận với pg-bouncer — dùng direct conn)
# --no-owner --no-privileges: tránh permission error khi restore khác user
echo "[backup] Dumping database..."
pg_dump \
  --format=custom \
  --jobs=2 \
  --no-owner \
  --no-privileges \
  --verbose \
  --file="$BACKUP_FILE" \
  "$DATABASE_URL" 2>&1 | tail -20

DUMP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[backup] Dump complete: $(numfmt --to=iec --suffix=B "$DUMP_SIZE")"

# ── Step 2: Compress với zstd ─────────────────────────────────────
echo "[backup] Compressing..."
zstd --quiet --threads=4 --rm -19 "$BACKUP_FILE" -o "$COMPRESSED_FILE"

COMPRESSED_SIZE=$(stat -c%s "$COMPRESSED_FILE" 2>/dev/null || stat -f%z "$COMPRESSED_FILE")
RATIO=$(awk "BEGIN { printf \"%.1f\", ${DUMP_SIZE} / ${COMPRESSED_SIZE} }")
echo "[backup] Compressed: $(numfmt --to=iec --suffix=B "$COMPRESSED_SIZE") (${RATIO}x ratio)"

# ── Step 3: Upload R2 (multiple tier theo retention) ──────────────
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

upload_to_r2() {
  local src="$1"
  local key="$2"
  echo "[backup] Upload → s3://${R2_BACKUP_BUCKET}/${key}"
  aws s3 cp "$src" "s3://${R2_BACKUP_BUCKET}/${key}" \
    --endpoint-url="$R2_ENDPOINT" \
    --no-progress
}

# Daily tier (always upload, kept 30 days qua R2 lifecycle policy)
upload_to_r2 "$COMPRESSED_FILE" "daily/${DATE_FOLDER}/cogniva_${DATE_STAMP}.dump.zst"

# Weekly tier — Sunday only (kept 1 year)
if [ "$DAY_OF_WEEK" = "7" ]; then
  upload_to_r2 "$COMPRESSED_FILE" "weekly/${DATE_FOLDER}/cogniva_${DATE_STAMP}.dump.zst"
fi

# Monthly tier — 1st of month (kept 7 years for compliance)
if [ "$DAY_OF_MONTH" = "01" ]; then
  upload_to_r2 "$COMPRESSED_FILE" "monthly/${DATE_FOLDER}/cogniva_${DATE_STAMP}.dump.zst"
fi

# ── Step 4: Verify upload (HEAD) ──────────────────────────────────
echo "[backup] Verifying upload..."
aws s3 ls "s3://${R2_BACKUP_BUCKET}/daily/${DATE_FOLDER}/cogniva_${DATE_STAMP}.dump.zst" \
  --endpoint-url="$R2_ENDPOINT" \
  > /dev/null

# ── Step 5: Post-backup hook (optional Inngest/Slack notify) ──────
if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  curl -s -X POST "$BACKUP_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"event\": \"backup.completed\",
      \"timestamp\": \"$(date -u +%FT%TZ)\",
      \"compressed_bytes\": $COMPRESSED_SIZE,
      \"original_bytes\": $DUMP_SIZE,
      \"ratio\": $RATIO
    }" || echo "[backup] Webhook notify failed (non-fatal)"
fi

echo "[backup] $(date -u +%FT%TZ) Complete. Size: $(numfmt --to=iec --suffix=B "$COMPRESSED_SIZE")"
exit 0
