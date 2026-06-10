-- =============================================================================
-- Migration 0019 — Stage channel (Phase 20 V3)
-- =============================================================================
-- Stage channel = Discord-style audience + speakers. Khác VOICE:
--   - Mọi user join mặc định role AUDIENCE (canPublish=false trên LiveKit).
--   - SPEAKER được mod/admin promote → canPublish=true.
--   - Audience có thể raise-hand → mod thấy → click promote.
--
-- Schema thay đổi:
--   1. ADD 'STAGE' vào channel_type enum.
--   2. Tạo `study_group_stage_role` table: (userId, channelId, role, raisedAt).
--      Reuse `study_group_voice_state` cho mic/cam state — chỉ thêm role layer.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0019_stage_channel.sql
-- =============================================================================

ALTER TYPE "channel_type" ADD VALUE IF NOT EXISTS 'STAGE';

CREATE TABLE IF NOT EXISTS "study_group_stage_role" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL REFERENCES "study_group_channel"("id") ON DELETE CASCADE,
  /** AUDIENCE | SPEAKER. MOD role check qua study_group_member.role. */
  "role" text NOT NULL DEFAULT 'AUDIENCE',
  /** Timestamp khi user raise hand. NULL = không giơ tay. */
  "raised_at" timestamp,
  "promoted_at" timestamp,
  PRIMARY KEY ("user_id", "channel_id")
);

CREATE INDEX IF NOT EXISTS "study_group_stage_role_channel_idx"
  ON "study_group_stage_role" ("channel_id", "role");

CREATE INDEX IF NOT EXISTS "study_group_stage_role_raised_idx"
  ON "study_group_stage_role" ("channel_id", "raised_at")
  WHERE "raised_at" IS NOT NULL;
