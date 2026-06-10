-- =============================================================================
-- Migration 0012 — Direct Messages (Phase 20 V2)
-- =============================================================================
-- Chat 1-1 giữa 2 user, độc lập với study group.
--
-- Schema:
--   - dm_thread : 1 row cho mỗi cặp (user1, user2). user1_id < user2_id để
--                 unique cặp không phụ thuộc thứ tự.
--   - dm_message: tin nhắn trong thread. Reuse cấu trúc tương tự
--                 study_group_message (content, attachments, reactions, reply,
--                 edit/delete soft).
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0012_direct_messages.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "dm_thread" (
  "id"          text PRIMARY KEY,
  "user1_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "user2_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "last_message_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "dm_thread_user_order_chk" CHECK ("user1_id" < "user2_id"),
  CONSTRAINT "dm_thread_users_uniq" UNIQUE ("user1_id", "user2_id")
);
CREATE INDEX IF NOT EXISTS "dm_thread_user1_last_idx"
  ON "dm_thread" ("user1_id", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "dm_thread_user2_last_idx"
  ON "dm_thread" ("user2_id", "last_message_at" DESC);

CREATE TABLE IF NOT EXISTS "dm_message" (
  "id"           text PRIMARY KEY,
  "thread_id"    text NOT NULL REFERENCES "dm_thread"("id") ON DELETE CASCADE,
  "author_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "content"      text NOT NULL,
  "reply_to_id"  text,
  "attachments"  jsonb,
  "reactions"    jsonb,
  "edited_at"    timestamp,
  "deleted_at"   timestamp,
  "created_at"   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dm_message_thread_time_idx"
  ON "dm_message" ("thread_id", "created_at");

-- Read state per (user, thread)
CREATE TABLE IF NOT EXISTS "dm_read_state" (
  "user_id"              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "thread_id"            text NOT NULL REFERENCES "dm_thread"("id") ON DELETE CASCADE,
  "last_read_message_id" text,
  "updated_at"           timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "thread_id")
);
