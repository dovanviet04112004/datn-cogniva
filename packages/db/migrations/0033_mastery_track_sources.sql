-- Phase A3 (Atom-centric refactor) — track event source trên mastery.
-- Spec: docs/plans/atom-centric.md §3.4.
--
-- Hiện tại mastery chỉ có `last_seen_at` duy nhất. Sau khi connect cả 3
-- feature (flashcard / quiz / exam) đều gọi applyAttempt, cần biết RIÊNG
-- timestamp lần cuối từng feature để:
--   - Dashboard /admin/ai biết phân phối review theo nguồn
--   - Study plan ưu tiên atom chưa review qua format khác (đa dạng hoá học)
--   - User analytics: "anh đã review 50 lần qua flashcard nhưng chưa quiz"
--
-- Forward-compat: nullable, default NULL → code cũ không động vào field này
-- vẫn chạy. Code mới sẽ SET timestamp theo từng route.
-- Rollback: ALTER TABLE mastery DROP COLUMN last_quiz_at, last_flashcard_at, last_exam_at;
ALTER TABLE mastery
  ADD COLUMN IF NOT EXISTS last_quiz_at      timestamp,
  ADD COLUMN IF NOT EXISTS last_flashcard_at timestamp,
  ADD COLUMN IF NOT EXISTS last_exam_at      timestamp;
