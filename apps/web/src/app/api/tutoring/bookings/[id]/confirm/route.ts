/**
 * POST /api/tutoring/bookings/[id]/confirm — tutor xác nhận booking.
 *
 * Side effects:
 *   1. Update booking.status = 'CONFIRMED' + confirmedAt
 *   2. Auto-create study group dedicated cho cặp tutor+student với 3 channel
 *      (TEXT/VOICE/FORUM) — booking.studyGroupId = new group id
 *   3. Tạo tutoring_payment record STUB CAPTURED (V3 sẽ wire VNPay thật)
 *
 * Transaction — rollback toàn bộ nếu bất kỳ step fail.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import {
  db,
  SUBJECT_BY_SLUG,
  tutorProfile,
  tutoringBooking,
  tutoringPayment,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import { createNotification } from '@/lib/notifications/notify';
import { autoCreateBookingGroup } from '@/lib/tutoring/booking-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;

  // Booking + tutor + student user info — fetch sẵn ngoài transaction
  const [row] = await db
    .select({
      id: tutoringBooking.id,
      status: tutoringBooking.status,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      subjectSlug: tutoringBooking.subjectSlug,
      rateVnd: tutoringBooking.rateVnd,
      tutorUserId: tutorProfile.userId,
      studentName: userTable.name,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutoringBooking.studentId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.tutorUserId !== userId) {
    return NextResponse.json({ error: 'Chỉ gia sư mới confirm được' }, { status: 403 });
  }
  if (row.status !== 'PENDING_TUTOR') {
    return NextResponse.json(
      { error: `Booking đang ở status ${row.status}, không confirm được` },
      { status: 400 },
    );
  }

  const subjectName = SUBJECT_BY_SLUG[row.subjectSlug]?.name ?? row.subjectSlug;

  const result = await db.transaction(async (tx) => {
    // 1. Create study group + channels
    const group = await autoCreateBookingGroup(tx, {
      bookingId: row.id,
      tutorUserId: row.tutorUserId,
      studentUserId: row.studentId,
      subjectName,
    });

    // 2. Update booking
    const updated = await tx
      .update(tutoringBooking)
      .set({
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        studyGroupId: group.groupId,
      })
      .where(eq(tutoringBooking.id, row.id))
      .returning();

    // 3. Create payment STUB — V3 wire VNPay thật ở bước intent riêng
    // Stub auto-CAPTURED ngay để dev test full flow không cần payment gateway.
    const fee = Math.round(row.rateVnd * 0.1); // 10% Cogniva commission
    const orderCode = `BK-${row.id.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
    await tx.insert(tutoringPayment).values({
      bookingId: row.id,
      amountVnd: row.rateVnd,
      feeVnd: fee,
      provider: 'STUB',
      providerRef: `stub-${Date.now()}`,
      orderCode,
      status: 'CAPTURED',
      capturedAt: new Date(),
      // Escrow release 7 ngày sau completedAt — tính lúc complete
      escrowReleaseAt: null,
      rawResponse: { mode: 'dev-stub', note: 'auto-captured on confirm' },
    });

    return { booking: updated[0], group };
  });

  // Status PENDING→CONFIRMED đổi "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
  await onTutoringMineChanged(row.studentId);
  await onTutoringMineChanged(row.tutorUserId);

  // Thông báo cho học viên: gia sư đã xác nhận (realtime, non-blocking).
  void createNotification({
    userId: row.studentId,
    type: 'booking-confirmed',
    title: 'Gia sư đã xác nhận buổi học',
    body: `Buổi ${subjectName} đã được xác nhận — xem chi tiết & thanh toán.`,
    data: { bookingId: row.id, role: 'student' },
  }).catch((e) => console.error('[booking.confirm notify]', e));

  return NextResponse.json(result);
}
