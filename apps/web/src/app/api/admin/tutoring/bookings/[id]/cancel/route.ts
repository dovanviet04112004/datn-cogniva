/**
 * POST /api/admin/tutoring/bookings/[id]/cancel — admin force cancel 1 booking.
 *
 * Body: { reason: string (10..500) }
 * Tác động:
 *   - tutoringBooking.status = CANCELLED + cancelledAt + cancelledBy = admin.userId
 *     + cancelReason = reason
 *   - Nếu booking đã CONFIRMED + study_group đã tạo: KHÔNG xoá group (student
 *     có thể cần xem lại tài liệu)
 *   - Notify cả tutor + student qua notification_log
 *
 * KHÔNG tự refund — admin phải gọi /refund riêng sau khi đã verify với payment provider.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  notificationLog,
  tutorProfile,
  tutoringBooking,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'booking.force_cancel',
    { type: 'booking', id },
    async () => {
      const [before] = await db
        .select({
          id: tutoringBooking.id,
          status: tutoringBooking.status,
          studentId: tutoringBooking.studentId,
          tutorId: tutoringBooking.tutorId,
          startAt: tutoringBooking.startAt,
        })
        .from(tutoringBooking)
        .where(eq(tutoringBooking.id, id))
        .limit(1);
      if (!before) throw new Error('Booking not found');
      if (before.status === 'CANCELLED') throw new Error('Booking đã bị huỷ');
      if (before.status === 'COMPLETED')
        throw new Error('Booking đã hoàn thành, không huỷ được');

      const now = new Date();
      await db
        .update(tutoringBooking)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: admin.userId,
          cancelReason: reason,
        })
        .where(eq(tutoringBooking.id, id));

      // Lookup tutor userId để notify
      const [tutor] = await db
        .select({ userId: tutorProfile.userId })
        .from(tutorProfile)
        .where(eq(tutorProfile.id, before.tutorId))
        .limit(1);

      return {
        before,
        after: { status: 'CANCELLED', cancelledBy: admin.userId, cancelReason: reason },
        reason,
        result: {
          ok: true,
          tutorUserId: tutor?.userId ?? null,
          studentUserId: before.studentId,
        },
      };
    },
  );

  // Fire-and-forget notify cả 2 bên
  const startStr = new Date().toLocaleString('vi-VN');
  const notifyRows: Array<{
    userId: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    status: string;
  }> = [];
  if (result.tutorUserId) {
    notifyRows.push({
      userId: result.tutorUserId,
      type: 'admin-booking-cancel',
      title: 'Booking bị huỷ bởi admin',
      body: `Buổi dạy đã bị huỷ. Lý do: ${reason}`,
      data: { bookingId: id, role: 'tutor', reason },
      status: 'pending',
    });
  }
  notifyRows.push({
    userId: result.studentUserId,
    type: 'admin-booking-cancel',
    title: 'Booking bị huỷ bởi admin',
    body: `Buổi học đã bị huỷ. Lý do: ${reason}`,
    data: { bookingId: id, role: 'student', reason },
    status: 'pending',
  });
  if (notifyRows.length > 0) {
    void db.insert(notificationLog).values(notifyRows).catch((err) => {
      console.error('[admin booking.cancel notify] fail:', err);
    });
  }
  // startStr không dùng nữa nhưng đảm bảo logger không nuốt — bỏ.
  void startStr;

  return NextResponse.json({ ok: true });
}
