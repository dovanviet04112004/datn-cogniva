-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0024 — Tutoring Marketplace V2 + V3 (Phase 21)
--
-- V2: tutoring_booking + tutor_review (booking flow + review).
-- V3: tutor_kyc_document + tutor_subject_verify_quiz + tutoring_payment
--     + tutor_payout (KYC + subject quiz + payment + payout).
--
-- Reference: docs/plans/tutoring.md §4.6-4.7 + §V3.
-- Rollback: DROP TABLE ngược thứ tự FK (payout → payment → verify_quiz →
--           kyc_document → review → booking).
-- ─────────────────────────────────────────────────────────────────────────

-- ══ V2: tutoring_booking ═════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutoring_booking" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_id" text NOT NULL,
  "student_id" text NOT NULL,
  "study_group_id" text,
  "subject_slug" text NOT NULL,
  "level" text NOT NULL,
  "start_at" timestamp NOT NULL,
  "end_at" timestamp NOT NULL,
  "rate_vnd" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING_TUTOR',
  "student_message" text,
  "session_notes" text,
  "recording_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "confirmed_at" timestamp,
  "completed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by" text,
  "cancel_reason" text,
  CONSTRAINT "tutoring_booking_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE RESTRICT,
  CONSTRAINT "tutoring_booking_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "tutoring_booking_study_group_id_fkey"
    FOREIGN KEY ("study_group_id") REFERENCES "study_group"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "tutoring_booking_tutor_time_idx"
  ON "tutoring_booking" ("tutor_id", "start_at");
CREATE INDEX IF NOT EXISTS "tutoring_booking_student_time_idx"
  ON "tutoring_booking" ("student_id", "start_at");
CREATE INDEX IF NOT EXISTS "tutoring_booking_status_idx"
  ON "tutoring_booking" ("status");

-- ══ V2: tutor_review ═════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutor_review" (
  "id" text PRIMARY KEY NOT NULL,
  "booking_id" text NOT NULL UNIQUE,
  "reviewer_id" text NOT NULL,
  "tutor_id" text NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tutor_review_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "tutoring_booking"("id") ON DELETE CASCADE,
  CONSTRAINT "tutor_review_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "tutor_review_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_review_tutor_idx"
  ON "tutor_review" ("tutor_id", "created_at");

-- ══ V3: tutor_kyc_document ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutor_kyc_document" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_id" text NOT NULL,
  "doc_type" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "original_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "reviewed_by" text,
  "review_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "reviewed_at" timestamp,
  CONSTRAINT "tutor_kyc_document_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE CASCADE,
  CONSTRAINT "tutor_kyc_document_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "tutor_kyc_document_tutor_idx"
  ON "tutor_kyc_document" ("tutor_id", "created_at");
CREATE INDEX IF NOT EXISTS "tutor_kyc_document_status_idx"
  ON "tutor_kyc_document" ("status");

-- ══ V3: tutor_subject_verify_quiz ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutor_subject_verify_quiz" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_subject_id" text NOT NULL,
  "quiz_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "score" integer,
  "pass_threshold" integer NOT NULL DEFAULT 80,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "tutor_subject_verify_quiz_tutor_subject_id_fkey"
    FOREIGN KEY ("tutor_subject_id") REFERENCES "tutor_subject"("id") ON DELETE CASCADE,
  CONSTRAINT "tutor_subject_verify_quiz_quiz_id_fkey"
    FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_subject_verify_quiz_subject_idx"
  ON "tutor_subject_verify_quiz" ("tutor_subject_id");

-- ══ V3: tutoring_payment ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutoring_payment" (
  "id" text PRIMARY KEY NOT NULL,
  "booking_id" text NOT NULL UNIQUE,
  "amount_vnd" integer NOT NULL,
  "fee_vnd" integer NOT NULL DEFAULT 0,
  "provider" text NOT NULL DEFAULT 'STUB',
  "provider_ref" text,
  "order_code" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'CREATED',
  "escrow_release_at" timestamp,
  "raw_response" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "captured_at" timestamp,
  "refunded_at" timestamp,
  CONSTRAINT "tutoring_payment_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "tutoring_booking"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "tutoring_payment_booking_idx"
  ON "tutoring_payment" ("booking_id");
CREATE INDEX IF NOT EXISTS "tutoring_payment_status_idx"
  ON "tutoring_payment" ("status");

-- ══ V3: tutor_payout ════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "tutor_payout" (
  "id" text PRIMARY KEY NOT NULL,
  "tutor_id" text NOT NULL,
  "amount_vnd" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "method" text NOT NULL DEFAULT 'BANK_TRANSFER',
  "account_details" jsonb,
  "processed_by" text,
  "note" text,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp,
  CONSTRAINT "tutor_payout_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "tutor_profile"("id") ON DELETE RESTRICT,
  CONSTRAINT "tutor_payout_processed_by_fkey"
    FOREIGN KEY ("processed_by") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "tutor_payout_tutor_idx"
  ON "tutor_payout" ("tutor_id", "requested_at");
CREATE INDEX IF NOT EXISTS "tutor_payout_status_idx"
  ON "tutor_payout" ("status");
