/**
 * /api/tutoring/bookings/[id] — detail 1 booking + PATCH session notes.
 *
 * GET: trả booking + study group ref + review (nếu có).
 * PATCH: chỉ tutor (owner profile) — update session_notes sau buổi học.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  db,
  studyGroup,
  tutorProfile,
  tutorReview,
  tutoringBooking,
  tutoringPayment,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Alias user thứ 2 cho HỌC VIÊN — tutor view cần tên người đặt.
  const studentUser = alias(userTable, 'student_user');

  const [row] = await db
    .select({
      id: tutoringBooking.id,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      studyGroupId: tutoringBooking.studyGroupId,
      subjectSlug: tutoringBooking.subjectSlug,
      level: tutoringBooking.level,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      rateVnd: tutoringBooking.rateVnd,
      status: tutoringBooking.status,
      studentMessage: tutoringBooking.studentMessage,
      sessionNotes: tutoringBooking.sessionNotes,
      createdAt: tutoringBooking.createdAt,
      confirmedAt: tutoringBooking.confirmedAt,
      completedAt: tutoringBooking.completedAt,
      cancelledAt: tutoringBooking.cancelledAt,
      cancelReason: tutoringBooking.cancelReason,
      tutorUserId: tutorProfile.userId,
      tutorHeadline: tutorProfile.headline,
      tutorAvatarUrl: tutorProfile.avatarUrl,
      tutorName: userTable.name,
      studentName: studentUser.name,
      studentImage: studentUser.image,
      studyGroupName: studyGroup.name,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .innerJoin(studentUser, eq(studentUser.id, tutoringBooking.studentId))
    .leftJoin(studyGroup, eq(studyGroup.id, tutoringBooking.studyGroupId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isStudent = row.studentId === session.user.id;
  const isTutor = row.tutorUserId === session.user.id;
  if (!isStudent && !isTutor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [review] = await db
    .select()
    .from(tutorReview)
    .where(eq(tutorReview.bookingId, id))
    .limit(1);

  const [payment] = await db
    .select({
      id: tutoringPayment.id,
      orderCode: tutoringPayment.orderCode,
      amountVnd: tutoringPayment.amountVnd,
      provider: tutoringPayment.provider,
      status: tutoringPayment.status,
    })
    .from(tutoringPayment)
    .where(eq(tutoringPayment.bookingId, id))
    .limit(1);

  return NextResponse.json({
    booking: row,
    review: review ?? null,
    payment: payment ?? null,
    role: isTutor ? 'tutor' : 'student',
  });
}

const PATCH_SCHEMA = z.object({
  sessionNotes: z.string().max(2000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [row] = await db
    .select({ tutorId: tutoringBooking.tutorId, tutorUserId: tutorProfile.userId })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.tutorUserId !== session.user.id) {
    return NextResponse.json({ error: 'Chỉ tutor mới update được' }, { status: 403 });
  }

  await db
    .update(tutoringBooking)
    .set({
      sessionNotes: parsed.data.sessionNotes ?? null,
    })
    .where(eq(tutoringBooking.id, id));

  return NextResponse.json({ ok: true });
}
