/**
 * /api/tutoring/requests/[id] — GET detail + applications, PATCH update/close.
 *
 * GET: public — return request + list applications (owner mới thấy applications,
 *      tutor khác chỉ thấy request).
 * PATCH: chỉ owner. Đổi status (OPEN/MATCHED/CLOSED) hoặc update body.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorApplication,
  tutorProfile,
  tutorRequest,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const [req] = await db
    .select({
      id: tutorRequest.id,
      title: tutorRequest.title,
      description: tutorRequest.description,
      subjectSlug: tutorRequest.subjectSlug,
      level: tutorRequest.level,
      budgetVnd: tutorRequest.budgetVnd,
      modality: tutorRequest.modality,
      urgency: tutorRequest.urgency,
      status: tutorRequest.status,
      createdAt: tutorRequest.createdAt,
      expiresAt: tutorRequest.expiresAt,
      studentId: tutorRequest.studentId,
      studentName: userTable.name,
      studentImage: userTable.image,
    })
    .from(tutorRequest)
    .innerJoin(userTable, eq(userTable.id, tutorRequest.studentId))
    .where(eq(tutorRequest.id, id))
    .limit(1);

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Applications: owner thấy full list, người khác chỉ thấy count
  const session = await auth.api.getSession({ headers: await headers() });
  const isOwner = session?.user.id === req.studentId;

  // Check user hiện tại đã apply (nếu là tutor)
  let myApplication: { id: string; status: string } | null = null;
  let isTutor = false;
  if (session && !isOwner) {
    const [myProfile] = await db
      .select({ id: tutorProfile.id })
      .from(tutorProfile)
      .where(eq(tutorProfile.userId, session.user.id))
      .limit(1);
    isTutor = !!myProfile;
    if (myProfile) {
      const [app] = await db
        .select({ id: tutorApplication.id, status: tutorApplication.status })
        .from(tutorApplication)
        .where(eq(tutorApplication.requestId, id))
        .limit(50);
      // Find mine
      const mine = app && (await db
        .select({ id: tutorApplication.id, status: tutorApplication.status })
        .from(tutorApplication)
        .where(eq(tutorApplication.tutorId, myProfile.id))
        .limit(1))[0];
      if (mine) myApplication = mine;
    }
  }

  if (isOwner) {
    const applications = await db
      .select({
        id: tutorApplication.id,
        tutorId: tutorApplication.tutorId,
        message: tutorApplication.message,
        proposedRateVnd: tutorApplication.proposedRateVnd,
        status: tutorApplication.status,
        createdAt: tutorApplication.createdAt,
        tutorHeadline: tutorProfile.headline,
        tutorRating: tutorProfile.ratingAvg,
        tutorRatingCount: tutorProfile.ratingCount,
        tutorSessionsCompleted: tutorProfile.sessionsCompleted,
        tutorAvatarUrl: tutorProfile.avatarUrl,
        tutorUserId: tutorProfile.userId,
      })
      .from(tutorApplication)
      .innerJoin(tutorProfile, eq(tutorProfile.id, tutorApplication.tutorId))
      .where(eq(tutorApplication.requestId, id))
      .orderBy(desc(tutorApplication.createdAt));

    return NextResponse.json({ request: req, isOwner: true, applications });
  }

  return NextResponse.json({ request: req, isOwner: false, isTutor, myApplication });
}

const PATCH_SCHEMA = z.object({
  title: z.string().min(10).max(160).optional(),
  description: z.string().min(50).max(2000).optional(),
  budgetVnd: z.number().int().min(10000).max(10000000).nullable().optional(),
  status: z.enum(['OPEN', 'MATCHED', 'CLOSED']).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select({ studentId: tutorRequest.studentId })
    .from(tutorRequest)
    .where(eq(tutorRequest.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.studentId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(tutorRequest)
    .set(parsed.data)
    .where(eq(tutorRequest.id, id))
    .returning();

  // Title/status/budget request đổi → "Yêu cầu của tôi" trong MineTab của owner đổi.
  await onTutoringMineChanged(existing.studentId);

  return NextResponse.json({ request: updated });
}
