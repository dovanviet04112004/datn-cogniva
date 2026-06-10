/**
 * /api/tutoring/blocked-time — V4 T4 (2026-05-22).
 *
 * GET   — list blocked time của tutor (owner only)
 * POST  — block 1 khoảng vacation/busy
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorBlockedTime,
  tutorProfile,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const POST_SCHEMA = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().max(200).optional(),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) return NextResponse.json({ blockedTime: [] });

  const items = await db
    .select()
    .from(tutorBlockedTime)
    .where(
      eq(tutorBlockedTime.tutorId, tutor.id),
    )
    .orderBy(asc(tutorBlockedTime.startAt))
    .limit(100);

  // Filter past (display chỉ upcoming + within 7 ngày past)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const filtered = items.filter((b) => b.endAt >= cutoff);
  void gte;

  return NextResponse.json({ blockedTime: filtered });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) {
    return NextResponse.json({ error: 'Bạn chưa có tutor profile' }, { status: 403 });
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  if (endAt <= startAt) {
    return NextResponse.json({ error: 'endAt phải sau startAt' }, { status: 400 });
  }

  const [created] = await db
    .insert(tutorBlockedTime)
    .values({
      tutorId: tutor.id,
      startAt,
      endAt,
      reason: parsed.data.reason,
    })
    .returning();

  return NextResponse.json({ blockedTime: created }, { status: 201 });
}
