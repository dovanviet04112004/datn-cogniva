/**
 * GET /api/tutoring/calendar?from=...&to=... — calendar bookings tutor + student.
 *
 * Trả về events trong khoảng [from, to] để render trên FullCalendar / matrix.
 * Mỗi event có: id, title, startAt, endAt, status, role (student/tutor).
 *
 * Mặc định: 30 ngày tới từ now.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, gte, lte, or } from 'drizzle-orm';

import {
  db,
  SUBJECT_BY_SLUG,
  tutorProfile,
  tutoringBooking,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const url = new URL(request.url);
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date();
  const to = url.searchParams.get('to')
    ? new Date(url.searchParams.get('to')!)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // User có thể vừa là student (booking) vừa là tutor (profile)
  const [myProfile] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, userId))
    .limit(1);

  const conds = [
    gte(tutoringBooking.startAt, from),
    lte(tutoringBooking.startAt, to),
  ];

  const roleCond = myProfile
    ? or(
        eq(tutoringBooking.studentId, userId),
        eq(tutoringBooking.tutorId, myProfile.id),
      )
    : eq(tutoringBooking.studentId, userId);

  const rows = await db
    .select({
      id: tutoringBooking.id,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      subjectSlug: tutoringBooking.subjectSlug,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      status: tutoringBooking.status,
      tutorName: userTable.name,
      tutorAvatarUrl: tutorProfile.avatarUrl,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(and(...conds, roleCond))
    .orderBy(asc(tutoringBooking.startAt));

  const events = rows.map((r) => ({
    id: r.id,
    title: SUBJECT_BY_SLUG[r.subjectSlug]?.name ?? r.subjectSlug,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    status: r.status,
    role: myProfile && r.tutorId === myProfile.id ? 'tutor' : 'student',
    tutorName: r.tutorName,
    tutorAvatarUrl: r.tutorAvatarUrl,
  }));

  return NextResponse.json({ events, from, to });
}
