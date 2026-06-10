-- Migration 0029: thêm moderation fields cho tutor_review.
-- Phase 4 admin tutoring moderation.
--
-- hidden_at != NULL → review không hiển thị trên tutor profile (filter ở
-- product query). Hidden review vẫn lưu để forensic + có thể restore.

ALTER TABLE "tutor_review"
  ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "hidden_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "hidden_by" TEXT REFERENCES "user"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_tutor_review_visible"
  ON "tutor_review" ("tutor_id", "created_at" DESC)
  WHERE "hidden_at" IS NULL;
