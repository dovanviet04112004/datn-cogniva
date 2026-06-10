-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0022 — Workspace-centric (Phase 21 prep)
--
-- Mục tiêu: notes/flashcards/quizzes/exams trở thành workspace-scoped để
-- workspace detail page có thể tabs hiển thị tất cả content của workspace
-- (Notion/Quizlet pattern).
--
-- Thay đổi:
--   1. ALTER TABLE: thêm cột workspace_id nullable + FK ON DELETE SET NULL
--   2. CREATE INDEX cho (user_id, workspace_id) composite query
--   3. BACKFILL: rows hiện có → set workspace_id = workspace đầu tiên (theo
--      created_at) của user. Nếu user chưa có workspace nào thì để NULL —
--      lib/workspace.ts sẽ auto-tạo "Default" khi upload đầu tiên.
--
-- Rollback: ALTER TABLE … DROP COLUMN workspace_id; DROP INDEX...
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add columns + FK
ALTER TABLE "note" ADD COLUMN IF NOT EXISTS "workspace_id" text;
ALTER TABLE "note" ADD CONSTRAINT "note_workspace_id_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE SET NULL;

ALTER TABLE "flashcard" ADD COLUMN IF NOT EXISTS "workspace_id" text;
ALTER TABLE "flashcard" ADD CONSTRAINT "flashcard_workspace_id_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE SET NULL;

ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "workspace_id" text;
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_workspace_id_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE SET NULL;

ALTER TABLE "exam" ADD COLUMN IF NOT EXISTS "workspace_id" text;
ALTER TABLE "exam" ADD CONSTRAINT "exam_workspace_id_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE SET NULL;

-- 2. Composite indexes
CREATE INDEX IF NOT EXISTS "note_user_workspace_idx"
  ON "note" ("user_id", "workspace_id");
CREATE INDEX IF NOT EXISTS "flashcard_user_workspace_idx"
  ON "flashcard" ("user_id", "workspace_id");
CREATE INDEX IF NOT EXISTS "quiz_user_workspace_idx"
  ON "quiz" ("user_id", "workspace_id");
CREATE INDEX IF NOT EXISTS "exam_owner_workspace_idx"
  ON "exam" ("owner_id", "workspace_id");

-- 3. Backfill: mỗi user → set workspace_id của các row chưa thuộc workspace nào
--    = workspace đầu tiên của user (theo created_at). Dùng subquery lateral.

UPDATE "note" SET "workspace_id" = (
  SELECT w.id FROM "workspace" w
  WHERE w.user_id = "note".user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE "workspace_id" IS NULL;

UPDATE "flashcard" SET "workspace_id" = (
  SELECT w.id FROM "workspace" w
  WHERE w.user_id = "flashcard".user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE "workspace_id" IS NULL;

UPDATE "quiz" SET "workspace_id" = (
  SELECT w.id FROM "workspace" w
  WHERE w.user_id = "quiz".user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE "workspace_id" IS NULL;

UPDATE "exam" SET "workspace_id" = (
  SELECT w.id FROM "workspace" w
  WHERE w.user_id = "exam".owner_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE "workspace_id" IS NULL;
