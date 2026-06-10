/**
 * GET /api/tutoring/calendar/me — V4 T4 (2026-05-22).
 *
 * Trả unified calendar items cho user (student + tutor):
 *   - bookings (status non-cancelled)
 *   - class enrollments
 *   - blocked_time (chỉ owner tutor thấy)
 *
 * Query: ?from=ISO&to=ISO  (default từ now → +14 ngày)
 *
 * Spec: docs/plans/tutoring-v4.md §7.7.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import {
  db,
  tutorBlockedTime,
  tutorProfile,
  tutoringBooking,
  tutoringClass,
  tutoringClassEnrollment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type CalendarItem = {
  id: string;
  kind: 'booking' | 'class' | 'blocked';
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  tutorId: string | null;
  studentId: string | null;
  isTrial: boolean;
  subjectSlug: string | null;
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const fromDate = from ? new Date(from) : new Date();
  const toDate = to
    ? new Date(to)
    : new Date(fromDate.getTime() + 14 * 24 * 60 * 60 * 1000);

  // 1. Get my tutor profile (if any) — quyết định query range
  const [myProfile] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);

  const items: CalendarItem[] = [];

  // 2. Bookings — user là student hoặc tutor
  try {
    const bookingWhere = myProfile
      ? or(
          eq(tutoringBooking.studentId, session.user.id),
          eq(tutoringBooking.tutorId, myProfile.id),
        )
      : eq(tutoringBooking.studentId, session.user.id);

    const bookings = await db
      .select({
        id: tutoringBooking.id,
        subjectSlug: tutoringBooking.subjectSlug,
        startAt: tutoringBooking.startAt,
        endAt: tutoringBooking.endAt,
        status: tutoringBooking.status,
        tutorId: tutoringBooking.tutorId,
        studentId: tutoringBooking.studentId,
        isTrial: tutoringBooking.isTrial,
      })
      .from(tutoringBooking)
      .where(
        and(
          bookingWhere,
          sql`${tutoringBooking.status} <> 'CANCELLED'`,
          gte(tutoringBooking.startAt, fromDate),
          lte(tutoringBooking.startAt, toDate),
        ),
      )
      .orderBy(asc(tutoringBooking.startAt))
      .limit(200);

    for (const b of bookings) {
      items.push({
        id: b.id,
        kind: 'booking',
        title: `Buổi học · ${b.subjectSlug}`,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status,
        tutorId: b.tutorId,
        studentId: b.studentId,
        isTrial: b.isTrial,
        subjectSlug: b.subjectSlug,
      });
    }
  } catch (err) {
    console.error('[calendar.bookings]', err);
  }

  // 3. Class enrollments — user là student trong class
  try {
    const enrollments = await db
      .select({
        classId: tutoringClassEnrollment.classId,
        status: tutoringClassEnrollment.status,
      })
      .from(tutoringClassEnrollment)
      .where(
        and(
          eq(tutoringClassEnrollment.studentId, session.user.id),
          eq(tutoringClassEnrollment.status, 'ENROLLED'),
        ),
      )
      .limit(50);

    if (enrollments.length > 0) {
      const classIds = enrollments.map((e) => e.classId);
      const classes = await db
        .select({
          id: tutoringClass.id,
          title: tutoringClass.title,
          subjectSlug: tutoringClass.subjectSlug,
          tutorId: tutoringClass.tutorId,
          startDate: tutoringClass.startDate,
          durationMin: tutoringClass.durationMin,
          scheduleSlots: tutoringClass.scheduleSlots,
          status: tutoringClass.status,
        })
        .from(tutoringClass)
        .where(inArray(tutoringClass.id, classIds));

      for (const c of classes) {
        // Class start time = startDate + 08:00 default (V4.1: parse schedule_slots)
        const startAt = new Date(`${c.startDate}T08:00:00.000Z`);
        if (Number.isNaN(startAt.getTime())) continue;
        if (startAt < fromDate || startAt > toDate) continue;
        const endAt = new Date(startAt.getTime() + c.durationMin * 60_000);
        items.push({
          id: c.id,
          kind: 'class',
          title: c.title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          status: c.status,
          tutorId: c.tutorId,
          studentId: session.user.id,
          isTrial: false,
          subjectSlug: c.subjectSlug,
        });
      }
    }
  } catch (err) {
    console.error('[calendar.classes]', err);
  }

  // 4. Blocked time — chỉ tutor owner mới thấy
  if (myProfile) {
    try {
      const blocked = await db
        .select({
          id: tutorBlockedTime.id,
          startAt: tutorBlockedTime.startAt,
          endAt: tutorBlockedTime.endAt,
          reason: tutorBlockedTime.reason,
          tutorId: tutorBlockedTime.tutorId,
        })
        .from(tutorBlockedTime)
        .where(
          and(
            eq(tutorBlockedTime.tutorId, myProfile.id),
            gte(tutorBlockedTime.startAt, fromDate),
            lte(tutorBlockedTime.startAt, toDate),
          ),
        )
        .limit(50);

      for (const b of blocked) {
        items.push({
          id: b.id,
          kind: 'blocked',
          title: b.reason ? `Bận · ${b.reason}` : 'Đã block',
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          status: 'BLOCKED',
          tutorId: b.tutorId,
          studentId: null,
          isTrial: false,
          subjectSlug: null,
        });
      }
    } catch (err) {
      console.error('[calendar.blocked]', err);
    }
  }

  return NextResponse.json({
    items,
    range: { from: fromDate.toISOString(), to: toDate.toISOString() },
  });
}
