-- Migration 0037 — Batch V2 G2/G3/G4 polish.
--
-- Spec: docs/plans/study-group-v2.md §G2 + §G3 + §G4.
--
-- 4 thay đổi:
--   1. CREATE TABLE study_group_message_revision — track edit history per message
--   2. ALTER user ADD status / statusText / statusEmoji / statusExpiresAt (G3 presence)
--   3. ALTER study_group_read_state ADD notification_setting enum (G4 per-channel pref)
--      + backfill từ existing `muted` boolean → 'none' nếu muted else 'all'
--   4. ADD generated tsvector + GIN index trên study_group_message.content (G6 FTS prep)
--
-- Backward-compat: cột `muted` vẫn giữ — code cũ đọc OK. UI mới đọc
-- `notification_setting`, bumped khi user pick từ dropdown.

BEGIN;

-- ─── 1. study_group_message_revision (edit history) ──────────────────────
CREATE TABLE IF NOT EXISTS study_group_message_revision (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES study_group_message(id) ON DELETE CASCADE,
  content text NOT NULL,
  edited_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_group_message_revision_msg_idx
  ON study_group_message_revision (message_id, edited_at DESC);

-- ─── 2. user status columns (G3 presence) ────────────────────────────────
-- 'online' default; 'invisible' = appear offline but receive messages.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'online'
    CHECK (status IN ('online', 'idle', 'dnd', 'offline', 'invisible'));

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS status_text text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS status_emoji text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS status_expires_at timestamp;

-- ─── 3. per-channel notification setting (G4) ────────────────────────────
ALTER TABLE study_group_read_state
  ADD COLUMN IF NOT EXISTS notification_setting text NOT NULL DEFAULT 'all'
    CHECK (notification_setting IN ('all', 'mentions', 'none'));

-- Backfill từ existing muted boolean
UPDATE study_group_read_state
  SET notification_setting = CASE WHEN muted THEN 'none' ELSE 'all' END
WHERE notification_setting = 'all';
-- Note: row mới insert default 'all'; row cũ với muted=true sẽ thành 'none'.

-- ─── 4. Postgres FTS tsvector + GIN index (G6 prep) ──────────────────────
-- Generated column auto-update khi content thay đổi.
ALTER TABLE study_group_message
  ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(content, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS study_group_message_search_idx
  ON study_group_message USING GIN (search_vec);

COMMIT;
