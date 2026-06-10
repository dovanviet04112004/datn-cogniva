-- Phase A1 (Atom-centric refactor) — "lên cấp" bảng concept thành atom đầy đủ.
-- Spec: docs/plans/atom-centric.md §3.2.
--
-- Thêm 4 field giúp concept đứng độc lập (không cần JOIN chunk mới có nội
-- dung học): examples cụ thể, difficulty estimate (0..1, dùng cho study
-- plan sắp xếp), preview Q/A để show ngay ở UI (atom detail card).
--
-- Forward-compat: tất cả nullable + có default → chạy migration không phá
-- code cũ. Code mới sẽ populate dần khi extract.
-- Rollback: ALTER TABLE concept DROP COLUMN examples, difficulty, preview_question, preview_answer;
ALTER TABLE concept
  ADD COLUMN IF NOT EXISTS examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS difficulty real,
  ADD COLUMN IF NOT EXISTS preview_question text,
  ADD COLUMN IF NOT EXISTS preview_answer text;

-- Index difficulty để study plan query "atom khó nhất user chưa làm".
CREATE INDEX IF NOT EXISTS concept_difficulty_idx ON concept (difficulty);
