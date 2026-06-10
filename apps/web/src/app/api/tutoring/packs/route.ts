/**
 * /api/tutoring/packs — V4 T3 (2026-05-22).
 *
 * GET ?tutorId=  — list pack ACTIVE của tutor
 * POST           — tutor đăng pack mới (auth owner)
 *
 * Spec: docs/plans/tutoring-v4.md §3 T3.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorProfile, tutoringPack } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const SESSION_COUNTS = [4, 8, 12, 16, 24] as const;

const CREATE_SCHEMA = z.object({
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  sessionCount: z.number().int().refine((n) => (SESSION_COUNTS as readonly number[]).includes(n)),
  durationMin: z.number().int().min(30).max(180).default(60),
  ratePerSessionVnd: z.number().int().min(10000).max(10_000_000),
  totalVnd: z.number().int().min(10000).max(100_000_000),
  discountPct: z.number().int().min(0).max(50).default(0),
  description: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tutorId = url.searchParams.get('tutorId');
  if (!tutorId) return NextResponse.json({ packs: [] });

  const packs = await db
    .select()
    .from(tutoringPack)
    .where(
      and(eq(tutoringPack.tutorId, tutorId), eq(tutoringPack.status, 'ACTIVE')),
    )
    .orderBy(desc(tutoringPack.sessionCount));

  return NextResponse.json({ packs });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify owner — chỉ tutor có profile mới tạo pack
  const [tutor] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, session.user.id))
    .limit(1);
  if (!tutor) {
    return NextResponse.json(
      { error: 'Bạn chưa có tutor profile — tạo profile trước.' },
      { status: 403 },
    );
  }

  const [pack] = await db
    .insert(tutoringPack)
    .values({
      tutorId: tutor.id,
      ...parsed.data,
      status: 'ACTIVE',
    })
    .returning();

  return NextResponse.json({ pack }, { status: 201 });
}
