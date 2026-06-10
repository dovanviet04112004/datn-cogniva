/**
 * GET /api/tutoring/ical/[token] — V4 T4 (2026-05-22).
 *
 * Public iCal feed cho token. Token chứa trong tutor_profile.ical_token
 * hoặc user.booking_ical_token. Trả .ics MIME cho Google Calendar /
 * Outlook subscribe.
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
import { NextResponse } from 'next/server';
import { eq, gte, or } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutoringBooking,
  user as userTable,
} from '@cogniva/db';

import { buildIcsFeed, type IcalEvent } from '@/lib/tutoring/ical';

export const runtime = 'nodejs';

const FORWARD_DAYS = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return new Response('Invalid token', { status: 400 });
  }

  // Tìm token thuộc tutor hay student
  const [tutor] = await db
    .select({ id: tutorProfile.id, userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.icalToken, token))
    .limit(1);

  const [studentUser] = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.bookingIcalToken, token))
    .limit(1);

  if (!tutor && !studentUser) {
    return new Response('Token không hợp lệ', { status: 404 });
  }

  const from = new Date();
  const to = new Date(Date.now() + FORWARD_DAYS * 24 * 60 * 60 * 1000);

  const bookings = await db
    .select({
      id: tutoringBooking.id,
      tutorName: userTable.name,
      subjectSlug: tutoringBooking.subjectSlug,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      status: tutoringBooking.status,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(
      tutor
        ? eq(tutoringBooking.tutorId, tutor.id)
        : or(
            eq(tutoringBooking.studentId, studentUser!.id),
            eq(tutoringBooking.tutorId, '__sentinel_never_match__'),
          )!,
    )
    .orderBy(tutoringBooking.startAt);

  // Filter trong window + status CONFIRMED / IN_PROGRESS / COMPLETED
  const events: IcalEvent[] = bookings
    .filter(
      (b) =>
        b.startAt >= from &&
        b.startAt <= to &&
        ['CONFIRMED', 'IN_PROGRESS', 'PENDING_TUTOR'].includes(b.status),
    )
    .map((b) => ({
      uid: b.id,
      summary: `Buổi học · ${b.subjectSlug}${
        studentUser ? ` với ${b.tutorName ?? 'gia sư'}` : ''
      }`,
      description: `Booking #${b.id} (${b.status})`,
      startAt: b.startAt,
      endAt: b.endAt,
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/tutoring/bookings/${b.id}`,
    }));

  const title = tutor
    ? 'Cogniva — Lịch dạy'
    : `Cogniva — Lịch học của ${studentUser?.name ?? 'bạn'}`;
  const ics = buildIcsFeed({ title, events });

  void gte;

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline; filename="cogniva-tutoring.ics"',
    },
  });
}
