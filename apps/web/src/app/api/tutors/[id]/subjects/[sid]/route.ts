/**
 * /api/tutors/[id]/subjects/[sid] — DELETE remove a subject.
 *
 * Verify ownership của tutor profile trước khi xoá. Subject thuộc tutor khác
 * KHÔNG xoá được (403).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, tutorProfile, tutorSubject } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; sid: string }> };

export async function DELETE(_: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, sid } = await params;

  const [profile] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (profile.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db
    .delete(tutorSubject)
    .where(and(eq(tutorSubject.id, sid), eq(tutorSubject.tutorId, id)));

  return NextResponse.json({ ok: true });
}
