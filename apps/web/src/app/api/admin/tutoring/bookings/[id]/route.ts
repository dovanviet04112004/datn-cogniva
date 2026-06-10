/**
 * GET /api/admin/tutoring/bookings/[id] — chi tiết booking + payment + review.
 *
 * Trả về toàn bộ thông tin admin cần để xử lý case:
 *   - Booking full row
 *   - Tutor (profile + user)
 *   - Student (user)
 *   - Payment (full row + raw response — chỉ admin xem)
 *   - Review nếu có (rating + comment + hidden state)
 */
import { NextResponse } from 'next/server';
import { aliasedTable, eq } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutorReview,
  tutoringBooking,
  tutoringPayment,
  user,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const tutorUser = aliasedTable(user, 'tutor_u');
const studentUser = aliasedTable(user, 'student_u');

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      subjectSlug: tutoringBooking.subjectSlug,
      level: tutoringBooking.level,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      rateVnd: tutoringBooking.rateVnd,
      studentMessage: tutoringBooking.studentMessage,
      sessionNotes: tutoringBooking.sessionNotes,
      recordingId: tutoringBooking.recordingId,
      studyGroupId: tutoringBooking.studyGroupId,
      createdAt: tutoringBooking.createdAt,
      confirmedAt: tutoringBooking.confirmedAt,
      completedAt: tutoringBooking.completedAt,
      cancelledAt: tutoringBooking.cancelledAt,
      cancelledBy: tutoringBooking.cancelledBy,
      cancelReason: tutoringBooking.cancelReason,
      tutorProfileId: tutoringBooking.tutorId,
      tutorUserId: tutorProfile.userId,
      tutorHeadline: tutorProfile.headline,
      tutorName: tutorUser.name,
      tutorEmail: tutorUser.email,
      tutorImage: tutorUser.image,
      studentId: tutoringBooking.studentId,
      studentName: studentUser.name,
      studentEmail: studentUser.email,
      studentImage: studentUser.image,
    })
    .from(tutoringBooking)
    .leftJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .leftJoin(tutorUser, eq(tutorUser.id, tutorProfile.userId))
    .leftJoin(studentUser, eq(studentUser.id, tutoringBooking.studentId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const [[payment], [review]] = await Promise.all([
    db
      .select()
      .from(tutoringPayment)
      .where(eq(tutoringPayment.bookingId, id))
      .limit(1),
    db.select().from(tutorReview).where(eq(tutorReview.bookingId, id)).limit(1),
  ]);

  return NextResponse.json({
    booking: {
      ...row,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    },
    payment: payment
      ? {
          ...payment,
          createdAt: payment.createdAt.toISOString(),
          capturedAt: payment.capturedAt?.toISOString() ?? null,
          refundedAt: payment.refundedAt?.toISOString() ?? null,
          escrowReleaseAt: payment.escrowReleaseAt?.toISOString() ?? null,
        }
      : null,
    review: review
      ? {
          ...review,
          createdAt: review.createdAt.toISOString(),
          hiddenAt: review.hiddenAt?.toISOString() ?? null,
        }
      : null,
  });
}
