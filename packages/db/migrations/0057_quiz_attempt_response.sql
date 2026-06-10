-- 0057 — Quiz attempt + response (lưu lịch sử làm quiz).
-- Trước đây quiz KHÔNG lưu attempt (chỉ log study_session metadata) → không biết
-- câu nào "đã làm". 2 bảng này cho phép quản trị "đã làm/chưa làm" từng câu + xem
-- lại điểm. Idempotent (IF NOT EXISTS) để chạy lại an toàn trên local + Neon.

CREATE TABLE IF NOT EXISTS "quiz_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"quiz_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"score" real,
	"max_score" real,
	"percentage" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quiz_response" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text,
	"question_id" text NOT NULL,
	"user_id" text NOT NULL,
	"answer" jsonb,
	"is_correct" boolean,
	"answered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quiz_response" ADD CONSTRAINT "quiz_response_attempt_id_quiz_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempt"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quiz_response" ADD CONSTRAINT "quiz_response_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quiz_response" ADD CONSTRAINT "quiz_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_attempt_quiz_user_idx" ON "quiz_attempt" USING btree ("quiz_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_attempt_user_idx" ON "quiz_attempt" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_response_attempt_question_idx" ON "quiz_response" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_response_user_question_idx" ON "quiz_response" USING btree ("user_id","question_id");--> statement-breakpoint
-- Dedup marker null-attempt trùng (giữ bản mới nhất) TRƯỚC khi tạo unique partial index.
DELETE FROM "quiz_response" a USING "quiz_response" b
  WHERE a.attempt_id IS NULL AND b.attempt_id IS NULL
    AND a.user_id = b.user_id AND a.question_id = b.question_id
    AND a.answered_at < b.answered_at;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_response_user_question_quick_idx" ON "quiz_response" USING btree ("user_id","question_id") WHERE "attempt_id" IS NULL;
