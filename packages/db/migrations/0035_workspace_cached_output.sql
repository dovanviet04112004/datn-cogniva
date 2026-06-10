-- Phase V6 (NotebookLM layout) — persistent cache cho LLM-generated output
-- (atom-guide / briefing-doc). Trước V6 in-memory Map: restart server mất hết.
--
-- Spec: docs/plans/v5-notebooklm-layout.md V6.5.
--
-- Table workspace_cached_output:
--   - (workspace_id, user_id, kind) UNIQUE — mỗi user mỗi workspace mỗi
--     kind chỉ 1 row
--   - markdown text — output LLM
--   - generated_at timestamp — TTL 24h check ở app layer
--   - meta jsonb — atom_count / doc_count / etc.
--
-- Rollback: DROP TABLE workspace_cached_output;
BEGIN;

DO $$ BEGIN
  CREATE TYPE workspace_cached_kind AS ENUM ('atom-guide', 'briefing');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workspace_cached_output (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind workspace_cached_kind NOT NULL,
  markdown text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_cached_uniq UNIQUE (workspace_id, user_id, kind)
);

CREATE INDEX IF NOT EXISTS workspace_cached_lookup_idx
  ON workspace_cached_output (workspace_id, user_id, kind);

COMMIT;
