/**
 * /api/tutors/[id] — GET detail / PATCH update / DELETE.
 *
 * GET: public — return full profile + subjects + availability + user info.
 * PATCH: chỉ owner. Cho phép update headline/bio/rate/modality/avatar/banner.
 *        Embedding bio sẽ regen ở V2 khi có matching feature.
 * DELETE: chỉ owner — cascade xoá subjects/availability/applications.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorAvailability,
  tutorProfile,
  tutorSubject,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const [profile] = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      bannerUrl: tutorProfile.bannerUrl,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      verificationStatus: tutorProfile.verificationStatus,
      status: tutorProfile.status,
      createdAt: tutorProfile.createdAt,
      // V4 T2: instant book + trial + response metrics
      instantBookEnabled: tutorProfile.instantBookEnabled,
      trialSessionEnabled: tutorProfile.trialSessionEnabled,
      avgResponseMinutes: tutorProfile.avgResponseMinutes,
      responseRatePct: tutorProfile.responseRatePct,
      userName: userTable.name,
      userImage: userTable.image,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorProfile.id, id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Chặn xem DRAFT trừ owner
  const session = await auth.api.getSession({ headers: await headers() });
  const isOwner = session?.user.id === profile.userId;
  if (profile.status !== 'PUBLISHED' && !isOwner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [subjects, availability] = await Promise.all([
    db
      .select()
      .from(tutorSubject)
      .where(eq(tutorSubject.tutorId, id)),
    db
      .select()
      .from(tutorAvailability)
      .where(eq(tutorAvailability.tutorId, id))
      .orderBy(asc(tutorAvailability.dayOfWeek), asc(tutorAvailability.startTime)),
  ]);

  return NextResponse.json({
    tutor: profile,
    subjects,
    availability,
    isOwner,
  });
}

const PATCH_SCHEMA = z.object({
  headline: z.string().min(10).max(160).optional(),
  bio: z.string().min(200).max(2000).optional(),
  hourlyRateVnd: z.number().int().min(10000).max(10000000).optional(),
  modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED']).optional(),
  /** V4 T2 — Instant Book opt-in (bỏ qua confirm 24h). */
  instantBookEnabled: z.boolean().optional(),
  /** V4 T2 — Cho phép trial 30 phút -50% (default true). */
  trialSessionEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(tutorProfile)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(tutorProfile.id, id))
    .returning();

  return NextResponse.json({ tutor: updated });
}

export async function DELETE(_: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Cascade xoá hết subjects + availability + applications (FK)
  await db.delete(tutorProfile).where(eq(tutorProfile.id, id));
  return NextResponse.json({ ok: true });
}
