-- Migration 0041 — V4 T2: Instant Book + Trial + Reschedule + Response Metrics.
--
-- Spec: docs/plans/tutoring-v4.md §3 T2.
--
-- 4 thay đổi:
--   1. tutor_profile.instant_book_enabled — bỏ qua confirm 24h
--   2. tutor_profile.trial_session_enabled — cho phép trial -50%
--   3. tutor_profile.avg_response_minutes + response_rate_pct — cached metric
--   4. tutoring_booking.is_trial + reschedule fields

BEGIN;

-- ─── 1. Tutor profile flags ────────────────────────────────────────────
ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS instant_book_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS trial_session_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS avg_response_minutes integer;

ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS response_rate_pct integer
    CHECK (response_rate_pct BETWEEN 0 AND 100);

-- ─── 2. Booking trial + reschedule ─────────────────────────────────────
ALTER TABLE tutoring_booking
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

ALTER TABLE tutoring_booking
  ADD COLUMN IF NOT EXISTS original_start_at timestamp;

ALTER TABLE tutoring_booking
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;

-- 1 trial / (student, tutor) pair — enforce ở app + DB cùng lúc
CREATE UNIQUE INDEX IF NOT EXISTS tutoring_booking_trial_uniq
  ON tutoring_booking (student_id, tutor_id)
  WHERE is_trial = true AND status NOT IN ('CANCELLED');

COMMIT;
