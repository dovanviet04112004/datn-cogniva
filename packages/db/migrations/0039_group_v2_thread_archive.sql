-- Migration 0039 — V2 G6.3 thread auto-archive.
--
-- Spec: docs/plans/study-group-v2.md §G6.
--
-- Discord pattern: thread idle > 7 ngày → auto-archive. Reply mới sẽ
-- unarchive (set archived_at = null). Inngest cron daily handle.
--
-- 2 thay đổi:
--   1. ADD study_group_message.archived_at timestamp nullable
--   2. Partial index để query active threads nhanh (archived_at IS NULL)

BEGIN;

ALTER TABLE study_group_message
  ADD COLUMN IF NOT EXISTS archived_at timestamp;

-- Index hỗ trợ:
--   - List active threads trong channel: WHERE channel_id=X AND thread_root_id IS NULL
--     AND thread_count > 0 AND archived_at IS NULL ORDER BY thread_last_at DESC
--   - Cron quét stale: WHERE thread_count > 0 AND archived_at IS NULL AND thread_last_at < cutoff
CREATE INDEX IF NOT EXISTS study_group_message_thread_active_idx
  ON study_group_message (channel_id, thread_last_at DESC)
  WHERE archived_at IS NULL
    AND thread_root_id IS NULL
    AND thread_count > 0;

COMMIT;
