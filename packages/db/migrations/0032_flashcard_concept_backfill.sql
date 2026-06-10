-- Phase A2 (Atom-centric refactor) — nối lại link flashcard ↔ concept ↔ mastery.
-- Spec: docs/plans/atom-centric.md §3.3.
--
-- Vấn đề: flashcard.concept_id luôn NULL khi generate (route flashcards/
-- generate/route.ts không set). Hậu quả: review flashcard không update
-- mastery → graph + study plan không biết user yếu atom nào.
--
-- Migration làm 3 việc:
--   (1) Populate flashcard.concept_id cho rows cũ qua chunk_concept pivot,
--       chọn concept có strength cao nhất.
--   (2) Backfill mastery cho từng (user × concept) đã có flashcard, dùng
--       heuristic theo FSRS state:
--          state=REVIEW   → score 0.70 (user đã ôn ổn định)
--          state=LEARNING → score 0.30 (đang học)
--          state=NEW      → score 0.00 (chưa learn)
--          state=RELEARNING→ score 0.20 (vừa quên)
--       Aggregate qua AVG nếu user có nhiều flashcard/atom → score trung bình.
--       Chỉ INSERT nếu chưa có row mastery (ON CONFLICT DO NOTHING).
--   (3) Thêm composite index flashcard (concept_id, user_id) để query
--       "flashcard của 1 atom của user" nhanh.
--
-- Rollback: không thực dụng (data đã populate). Nếu cần undo: UPDATE
-- flashcard SET concept_id=NULL; TRUNCATE mastery; DROP INDEX flashcard_concept_user_idx;
BEGIN;

-- (1) Populate flashcard.concept_id từ chunk_concept (strongest match)
UPDATE flashcard f
SET concept_id = sub.concept_id
FROM (
  SELECT DISTINCT ON (chunk_id)
    chunk_id,
    concept_id
  FROM chunk_concept
  ORDER BY chunk_id, strength DESC, concept_id
) sub
WHERE f.source_chunk_id = sub.chunk_id
  AND f.concept_id IS NULL
  AND f.source_chunk_id IS NOT NULL;

-- (2) Backfill mastery với heuristic theo FSRS state. Group by (user, concept)
-- để 1 user có nhiều card cùng atom thì lấy AVG score heuristic.
INSERT INTO mastery (id, user_id, concept_id, score, attempts, correct, last_seen_at)
SELECT
  -- id auto-gen qua cuid2: generate trong app layer thường, nhưng migration
  -- script dùng gen_random_uuid + cast text. SQL chạy 1 lần, ID format khác
  -- cuid2 không phá schema (cột là text). Đánh dấu là "backfill" qua prefix.
  'mig_' || substring(md5(random()::text || u.user_id || u.concept_id) for 16),
  u.user_id,
  u.concept_id,
  u.avg_score,
  u.card_count,                  -- attempts ≈ số card đã thấy
  (u.avg_score >= 0.5)::int * u.card_count, -- correct ≈ attempts khi score đủ
  NOW()
FROM (
  SELECT
    f.user_id,
    f.concept_id,
    AVG(CASE
      WHEN f.state = 'REVIEW'     THEN 0.70
      WHEN f.state = 'LEARNING'   THEN 0.30
      WHEN f.state = 'RELEARNING' THEN 0.20
      ELSE 0.00
    END)::real AS avg_score,
    COUNT(*)::int AS card_count
  FROM flashcard f
  WHERE f.concept_id IS NOT NULL
  GROUP BY f.user_id, f.concept_id
) u
ON CONFLICT (user_id, concept_id) DO NOTHING;

-- (3) Index hỗ trợ truy vấn "flashcard của atom X của user Y"
CREATE INDEX IF NOT EXISTS flashcard_concept_user_idx
  ON flashcard (concept_id, user_id)
  WHERE concept_id IS NOT NULL;

COMMIT;
