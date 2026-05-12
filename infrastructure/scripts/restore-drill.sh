#!/usr/bin/env bash
# =============================================================================
# restore-drill.sh — Monthly DR drill: restore backup vào staging DB
# =============================================================================
# Plan v2 §15.1 W7 — "Tested backup is the only real backup."
#
# Mục tiêu: verify backup thực sự RESTORE được, không chỉ "upload OK".
#
# Strategy:
#   1. Pick backup mới nhất từ daily/
#   2. Download về tmp
#   3. Decompress + pg_restore vào DB staging
#   4. Run sanity queries (count, sample)
#   5. Report time + integrity
#   6. DROP staging DB sau test (avoid stale)
#
# Cron (monthly Inngest schedule hoặc cron):
#   0 4 1 * *  /opt/cogniva/scripts/restore-drill.sh
#
# Required env:
#   STAGING_DATABASE_URL      empty DB cho restore test (DIFFERENT từ prod!)
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID
#   R2_BACKUP_BUCKET          default "cogniva-backups"
#   DRILL_WEBHOOK_URL         optional notify Slack/Inngest
#
# Required tools:
#   pg_restore (>= 15), zstd, aws-cli, psql
# =============================================================================

set -euo pipefail

STAGING_DATABASE_URL="${STAGING_DATABASE_URL:?STAGING_DATABASE_URL is required}"
R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET:-cogniva-backups}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:?required}"

# Safety check: staging URL không được match prod
if [[ "$STAGING_DATABASE_URL" == *"prod"* ]] || [[ "$STAGING_DATABASE_URL" == *"production"* ]]; then
  echo "[drill] ABORT: STAGING_DATABASE_URL chứa 'prod' — không an toàn để DROP/restore"
  exit 1
fi

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?required}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?required}"

TMP_DIR="$(mktemp -d /tmp/cogniva-drill.XXXXXX)"
trap "rm -rf $TMP_DIR" EXIT

START_EPOCH=$(date +%s)
echo "[drill] $(date -u +%FT%TZ) Starting restore drill..."

# ── Step 1: Find latest daily backup ──────────────────────────────
LATEST_KEY=$(aws s3 ls "s3://${R2_BACKUP_BUCKET}/daily/" \
  --endpoint-url="$R2_ENDPOINT" \
  --recursive \
  | sort -k1,2 | tail -1 | awk '{print $4}')

if [ -z "$LATEST_KEY" ]; then
  echo "[drill] FAIL: không tìm thấy backup trong s3://${R2_BACKUP_BUCKET}/daily/"
  exit 1
fi

echo "[drill] Latest backup: $LATEST_KEY"

# ── Step 2: Download ──────────────────────────────────────────────
LOCAL_COMPRESSED="${TMP_DIR}/backup.dump.zst"
echo "[drill] Downloading..."
aws s3 cp "s3://${R2_BACKUP_BUCKET}/${LATEST_KEY}" "$LOCAL_COMPRESSED" \
  --endpoint-url="$R2_ENDPOINT" \
  --no-progress

DOWNLOAD_SIZE=$(stat -c%s "$LOCAL_COMPRESSED" 2>/dev/null || stat -f%z "$LOCAL_COMPRESSED")
echo "[drill] Downloaded: $(numfmt --to=iec --suffix=B "$DOWNLOAD_SIZE")"

# ── Step 3: Decompress ────────────────────────────────────────────
LOCAL_DUMP="${TMP_DIR}/backup.dump"
echo "[drill] Decompressing..."
zstd --decompress --quiet --rm "$LOCAL_COMPRESSED" -o "$LOCAL_DUMP"

# ── Step 4: Wipe staging + restore ────────────────────────────────
echo "[drill] Cleaning staging schema..."
psql "$STAGING_DATABASE_URL" -q \
  -c "DROP SCHEMA IF EXISTS public CASCADE;" \
  -c "CREATE SCHEMA public;" \
  -c "GRANT ALL ON SCHEMA public TO public;"

echo "[drill] Restoring (sẽ mất 2-15 phút tuỳ size)..."
RESTORE_START=$(date +%s)
pg_restore \
  --dbname="$STAGING_DATABASE_URL" \
  --jobs=4 \
  --no-owner \
  --no-privileges \
  --verbose \
  "$LOCAL_DUMP" 2>&1 | tail -20 || true
RESTORE_DURATION=$(($(date +%s) - RESTORE_START))

# ── Step 5: Sanity check ──────────────────────────────────────────
echo "[drill] Running sanity queries..."

# Check critical tables exist + có row
TABLES_TO_CHECK=("user" "workspace" "document" "chunk" "flashcard" "review" "concept" "room" "room_message")
SANITY_FAIL=0

for tbl in "${TABLES_TO_CHECK[@]}"; do
  COUNT=$(psql "$STAGING_DATABASE_URL" -t -A -c "SELECT count(*) FROM \"${tbl}\";" 2>/dev/null || echo "ERROR")
  if [ "$COUNT" = "ERROR" ]; then
    echo "[drill]   ✗ ${tbl}: table missing or query fail"
    SANITY_FAIL=$((SANITY_FAIL + 1))
  else
    echo "[drill]   ✓ ${tbl}: ${COUNT} rows"
  fi
done

# Check pgvector extension (chunks embedding)
HAS_VECTOR=$(psql "$STAGING_DATABASE_URL" -t -A \
  -c "SELECT extname FROM pg_extension WHERE extname='vector';" 2>/dev/null || echo "")
if [ -n "$HAS_VECTOR" ]; then
  echo "[drill]   ✓ pgvector extension"
else
  echo "[drill]   ✗ pgvector extension MISSING"
  SANITY_FAIL=$((SANITY_FAIL + 1))
fi

# Check 1 random chunk có embedding hợp lệ
EMBED_CHECK=$(psql "$STAGING_DATABASE_URL" -t -A \
  -c "SELECT vector_dims(embedding) FROM chunk WHERE embedding IS NOT NULL LIMIT 1;" 2>/dev/null || echo "")
if [ "$EMBED_CHECK" = "1024" ]; then
  echo "[drill]   ✓ Embedding vector dim = 1024"
else
  echo "[drill]   ✗ Embedding dim = ${EMBED_CHECK} (expected 1024)"
  SANITY_FAIL=$((SANITY_FAIL + 1))
fi

TOTAL_DURATION=$(($(date +%s) - START_EPOCH))

# ── Step 6: Cleanup ───────────────────────────────────────────────
echo "[drill] Cleaning up staging DB..."
psql "$STAGING_DATABASE_URL" -q \
  -c "DROP SCHEMA IF EXISTS public CASCADE;" \
  -c "CREATE SCHEMA public;"

# ── Step 7: Report ────────────────────────────────────────────────
if [ "$SANITY_FAIL" = "0" ]; then
  STATUS="success"
  echo "[drill] ✓ DRILL PASSED — restore + sanity OK"
else
  STATUS="failed"
  echo "[drill] ✗ DRILL FAILED — $SANITY_FAIL sanity check fail"
fi

echo "[drill] Total time: ${TOTAL_DURATION}s (restore=${RESTORE_DURATION}s)"

if [ -n "${DRILL_WEBHOOK_URL:-}" ]; then
  curl -s -X POST "$DRILL_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"event\": \"drill.completed\",
      \"status\": \"$STATUS\",
      \"timestamp\": \"$(date -u +%FT%TZ)\",
      \"total_seconds\": $TOTAL_DURATION,
      \"restore_seconds\": $RESTORE_DURATION,
      \"sanity_fail\": $SANITY_FAIL,
      \"backup_key\": \"$LATEST_KEY\"
    }" || echo "[drill] Webhook fail (non-fatal)"
fi

if [ "$SANITY_FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
