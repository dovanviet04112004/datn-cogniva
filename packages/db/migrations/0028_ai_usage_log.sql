-- Migration 0028: ai_usage_log — ghi từng LLM call cho cost analytics + audit.
-- Phase 3 admin AI & Costs.
--
-- 1 row mỗi LLM call (chat, quizGen, flashcardGen, embed, …). Bảng này grows
-- nhanh, dùng partitioning sau (Phase 11+) khi > 1M rows. V1 single table.
--
-- userId NULL được phép — vì có thể là system call (cron, ingest) không gắn
-- với user cụ thể. plan NULL khi user đã bị xoá (FK SET NULL).

CREATE TABLE IF NOT EXISTS "ai_usage_log" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "plan" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "feature" TEXT,
  "tokens_in" INTEGER NOT NULL DEFAULT 0,
  "tokens_out" INTEGER NOT NULL DEFAULT 0,
  "cost_usd" REAL NOT NULL DEFAULT 0,
  "latency_ms" INTEGER,
  "cached" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index cho query phổ biến:
-- (1) Cost by provider trên window thời gian → time-series chart
CREATE INDEX IF NOT EXISTS "idx_ai_usage_provider_time"
  ON "ai_usage_log" ("provider", "created_at" DESC);

-- (2) Top user by cost → leaderboard admin
CREATE INDEX IF NOT EXISTS "idx_ai_usage_user_time"
  ON "ai_usage_log" ("user_id", "created_at" DESC);

-- (3) By feature use-case → breakdown chart
CREATE INDEX IF NOT EXISTS "idx_ai_usage_feature_time"
  ON "ai_usage_log" ("feature", "created_at" DESC)
  WHERE "feature" IS NOT NULL;

-- (4) Time-only index cho aggregate dashboard query
CREATE INDEX IF NOT EXISTS "idx_ai_usage_time"
  ON "ai_usage_log" ("created_at" DESC);
