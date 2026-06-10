-- 0055: Index tên trường vào search_vec (2026-05-28)
--
-- Bug: search "hust" chỉ ra doc có "(HUST)" trong title, không ra ~900 doc
-- thuộc trường HUST — vì search_vec không chứa tên/viết-tắt trường (chỉ title +
-- course_name_cache). Fix: denormalize university name vào cột cache (giống
-- course_name_cache) rồi đưa vào search_vec (weight B).

-- 1. Thêm cột cache + backfill từ library_university (shortName + name)
ALTER TABLE library_doc ADD COLUMN IF NOT EXISTS university_name_cache text;

UPDATE library_doc d
SET university_name_cache = trim(coalesce(u.short_name, '') || ' ' || coalesce(u.name, ''))
FROM library_university u
WHERE d.university_id = u.id;

-- 2. Regen search_vec — thêm university_name_cache (weight B), giữ unaccent
DROP INDEX IF EXISTS library_doc_search_vec_gin;
ALTER TABLE library_doc DROP COLUMN IF EXISTS search_vec;
ALTER TABLE library_doc ADD COLUMN search_vec tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(title, ''))), 'A') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(course_name_cache, ''))), 'A') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(university_name_cache, ''))), 'B') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(description, ''))), 'B') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(ai_summary, ''))), 'C') ||
  setweight(to_tsvector('simple', immutable_unaccent(coalesce(preview_text, ''))), 'D')
) STORED;
CREATE INDEX library_doc_search_vec_gin ON library_doc USING gin(search_vec);

COMMENT ON COLUMN library_doc.university_name_cache IS
  'Denormalize tên + viết tắt trường để index vào search_vec (search "hust" ra doc của trường).';
