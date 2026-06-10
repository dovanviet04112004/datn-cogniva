-- ============================================================================
-- Migration 0046 — Library AI-Native (2026-05-22)
-- Spec: docs/plans/library-share.md
--
-- 7 tables: library_doc, library_doc_chunk, library_doc_atom (P2),
--           library_doc_review, library_doc_import, library_doc_outcome,
--           library_doc_report
--
-- Reuse: pgvector (đã enable), tsvector pattern (giống tutor_profile).
-- ============================================================================

-- ─── library_doc — master record ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS library_doc (
  id              text PRIMARY KEY,
  uploader_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Content metadata
  title           text NOT NULL,
  description     text,
  subject_slug    text NOT NULL,
  level           text NOT NULL,
  grade           integer,
  doc_type        text NOT NULL DEFAULT 'other',
  exam_type       text,
  school_year     text,
  region          text DEFAULT 'national',
  language        text DEFAULT 'vi',
  tags            text[] DEFAULT '{}'::text[],
  difficulty      text,
  prerequisite_atom_slugs text[] DEFAULT '{}'::text[],

  -- File
  file_format     text NOT NULL,           -- 'pdf'|'docx'|'image'
  file_size_bytes integer NOT NULL,
  file_url        text NOT NULL,
  file_hash       text NOT NULL,
  page_count      integer,

  -- Generated content
  preview_thumb_url text,
  ai_summary      text,
  ai_summary_at   timestamp,
  preview_text    text,

  -- Search index
  search_vec      tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(ai_summary, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(preview_text, '')), 'D')
  ) STORED,
  title_embedding vector(1024),

  -- License + status
  license         text DEFAULT 'CC-BY-4.0',
  status          text DEFAULT 'PROCESSING',
  hidden_at       timestamp,
  hidden_reason   text,

  -- Stats
  view_count             integer DEFAULT 0,
  download_count         integer DEFAULT 0,
  workspace_import_count integer DEFAULT 0,
  rating_avg             numeric(3,2),
  rating_count           integer DEFAULT 0,

  -- Quality Score (Phase 2)
  quality_score          numeric(5,2),
  quality_breakdown      jsonb,
  badges                 text[] DEFAULT '{}'::text[],

  -- Pricing (Phase 4)
  is_premium             boolean DEFAULT false,
  price_vnd              integer,
  creator_share_pct      integer DEFAULT 80,

  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_doc_subject_grade_idx
  ON library_doc (subject_slug, grade, status);
CREATE INDEX IF NOT EXISTS library_doc_subject_level_idx
  ON library_doc (subject_slug, level, status);
CREATE INDEX IF NOT EXISTS library_doc_type_idx
  ON library_doc (doc_type, status);
CREATE INDEX IF NOT EXISTS library_doc_quality_idx
  ON library_doc (quality_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS library_doc_uploader_idx
  ON library_doc (uploader_id);
CREATE INDEX IF NOT EXISTS library_doc_search_vec_gin
  ON library_doc USING gin(search_vec);
CREATE INDEX IF NOT EXISTS library_doc_tags_gin
  ON library_doc USING gin(tags);
CREATE UNIQUE INDEX IF NOT EXISTS library_doc_hash_uniq
  ON library_doc (file_hash) WHERE status = 'PUBLISHED';

-- ─── library_doc_chunk — page-level chunks (cross-doc search) ────────
CREATE TABLE IF NOT EXISTS library_doc_chunk (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  page_num        integer NOT NULL,
  chunk_index     integer NOT NULL,
  content         text NOT NULL,
  content_vec     vector(1024),
  search_vec      tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS library_doc_chunk_doc_idx
  ON library_doc_chunk (doc_id, page_num);
CREATE INDEX IF NOT EXISTS library_doc_chunk_fts_idx
  ON library_doc_chunk USING gin(search_vec);
-- Vector index added separately after some data exists (ivfflat cần data train)

-- ─── library_doc_atom (Phase 2 - schema sẵn) ──────────────────────────
CREATE TABLE IF NOT EXISTS library_doc_atom (
  id          text PRIMARY KEY,
  doc_id      text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  atom_text   text NOT NULL,
  atom_slug   text NOT NULL,
  page_nums   integer[] NOT NULL,
  difficulty  text,
  embedding   vector(1024)
);

CREATE INDEX IF NOT EXISTS library_doc_atom_slug_idx
  ON library_doc_atom (atom_slug);
CREATE INDEX IF NOT EXISTS library_doc_atom_doc_idx
  ON library_doc_atom (doc_id);

-- ─── library_doc_review ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library_doc_review (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  reviewer_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  rating          integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  helpful_count   integer DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now(),
  UNIQUE (doc_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS library_doc_review_doc_idx
  ON library_doc_review (doc_id, created_at DESC);

-- ─── library_doc_import — track import vào workspace ─────────────────
CREATE TABLE IF NOT EXISTS library_doc_import (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id),
  importer_id     text NOT NULL REFERENCES "user"(id),
  workspace_id    text REFERENCES workspace(id) ON DELETE SET NULL,
  document_id     text REFERENCES document(id) ON DELETE SET NULL,
  imported_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_doc_import_doc_idx
  ON library_doc_import (doc_id, imported_at);
CREATE INDEX IF NOT EXISTS library_doc_import_user_idx
  ON library_doc_import (importer_id, imported_at);

-- ─── library_doc_outcome (Phase 2 - schema sẵn) ──────────────────────
CREATE TABLE IF NOT EXISTS library_doc_outcome (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES "user"(id),
  metric          text NOT NULL,
  value           numeric NOT NULL,
  context         jsonb,
  recorded_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_doc_outcome_doc_idx
  ON library_doc_outcome (doc_id, metric);
CREATE INDEX IF NOT EXISTS library_doc_outcome_user_idx
  ON library_doc_outcome (user_id);

-- ─── library_doc_report — moderation queue ───────────────────────────
CREATE TABLE IF NOT EXISTS library_doc_report (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id),
  reporter_id     text NOT NULL REFERENCES "user"(id),
  reason          text NOT NULL,
  detail          text,
  status          text DEFAULT 'PENDING',
  admin_id        text REFERENCES "user"(id),
  actioned_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_doc_report_status_idx
  ON library_doc_report (status, created_at);
