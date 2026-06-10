/**
 * GET /api/tutoring/favorites — V4 T5 (2026-05-22).
 *
 * List tutor user đã favorite, sort by createdAt DESC.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import {
  db,
  tutorFavorite,
  tutorProfile,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      tutorId: tutorProfile.id,
      headline: tutorProfile.headline,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
      instantBookEnabled: tutorProfile.instantBookEnabled,
      avgResponseMinutes: tutorProfile.avgResponseMinutes,
      tutorName: userTable.name,
      favoritedAt: tutorFavorite.createdAt,
    })
    .from(tutorFavorite)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutorFavorite.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorFavorite.userId, session.user.id))
    .orderBy(desc(tutorFavorite.createdAt))
    .limit(50);

  return NextResponse.json({ favorites: rows });
}
