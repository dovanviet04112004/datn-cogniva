/**
 * POST /api/tutoring/bookings/[id]/reschedule — V4 T2 (2026-05-22).
 *
 * Đổi lịch booking thay vì cancel + book lại:
 *   - Student/tutor đề xuất start mới (giữ duration)
 *   - Validate ≥ 12h trước startAt cũ (không reschedule sát giờ)
 *   - Max 3 lần reschedule / booking (chống abuse)
 *   - Validate slot trong availability + no conflict
 *
 * Body: { newStartAt: ISO string }
 *
 * Flow:
 *   - Lưu original_start_at nếu chưa có (lần reschedule đầu)
 *   - Update start_at + end_at (giữ duration) + reschedule_count++
 *   - Status giữ nguyên (CONFIRMED giữ CONFIRMED; PENDING_TUTOR vẫn pending)
 *
 * Spec: docs/plans/tutoring-v4.md §3 T2.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutoringBooking,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import {
  hasConflictBooking,
  isSlotInAvailability,
} from '@/lib/tutoring/booking-helpers';

export const runtime = 'nodejs';

const BODY_SCHEMA = z.object({
  newStartAt: z.string().datetime(),
});

const MIN_LEAD_HOURS = 12;
const MAX_RESCHEDULE = 3;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [booking] = await db
    .select({
      id: tutoringBooking.id,
      tutorId: tutoringBooking.tutorId,
      studentId: tutoringBooking.studentId,
      startAt: tutoringBooking.startAt,
      endAt: tutoringBooking.endAt,
      status: tutoringBooking.status,
      originalStartAt: tutoringBooking.originalStartAt,
      rescheduleCount: tutoringBooking.rescheduleCount,
      tutorUserId: tutorProfile.userId,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .where(eq(tutoringBooking.id, id))
    .limit(1);

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.studentId !== userId && booking.tutorUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Chỉ reschedule khi PENDING_TUTOR hoặc CONFIRMED
  if (!['PENDING_TUTOR', 'CONFIRMED'].includes(booking.status)) {
    return NextResponse.json(
      { error: `Không thể đổi lịch booking trạng thái ${booking.status}` },
      { status: 400 },
    );
  }

  // Lead time ≥ 12h
  const hoursToStart = (booking.startAt.getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursToStart < MIN_LEAD_HOURS) {
    return NextResponse.json(
      { error: `Phải đổi lịch trước ít nhất ${MIN_LEAD_HOURS} giờ` },
      { status: 400 },
    );
  }

  // Max 3 lần
  if (booking.rescheduleCount >= MAX_RESCHEDULE) {
    return NextResponse.json(
      { error: `Tối đa ${MAX_RESCHEDULE} lần đổi lịch / booking` },
      { status: 400 },
    );
  }

  const newStart = new Date(parsed.data.newStartAt);
  const durationMin = (booking.endAt.getTime() - booking.startAt.getTime()) / 60000;
  const newEnd = new Date(newStart.getTime() + durationMin * 60000);

  if (newStart.getTime() < Date.now() + 60 * 60 * 1000) {
    return NextResponse.json(
      { error: 'Thời gian mới phải sau ít nhất 1 giờ' },
      { status: 400 },
    );
  }

  // Slot fit availability + no conflict với booking khác (excluding self)
  const fits = await isSlotInAvailability(booking.tutorId, newStart, newEnd);
  if (!fits) {
    return NextResponse.json(
      { error: 'Khung giờ mới không trong lịch rảnh của gia sư' },
      { status: 400 },
    );
  }
  // Exclude self khi check conflict
  const [conflicting] = await db
    .select({ id: tutoringBooking.id })
    .from(tutoringBooking)
    .where(
      and(
        eq(tutoringBooking.tutorId, booking.tutorId),
        ne(tutoringBooking.id, booking.id),
        sql`${tutoringBooking.status} IN ('PENDING_TUTOR','CONFIRMED','IN_PROGRESS')`,
        sql`tstzrange(${tutoringBooking.startAt}, ${tutoringBooking.endAt}) && tstzrange(${newStart}, ${newEnd})`,
      ),
    )
    .limit(1);
  if (conflicting) {
    return NextResponse.json(
      { error: 'Khung giờ này đã có buổi khác — chọn giờ khác' },
      { status: 409 },
    );
  }

  // Update — lưu originalStartAt nếu là lần đầu reschedule
  const [updated] = await db
    .update(tutoringBooking)
    .set({
      startAt: newStart,
      endAt: newEnd,
      originalStartAt: booking.originalStartAt ?? booking.startAt,
      rescheduleCount: booking.rescheduleCount + 1,
    })
    .where(eq(tutoringBooking.id, id))
    .returning();

  // startAt đổi → thứ tự/nội dung "Đơn học sắp tới" của CẢ student + tutor đổi → xoá cache mine.
  await onTutoringMineChanged(booking.studentId);
  await onTutoringMineChanged(booking.tutorUserId);

  return NextResponse.json({ booking: updated });
}

// Đảm bảo conflict-check sử dụng helper khi DB chưa có index range — tạm dùng raw SQL.
void hasConflictBooking;
