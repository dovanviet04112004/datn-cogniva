-- 0001_auth_tokens — bảng cho hệ auth JWT mới (plan §3):
--   refresh_token        : opaque 30d, ROTATION + reuse-detection theo family.
--   password_reset_token : one-time 1h cho forgot password (feature mới).
-- Idempotent — apply CẢ Neon lẫn docker local (prisma db execute --file).
-- Chỉ lưu SHA-256 hash của token, không lưu raw.

CREATE TABLE IF NOT EXISTS "refresh_token" (
  "id"          text PRIMARY KEY,
  "user_id"     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash"  text NOT NULL UNIQUE,
  "family_id"   text NOT NULL,
  "expires_at"  timestamp NOT NULL,
  "revoked_at"  timestamp,
  "replaced_by" text,
  "ip_address"  text,
  "user_agent"  text,
  "created_at"  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "refresh_token_user_idx" ON "refresh_token" ("user_id");
CREATE INDEX IF NOT EXISTS "refresh_token_family_idx" ON "refresh_token" ("family_id");

CREATE TABLE IF NOT EXISTS "password_reset_token" (
  "id"         text PRIMARY KEY,
  "user_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at"    timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "password_reset_token_user_idx" ON "password_reset_token" ("user_id");
