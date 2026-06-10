-- Migration 0030: 2FA TOTP via better-auth twoFactor plugin.
-- Phase 6 polish — admin recommended bật 2FA.
--
-- Schema theo plugin docs:
--   user.two_factor_enabled — boolean, default false
--   two_factor table — secret + backup codes + verified + userId FK

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "two_factor" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "secret" TEXT NOT NULL,
  "backup_codes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS "idx_two_factor_user" ON "two_factor" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_two_factor_secret" ON "two_factor" ("secret");
