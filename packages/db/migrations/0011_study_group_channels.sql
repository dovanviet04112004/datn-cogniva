-- =============================================================================
-- Migration 0011 — Study Group Channels (Phase 20 — Discord-style)
-- =============================================================================
-- Mở rộng study_group (hiện chỉ có name + invite_code) thành "Discord server":
--   - study_group_channel        : kênh TEXT / VOICE / ANNOUNCEMENT
--   - study_group_message        : tin nhắn trong TEXT channel
--   - study_group_read_state     : track lastReadMessageId per (user, channel)
--   - study_group_invite         : multi-invite (max_uses + expiry) thay invite_code đơn
--   - study_group_voice_state    : DB mirror LiveKit Cloud (ai đang trong voice nào)
-- Đồng thời:
--   - ALTER study_group thêm icon_url/banner_url/is_public/max_members
--   - ALTER study_group_member thêm nickname/muted_until/last_seen_at
--   - Mở rộng group_role enum: thêm ADMIN, MODERATOR
--   - Auto seed channel "#chung" TEXT cho mọi group cũ
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0011_study_group_channels.sql
-- =============================================================================

-- 1. ALTER study_group — thêm icon/banner/is_public/max_members
ALTER TABLE "study_group"
  ADD COLUMN IF NOT EXISTS "icon_url"    text,
  ADD COLUMN IF NOT EXISTS "banner_url"  text,
  ADD COLUMN IF NOT EXISTS "is_public"   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "max_members" integer NOT NULL DEFAULT 100;

-- 2. Mở rộng group_role enum — ADMIN (≈ owner phụ), MODERATOR (mod chat)
DO $$ BEGIN
  ALTER TYPE "group_role" ADD VALUE IF NOT EXISTS 'ADMIN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "group_role" ADD VALUE IF NOT EXISTS 'MODERATOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. ALTER study_group_member — nickname, mute, presence
ALTER TABLE "study_group_member"
  ADD COLUMN IF NOT EXISTS "nickname"     text,
  ADD COLUMN IF NOT EXISTS "muted_until"  timestamp,
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;

-- 4. Enum channel_type
DO $$ BEGIN
  CREATE TYPE "channel_type" AS ENUM ('TEXT', 'VOICE', 'ANNOUNCEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. study_group_channel — kênh trong group
CREATE TABLE IF NOT EXISTS "study_group_channel" (
  "id"                     text PRIMARY KEY,
  "group_id"               text NOT NULL REFERENCES "study_group"("id") ON DELETE CASCADE,
  "name"                   text NOT NULL,
  "type"                   "channel_type" NOT NULL,
  "topic"                  text,
  "position"               integer NOT NULL DEFAULT 0,
  "is_private"             boolean NOT NULL DEFAULT false,
  "slow_mode_seconds"      integer,
  "created_by"             text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"             timestamp NOT NULL DEFAULT now(),
  "livekit_room_name"      text,
  "voice_max_participants" integer
);
CREATE INDEX IF NOT EXISTS "study_group_channel_group_pos_idx"
  ON "study_group_channel" ("group_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "study_group_channel_livekit_idx"
  ON "study_group_channel" ("livekit_room_name")
  WHERE "livekit_room_name" IS NOT NULL;

-- 6. study_group_message — tin nhắn (soft-delete để giữ thread context)
CREATE TABLE IF NOT EXISTS "study_group_message" (
  "id"            text PRIMARY KEY,
  "channel_id"    text NOT NULL REFERENCES "study_group_channel"("id") ON DELETE CASCADE,
  "author_id"     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "content"       text NOT NULL,
  "content_type"  text NOT NULL DEFAULT 'markdown',
  "reply_to_id"   text,
  "attachments"   jsonb,
  "reactions"     jsonb,
  "pinned"        boolean NOT NULL DEFAULT false,
  "mentions"      jsonb,
  "edited_at"     timestamp,
  "deleted_at"    timestamp,
  "created_at"    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "study_group_message_channel_time_idx"
  ON "study_group_message" ("channel_id", "created_at");
CREATE INDEX IF NOT EXISTS "study_group_message_author_idx"
  ON "study_group_message" ("author_id");

-- 7. study_group_read_state — unread tracking per (user, channel)
CREATE TABLE IF NOT EXISTS "study_group_read_state" (
  "user_id"              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "channel_id"           text NOT NULL REFERENCES "study_group_channel"("id") ON DELETE CASCADE,
  "last_read_message_id" text,
  "muted"                boolean NOT NULL DEFAULT false,
  "updated_at"           timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "channel_id")
);

-- 8. study_group_invite — multi-invite (max_uses + expiry)
CREATE TABLE IF NOT EXISTS "study_group_invite" (
  "id"          text PRIMARY KEY,
  "group_id"    text NOT NULL REFERENCES "study_group"("id") ON DELETE CASCADE,
  "code"        text NOT NULL UNIQUE,
  "created_by"  text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "max_uses"    integer,
  "uses_count"  integer NOT NULL DEFAULT 0,
  "expires_at"  timestamp,
  "created_at"  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "study_group_invite_group_idx"
  ON "study_group_invite" ("group_id");

-- 9. study_group_voice_state — 1 user chỉ trong 1 voice cùng lúc
CREATE TABLE IF NOT EXISTS "study_group_voice_state" (
  "user_id"      text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "channel_id"   text NOT NULL REFERENCES "study_group_channel"("id") ON DELETE CASCADE,
  "joined_at"    timestamp NOT NULL DEFAULT now(),
  "self_muted"   boolean NOT NULL DEFAULT false,
  "server_muted" boolean NOT NULL DEFAULT false,
  "camera"       boolean NOT NULL DEFAULT false,
  "screen_share" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "study_group_voice_state_channel_idx"
  ON "study_group_voice_state" ("channel_id");

-- 10. Seed "#chung" TEXT channel cho mọi group cũ (idempotent)
-- ID dạng "auto-{groupId}" để re-run không tạo duplicate.
INSERT INTO "study_group_channel" ("id", "group_id", "name", "type", "position", "created_by")
SELECT
  'auto-' || g."id",
  g."id",
  'chung',
  'TEXT',
  0,
  g."owner_user_id"
FROM "study_group" g
WHERE NOT EXISTS (
  SELECT 1 FROM "study_group_channel" WHERE "group_id" = g."id"
);
