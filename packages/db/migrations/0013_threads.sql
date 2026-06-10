-- =============================================================================
-- Migration 0013 — Threads cho study_group_message (Phase 20 V2)
-- =============================================================================
-- Discord-style threads: 1 message root có thể bắt đầu thread, các reply
-- vào thread là message khác với `thread_root_id` trỏ về root.
--
-- Field thêm vào study_group_message:
--   - thread_root_id : NULL = root message bình thường. Có giá trị → reply
--                      trong thread của message X.
--   - thread_count   : (chỉ trên root) đếm số reply trong thread cho hiển thị
--                      "X replies" badge.
--   - thread_last_at : (chỉ trên root) timestamp reply gần nhất.
--
-- Index `study_group_message_thread_idx` cho query list reply của 1 thread.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0013_threads.sql
-- =============================================================================

ALTER TABLE "study_group_message"
  ADD COLUMN IF NOT EXISTS "thread_root_id"  text,
  ADD COLUMN IF NOT EXISTS "thread_count"    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "thread_last_at"  timestamp;

CREATE INDEX IF NOT EXISTS "study_group_message_thread_idx"
  ON "study_group_message" ("thread_root_id", "created_at")
  WHERE "thread_root_id" IS NOT NULL;
