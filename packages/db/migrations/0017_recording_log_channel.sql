-- =============================================================================
-- Migration 0017 — Recording log channel cho study group (Phase 20 V3)
-- =============================================================================
-- Owner chọn 1 channel TEXT làm "recording log" — process-recording sẽ post
-- system message từ AI Tutor vào channel này (link replay + summary) khi
-- 1 voice recording xong.
--
-- NULL = fallback channel TEXT đầu tiên của group (theo position ASC).
-- ON DELETE SET NULL — nếu channel bị xoá, group vẫn tồn tại, sẽ fallback.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0017_recording_log_channel.sql
-- =============================================================================

ALTER TABLE "study_group"
  ADD COLUMN "recording_log_channel_id" text
    REFERENCES "study_group_channel"("id") ON DELETE SET NULL;
