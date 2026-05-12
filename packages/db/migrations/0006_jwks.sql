-- =============================================================================
-- Migration 0006 — JWT plugin support (Stage 2 M4 W3)
-- =============================================================================
-- Better Auth JWT plugin yêu cầu table `jwks` để lưu Ed25519 keypair.
-- Public key expose qua /api/auth/jwks (edge gateway + mobile verify JWT).
-- Private key encrypted bằng BETTER_AUTH_SECRET ở app layer.
--
-- Apply:
--   psql $DATABASE_URL -f packages/db/migrations/0006_jwks.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS "jwks" (
  "id"          text PRIMARY KEY,
  "public_key"  text NOT NULL,
  "private_key" text NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "expires_at"  timestamp
);

-- Index theo created_at để JWT plugin pick newest key cho sign operation.
-- Postgres KHÔNG cho WHERE now() (stable, not immutable) → giữ index simple.
CREATE INDEX IF NOT EXISTS "jwks_created_at_idx" ON "jwks" ("created_at" DESC);
