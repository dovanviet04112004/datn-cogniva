/**
 * /api/tutors/me — return profile của user hiện tại (nếu có).
 *
 * Tiện cho frontend check "Đã trở thành tutor chưa?" mà không cần biết id.
 * 200 với { tutor: null } nếu user chưa upgrade — không phải 404.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';

import {
  db,
  tutorAvailability,
  tutorProfile,
  tutorSubject,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [profile] = await db
    .select()
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ tutor: null, subjects: [], availability: [] });
  }

  const [subjects, availability] = await Promise.all([
    db.select().from(tutorSubject).where(eq(tutorSubject.tutorId, profile.id)),
    db
      .select()
      .from(tutorAvailability)
      .where(eq(tutorAvailability.tutorId, profile.id))
      .orderBy(asc(tutorAvailability.dayOfWeek), asc(tutorAvailability.startTime)),
  ]);

  return NextResponse.json({ tutor: profile, subjects, availability });
}
