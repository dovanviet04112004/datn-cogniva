-- ============================================================================
-- Migration 0048 — Library Annotation (Phase 3 Bonus #8, 2026-05-27)
--
-- Page-level notes/annotations cho library docs. V1 đơn giản: note text +
-- page_num + visibility (public/private). Phase 4 sẽ thêm pixel-perfect
-- text-selection overlay (cần re-enable PDF.js textLayer).
-- ============================================================================

CREATE TABLE IF NOT EXISTS library_doc_annotation (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  author_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  page_num        integer NOT NULL,
  /** Note Markdown text (max 2000 char). */
  note            text NOT NULL,
  /** 'public' (mọi user xem) | 'private' (chỉ author). */
  visibility      text NOT NULL DEFAULT 'public',
  helpful_count   integer NOT NULL DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_doc_annotation_doc_idx
  ON library_doc_annotation (doc_id, page_num);
CREATE INDEX IF NOT EXISTS library_doc_annotation_author_idx
  ON library_doc_annotation (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS library_doc_annotation_helpful_idx
  ON library_doc_annotation (doc_id, helpful_count DESC);

-- Helpful votes — 1 vote/user/annotation
CREATE TABLE IF NOT EXISTS library_doc_annotation_vote (
  id              text PRIMARY KEY,
  annotation_id   text NOT NULL REFERENCES library_doc_annotation(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at      timestamp NOT NULL DEFAULT now(),
  UNIQUE (annotation_id, user_id)
);

CREATE INDEX IF NOT EXISTS library_doc_annotation_vote_user_idx
  ON library_doc_annotation_vote (user_id);
