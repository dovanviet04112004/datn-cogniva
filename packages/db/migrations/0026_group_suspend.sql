-- Migration 0026: thêm suspend cho study_group (admin moderation).
-- Phase 2 admin console — cho phép admin suspend group nhạy cảm/spam.
--
-- Khi suspended_at != NULL:
--   - Member không gửi được message mới (chặn ở route handler)
--   - Group ẩn khỏi public explore
--   - Owner thấy banner "Group bị suspend bởi admin: <reason>"
--
-- Unsuspend = SET suspended_at = NULL, suspend_reason = NULL.

ALTER TABLE "study_group"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "suspend_reason" TEXT;

-- Partial index để query "groups đang suspend" nhanh — admin moderation list.
CREATE INDEX IF NOT EXISTS "idx_study_group_suspended"
  ON "study_group" ("suspended_at")
  WHERE "suspended_at" IS NOT NULL;
