-- =============================================================================
-- Migration 0020 — Forum channel (Phase 20 V3)
-- =============================================================================
-- Forum channel = Discord-style: mỗi post = 1 thread riêng, sort theo recent
-- activity. Tag system cho phép phân loại post.
--
-- Reuse `study_group_message` table — không tạo bảng riêng:
--   - Forum post = message với threadRootId IS NULL trong channel type=FORUM
--   - Reply = message với threadRootId trỏ về forum post
--   - threadCount + threadLastAt đã có sẵn (Phase 20 V2 threads)
--
-- Schema thay đổi:
--   1. ADD 'FORUM' vào channel_type enum.
--   2. ALTER study_group_message ADD title (NULL trừ post FORUM).
--   3. ALTER study_group_message ADD tags jsonb (mảng string slug tag).
--   4. ALTER study_group_channel ADD available_tags jsonb (tag list mod config).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0020_forum_channel.sql
-- =============================================================================

ALTER TYPE "channel_type" ADD VALUE IF NOT EXISTS 'FORUM';

ALTER TABLE "study_group_message"
  ADD COLUMN IF NOT EXISTS "title" text,
  ADD COLUMN IF NOT EXISTS "tags" jsonb;

ALTER TABLE "study_group_channel"
  ADD COLUMN IF NOT EXISTS "available_tags" jsonb;

-- Index cho list forum posts: channel + threadRootId IS NULL + sort theo
-- threadLastAt DESC (most recent activity) hoặc createdAt DESC.
CREATE INDEX IF NOT EXISTS "study_group_message_forum_idx"
  ON "study_group_message" ("channel_id", "thread_last_at" DESC)
  WHERE "thread_root_id" IS NULL AND "deleted_at" IS NULL;
