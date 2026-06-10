/**
 * /api/tutors/[id]/favorite — V4 T5 (2026-05-22).
 *
 * POST   — toggle favorite (idempotent qua ON CONFLICT)
 * GET    — check user đã favorite tutor này chưa
 *
 * Spec: docs/plans/tutoring-v4.md §3 T5.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, tutorFavorite, tutorProfile } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tutorId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ favorited: false });

  const [row] = await db
    .select({ tutorId: tutorFavorite.tutorId })
    .from(tutorFavorite)
    .where(
      and(
        eq(tutorFavorite.userId, session.user.id),
        eq(tutorFavorite.tutorId, tutorId),
      ),
    )
    .limit(1);

  return NextResponse.json({ favorited: !!row });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tutorId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify tutor exists
  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, tutorId))
    .limit(1);
  if (!tutor) return NextResponse.json({ error: 'Tutor not found' }, { status: 404 });

  // Toggle: nếu đã có thì delete, chưa thì insert
  const [existing] = await db
    .select({ tutorId: tutorFavorite.tutorId })
    .from(tutorFavorite)
    .where(
      and(
        eq(tutorFavorite.userId, session.user.id),
        eq(tutorFavorite.tutorId, tutorId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .delete(tutorFavorite)
      .where(
        and(
          eq(tutorFavorite.userId, session.user.id),
          eq(tutorFavorite.tutorId, tutorId),
        ),
      );
    return NextResponse.json({ favorited: false });
  } else {
    await db
      .insert(tutorFavorite)
      .values({ userId: session.user.id, tutorId });
    return NextResponse.json({ favorited: true });
  }
}
