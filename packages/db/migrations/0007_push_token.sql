-- =============================================================================
-- Migration 0007 — Push notification (Stage 2 M7)
-- =============================================================================
-- Mobile push delivery: lưu Expo Push Token + notif audit log.
--   - `push_token`: 1 row / device / user. UNIQUE(token) để dedupe reinstall.
--   - `notification_log`: audit + dedupe (FSRS reminder chỉ gửi 1 lần / 24h).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0007_push_token.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "push_token" (
  "id"           text PRIMARY KEY,
  "user_id"      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token"        text NOT NULL UNIQUE,
  "platform"     text NOT NULL,
  "device_id"    text,
  "enabled"      boolean NOT NULL DEFAULT true,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now()
);

-- Inngest worker query "tất cả token đang active của user X" → đánh index
-- theo user_id. Vì 99% query có filter enabled = true, partial index tốt hơn
-- nhưng giữ simple full index cho dev velocity (table size ~ 1 row/user).
CREATE INDEX IF NOT EXISTS "push_token_user_idx" ON "push_token" ("user_id");

-- UNIQUE token đã tự tạo index, nhưng đặt tên rõ ràng cho debugging:
CREATE UNIQUE INDEX IF NOT EXISTS "push_token_token_idx" ON "push_token" ("token");


CREATE TABLE IF NOT EXISTS "notification_log" (
  "id"          text PRIMARY KEY,
  "user_id"     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type"        text NOT NULL,
  "title"       text NOT NULL,
  "body"        text NOT NULL,
  "data"        jsonb,
  "status"      text NOT NULL DEFAULT 'pending',
  "receipt_id"  text,
  "error"       text,
  "sent_at"     timestamp,
  "created_at"  timestamp NOT NULL DEFAULT now()
);

-- Dedupe query Inngest worker:
--   SELECT 1 FROM notification_log
--   WHERE user_id = $1 AND type = $2 AND created_at > now() - interval '24h'
-- → index 3 cột (user_id, type, created_at DESC) cover full predicate.
CREATE INDEX IF NOT EXISTS "notification_log_user_type_idx"
  ON "notification_log" ("user_id", "type", "created_at" DESC);
