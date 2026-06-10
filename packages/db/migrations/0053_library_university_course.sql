-- ============================================================================
-- Migration 0053 — Library University → Course model (2026-05-27)
--
-- Pivot từ subject-taxonomy cứng (K-12) sang University → Course → Doc giống
-- Studocu/Course Hero. Cho phép đại học chuyên ngành (vd "Hệ thống nhúng").
--
-- Quyết định:
--   - User tự tạo university/course khi upload (UGC + autocomplete dedup)
--   - Course optional university (course general như "Giải tích 1" dạy nhiều trường)
--   - subject_slug cũ GIỮ trong DB (backward-compat migrate) nhưng UI chuyển sang course
--
-- search_vec regen để index course_name_cache (denormalize — search "hệ nhúng"
-- match qua tên course).
-- ============================================================================

-- 1. University
CREATE TABLE IF NOT EXISTS library_university (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,           -- 'hust', 'vnu-uet', 'hcmut'
  name text NOT NULL,                  -- 'Đại học Bách Khoa Hà Nội'
  short_name text,                     -- 'HUST'
  country text NOT NULL DEFAULT 'VN',
  logo_url text,
  doc_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE library_university IS
  'Trường đại học/tổ chức giáo dục. UGC: user tạo khi upload, admin merge duplicate sau.';

-- 2. Course
CREATE TABLE IF NOT EXISTS library_course (
  id text PRIMARY KEY,
  /* nullable — course general (không thuộc trường cụ thể). ON DELETE SET NULL
     để xoá trường không mất course. */
  university_id text REFERENCES library_university(id) ON DELETE SET NULL,
  code text,                           -- 'EE3501' (optional)
  name text NOT NULL,                  -- 'Hệ thống nhúng'
  /* slug normalize để dedup trong cùng scope (university). */
  slug text NOT NULL,
  /* Liên kết broad area (legacy subject slug) để group/filter. Optional. */
  subject_area text,
  doc_count integer NOT NULL DEFAULT 0,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);

-- Dedup: 1 course slug / university (coalesce '' cho general courses).
CREATE UNIQUE INDEX IF NOT EXISTS library_course_uniq
  ON library_course (COALESCE(university_id, ''), slug);
CREATE INDEX IF NOT EXISTS library_course_university_idx
  ON library_course (university_id, doc_count DESC);
CREATE INDEX IF NOT EXISTS library_course_subject_idx
  ON library_course (subject_area);

COMMENT ON TABLE library_course IS
  'Môn học/khoá học. Optional university. Doc gắn vào course (đơn vị phân loại chính, thay subject taxonomy K-12).';

-- 3. library_doc — thêm course/university refs + cache cho search
ALTER TABLE library_doc
  ADD COLUMN IF NOT EXISTS course_id text REFERENCES library_course(id) ON DELETE SET NULL;
ALTER TABLE library_doc
  ADD COLUMN IF NOT EXISTS university_id text REFERENCES library_university(id) ON DELETE SET NULL;
ALTER TABLE library_doc
  ADD COLUMN IF NOT EXISTS course_name_cache text;

CREATE INDEX IF NOT EXISTS library_doc_course_idx
  ON library_doc (course_id, status);
CREATE INDEX IF NOT EXISTS library_doc_university_idx
  ON library_doc (university_id, status);

-- 4. Regen search_vec để include course_name_cache (weight A — quan trọng như title)
DROP INDEX IF EXISTS library_doc_search_vec_gin;
ALTER TABLE library_doc DROP COLUMN IF EXISTS search_vec;
ALTER TABLE library_doc ADD COLUMN search_vec tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(course_name_cache, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(ai_summary, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(preview_text, '')), 'D')
) STORED;
CREATE INDEX IF NOT EXISTS library_doc_search_vec_gin
  ON library_doc USING gin(search_vec);

COMMENT ON COLUMN library_doc.course_name_cache IS
  'Denormalize tên course (+ code) để index vào search_vec. Update khi đổi course.';
