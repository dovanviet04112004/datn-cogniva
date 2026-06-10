-- Migration 0027: thêm read_at cho notification_log để track user đã xem hay chưa.
-- Phase 2 follow-up — wire NotificationBell ở app topbar.
--
-- read_at = NULL → unread → hiện trong badge count.
-- read_at = NOW() → user đã xem (click vào panel hoặc "mark all read").

ALTER TABLE "notification_log"
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP;

-- Partial index cho unread query (user_id + WHERE read_at IS NULL ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS "idx_notification_log_unread"
  ON "notification_log" ("user_id", "created_at" DESC)
  WHERE "read_at" IS NULL;
