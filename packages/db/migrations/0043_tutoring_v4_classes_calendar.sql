-- Migration 0043 — V4 T4: Group Classes + Blocked Time + iCal export tokens.
--
-- Spec: docs/plans/tutoring-v4.md §3 T4.
--
-- 3 tables + 2 column additions:
--   1. tutoring_class — 1 tutor → N student lớp nhóm (schedule recurring)
--   2. tutoring_class_enrollment — student join class + waitlist
--   3. tutor_blocked_time — tutor block vacation / busy không cho book
--   4. tutor_profile.ical_token + user.booking_ical_token

BEGIN;

-- ─── 1. Group classes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutoring_class (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  subject_slug text NOT NULL,
  level text NOT NULL,
  max_students integer NOT NULL CHECK (max_students BETWEEN 2 AND 30),
  enrolled_count integer NOT NULL DEFAULT 0,
  rate_per_student_vnd integer NOT NULL CHECK (rate_per_student_vnd > 0),
  duration_min integer NOT NULL DEFAULT 90,
  total_sessions integer NOT NULL DEFAULT 1 CHECK (total_sessions >= 1),
  schedule_type text NOT NULL CHECK (schedule_type IN ('ONE_OFF', 'WEEKLY', 'BIWEEKLY')),
  /** Format: ["MON:19:00", "WED:19:00"] — list slot trong tuần. */
  schedule_slots jsonb NOT NULL,
  start_date date NOT NULL,
  study_group_id text REFERENCES study_group(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutoring_class_status_idx
  ON tutoring_class (status, start_date);
CREATE INDEX IF NOT EXISTS tutoring_class_tutor_idx
  ON tutoring_class (tutor_id, status);

-- ─── 2. Class enrollment ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutoring_class_enrollment (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES tutoring_class(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ENROLLED' CHECK (status IN (
    'ENROLLED', 'WAITLISTED', 'COMPLETED', 'DROPPED', 'REFUNDED'
  )),
  payment_id text REFERENCES tutoring_payment(id),
  enrolled_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS tutoring_class_enrollment_class_idx
  ON tutoring_class_enrollment (class_id, status);
CREATE INDEX IF NOT EXISTS tutoring_class_enrollment_student_idx
  ON tutoring_class_enrollment (student_id, status);

-- ─── 3. Blocked time (vacation / busy) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_blocked_time (
  id text PRIMARY KEY,
  tutor_id text NOT NULL REFERENCES tutor_profile(id) ON DELETE CASCADE,
  start_at timestamp NOT NULL,
  end_at timestamp NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS tutor_blocked_time_tutor_idx
  ON tutor_blocked_time (tutor_id, start_at);

-- ─── 4. iCal export tokens ────────────────────────────────────────────
ALTER TABLE tutor_profile
  ADD COLUMN IF NOT EXISTS ical_token text;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS booking_ical_token text;

COMMIT;
