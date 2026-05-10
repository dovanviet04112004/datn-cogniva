-- Phase 4 — pivot table chunk ↔ concept
-- Chạy thủ công qua: pnpm exec tsx packages/db/src/migrations/run.ts
-- Hoặc: psql $DATABASE_URL < 001-chunk-concept.sql

CREATE TABLE IF NOT EXISTS "chunk_concept" (
  "chunk_id" text NOT NULL REFERENCES "chunk"("id") ON DELETE CASCADE,
  "concept_id" text NOT NULL REFERENCES "concept"("id") ON DELETE CASCADE,
  "strength" real NOT NULL DEFAULT 1,
  PRIMARY KEY ("chunk_id", "concept_id")
);

CREATE INDEX IF NOT EXISTS "chunk_concept_concept_idx" ON "chunk_concept" ("concept_id");
