-- 0054: Diacritic-insensitive search cho library_doc (2026-05-28)
--
-- Tiếng Việt: user thường gõ KHÔNG dấu ("giai tich" thay vì "giải tích").
-- FTS 'simple' phân biệt dấu → "giai tich" không match. Fix: unaccent cả 2 phía
-- (index + query) để bỏ dấu trước khi tokenize.
--
-- unaccent() mặc định STABLE (phụ thuộc search_path) → KHÔNG dùng được trong
-- generated column. Bọc wrapper IMMUTABLE chỉ định dict tường minh.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Regen search_vec: bọc immutable_unaccent quanh từng field, giữ nguyên weight.
DROP INDEX IF EXISTS library_doc_search_vec_gin;
ALTER TABLE library_doc DROP COLUMN IF EXISTS search_vec;
ALTER TABLE library_doc ADD COLUMN search_vec tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(title, ''))), 'A') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(course_name_cache, ''))), 'A') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(description, ''))), 'B') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(ai_summary, ''))), 'C') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(preview_text, ''))), 'D')
) STORED;
CREATE INDEX library_doc_search_vec_gin ON library_doc USING gin(search_vec);
