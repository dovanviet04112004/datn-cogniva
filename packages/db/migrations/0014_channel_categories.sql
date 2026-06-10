-- =============================================================================
-- Migration 0014 — Channel Categories (Phase 20 V2)
-- =============================================================================
-- Discord-style categories: group các channel vào folder collapsible.
--
-- Schema:
--   - study_group_category: id, group_id, name, position
--   - study_group_channel: thêm cột category_id (NULL = không thuộc category nào)
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0014_channel_categories.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "study_group_category" (
  "id"          text PRIMARY KEY,
  "group_id"    text NOT NULL REFERENCES "study_group"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "position"    integer NOT NULL DEFAULT 0,
  "created_at"  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "study_group_category_group_pos_idx"
  ON "study_group_category" ("group_id", "position");

ALTER TABLE "study_group_channel"
  ADD COLUMN IF NOT EXISTS "category_id" text REFERENCES "study_group_category"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "study_group_channel_category_idx"
  ON "study_group_channel" ("category_id", "position");
