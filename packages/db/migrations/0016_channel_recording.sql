-- =============================================================================
-- Migration 0016 — Voice channel recording (Phase 20 V3)
-- =============================================================================
-- Cho phép `recording` row liên kết với study_group_channel (voice channel),
-- không chỉ standalone `room` (Phase 13/15).
--
-- Thay đổi:
--   1. room_id → nullable (recording có thể thuộc về channel thay vì room).
--   2. Thêm study_group_channel_id (nullable, FK CASCADE) — channel sở hữu rec.
--   3. CHECK constraint: đúng 1 trong 2 cột phải có giá trị (XOR semantics).
--   4. Index riêng cho channel_id để query "recordings của channel này".
--   5. Thêm `created_by` (NULL nếu user xoá account) — để filter "do tôi ghi".
--
-- Pipeline reuse: Inngest `process-recording` extend payload với channelId optional;
-- webhook livekit route egress_ended theo prefix 'group:' tới channel handler.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0016_channel_recording.sql
-- =============================================================================

ALTER TABLE "recording"
  ALTER COLUMN "room_id" DROP NOT NULL;

ALTER TABLE "recording"
  ADD COLUMN "study_group_channel_id" text
    REFERENCES "study_group_channel"("id") ON DELETE CASCADE;

ALTER TABLE "recording"
  ADD COLUMN "created_by" text
    REFERENCES "user"("id") ON DELETE SET NULL;

-- Owner constraint — chính xác 1 trong 2 must be present.
ALTER TABLE "recording"
  ADD CONSTRAINT "recording_owner_xor"
    CHECK (
      ("room_id" IS NOT NULL AND "study_group_channel_id" IS NULL)
      OR
      ("room_id" IS NULL AND "study_group_channel_id" IS NOT NULL)
    );

-- Index cho list query "recordings của channel"
CREATE INDEX IF NOT EXISTS "recording_channel_idx"
  ON "recording"("study_group_channel_id", "started_at" DESC);
