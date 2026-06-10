/**
 * POST /api/tutoring/bookings/[id]/complete — đánh dấu buổi học hoàn thành.
 *
 * Caller: tutor (sau khi xong buổi) hoặc auto cron khi endAt < now - 1h.
 * Validation:
 *   - status hiện tại phải là CONFIRMED hoặc IN_PROGRESS
 *   - endAt phải đã qua (không complete buổi tương lai)
 *
 * Side effects:
 *   1. status → COMPLETED + completedAt
 *   2. sessions_completed +1 trên tutor_profile (qua refreshTutorStats)
 *   3. Set escrowReleaseAt trên payment = now + 7 ngày (V3 cron sẽ release)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutoringBooking,
  tutoringPayment,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import { createNotification } from '@/lib/notifications/notify';
import { refreshTutorStats } from '@/lib/tutoring/booking-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  const [row] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      endAt: tutoringBooking.endAt,
      tutorUserId: tutorProfile.userId,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.tutorUserId !== userId) {
    return NextResponse.json(
      { error: 'Chỉ gia sư mới mark completed được' },
      { status: 403 },
    );
  }
  if (row.status !== 'CONFIRMED' && row.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `Status ${row.status} không complete được` },
      { status: 400 },
    );
  }
  if (row.endAt.getTime() > Date.now()) {
    return NextResponse.json(
      { error: 'Buổi học chưa kết thúc' },
      { status: 400 },
    );
  }

  const now = new Date();
  const escrowReleaseAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .update(tutoringBooking)
      .set({ status: 'COMPLETED', completedAt: now })
      .where(eq(tutoringBooking.id, row.id));
    await tx
      .update(tutoringPayment)
      .set({ escrowReleaseAt })
      .where(eq(tutoringPayment.bookingId, row.id));
  });

  await refreshTutorStats(row.tutorId);

  // COMPLETED gỡ khỏi "Đơn học sắp tới" + tutor profile (sessionsCompleted++) đổi →
  // xoá cache mine của CẢ student + tutor.
  await onTutoringMineChanged(row.studentId);
  await onTutoringMineChanged(row.tutorUserId);

  // Thông báo cho học viên: buổi học xong → mời đánh giá (realtime).
  void createNotification({
    userId: row.studentId,
    type: 'booking-completed',
    title: 'Buổi học đã hoàn thành',
    body: 'Hãy đánh giá gia sư để giúp cộng đồng nhé.',
    data: { bookingId: row.id, role: 'student' },
  }).catch((e) => console.error('[booking.complete notify]', e));

  return NextResponse.json({ ok: true });
}
