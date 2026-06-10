-- ============================================================================
-- Migration 0050 — Library Saved Searches + View History (Phase 4, 2026-05-27)
-- ============================================================================

CREATE TABLE IF NOT EXISTS library_saved_search (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  /** Encoded query params: { q?, subject?, level?, grade?, docType?, ... } */
  query_params    jsonb NOT NULL,
  /** Optional: notify khi có doc mới match (Phase 4.5 push notification). */
  notify_on_new   boolean NOT NULL DEFAULT false,
  last_run_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_saved_search_user_idx
  ON library_saved_search (user_id, created_at DESC);

-- ─── Per-user view history (Recently viewed) ─────────────────────────
CREATE TABLE IF NOT EXISTS library_doc_view (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  viewed_at       timestamp NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc_id)  -- 1 row/cặp, update viewed_at qua UPSERT
);

CREATE INDEX IF NOT EXISTS library_doc_view_user_recent_idx
  ON library_doc_view (user_id, viewed_at DESC);
