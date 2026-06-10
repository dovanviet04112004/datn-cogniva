-- ============================================================================
-- Migration 0051 — Library Annotation Selection (Phase 4 Bonus #8 enhancement)
--
-- Thêm selected_text (đoạn text user highlight) + selection_rect (pixel coords
-- relative to PDF page, dùng cho overlay rendering Phase 5).
-- ============================================================================

ALTER TABLE library_doc_annotation
  ADD COLUMN IF NOT EXISTS selected_text text;

ALTER TABLE library_doc_annotation
  ADD COLUMN IF NOT EXISTS selection_rect jsonb;

COMMENT ON COLUMN library_doc_annotation.selected_text IS
  'Đoạn text user đã select khi tạo note. Null nếu pin page-level only.';
COMMENT ON COLUMN library_doc_annotation.selection_rect IS
  'Pixel coords {pageW, pageH, x, y, w, h} normalized 0..1 relative to PDF page render. Phase 5 highlight overlay sẽ dùng.';
