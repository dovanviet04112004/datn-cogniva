-- Phase B (Atom-centric refactor) — study_plan_item lên cấp từ todo list
-- generic thành mixed AI-proposal + user-manual.
-- Spec: docs/plans/atom-centric.md §4.6 + §6 Phase B.
--
-- Thêm:
--   - `kind` enum: phân biệt "review" (atom due SRS) / "new" (atom mới)
--     / "practice" (quiz atom yếu) / "manual" (user tự gõ). UI sẽ render
--     mỗi kind 1 section.
--   - `metadata` jsonb: lưu context AI (why_proposed, atom_difficulty,
--     estimated_minutes, ...) — không cần cột riêng cho mỗi field.
--   - Status enum thêm 'SKIPPED': user "swap" 1 proposal → mark SKIPPED,
--     generate alternative. Khác DONE (đã làm) và PENDING (chưa làm).
--
-- Forward-compat:
--   - kind DEFAULT 'manual' → row cũ tự được mark manual, không cần migrate
--     UI cũ vẫn hiển thị bình thường.
--   - metadata DEFAULT '{}'
--   - Status SKIPPED là enum value mới (ALTER TYPE ADD VALUE) — không
--     transaction safe trong Postgres < 12, dùng workaround DROP + CREATE
--     nếu cần. Postgres 16 trong dev OK.
--
-- Rollback: ALTER TABLE study_plan_item DROP COLUMN kind, metadata;
--           (status SKIPPED stays — enum value khó remove)
BEGIN;

-- (1) Thêm enum value 'SKIPPED' vào study_plan_status
ALTER TYPE study_plan_status ADD VALUE IF NOT EXISTS 'SKIPPED';

COMMIT;

-- (2) Tạo enum mới study_plan_kind + thêm cột kind + metadata
-- (chạy ngoài BEGIN/COMMIT vì ALTER TYPE ADD VALUE phải commit trước khi
-- value mới usable trong cùng tx)
DO $$ BEGIN
  CREATE TYPE study_plan_kind AS ENUM ('manual', 'review', 'new', 'practice');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE study_plan_item
  ADD COLUMN IF NOT EXISTS kind study_plan_kind NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Index hỗ trợ query "proposal hôm nay của user" — kind != manual + due_date today
CREATE INDEX IF NOT EXISTS study_plan_user_kind_due_idx
  ON study_plan_item (user_id, kind, due_date)
  WHERE kind != 'manual';
