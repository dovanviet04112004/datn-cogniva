-- ============================================================================
-- Migration 0047 — Library Endorsement (Phase 3 Bonus, 2026-05-27)
--
-- Tutor verified endorse 1 library_doc → tự động grant badge
-- 'educator_approved' qua recompute quality job.
-- ============================================================================

CREATE TABLE IF NOT EXISTS library_doc_endorsement (
  id              text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES library_doc(id) ON DELETE CASCADE,
  tutor_id        text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  /** Optional comment từ tutor giải thích vì sao endorse. */
  note            text,
  created_at      timestamp NOT NULL DEFAULT now(),
  UNIQUE (doc_id, tutor_id)
);

CREATE INDEX IF NOT EXISTS library_doc_endorsement_doc_idx
  ON library_doc_endorsement (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS library_doc_endorsement_tutor_idx
  ON library_doc_endorsement (tutor_id, created_at DESC);
