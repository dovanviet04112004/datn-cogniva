/**
 * /api/tutoring/bookings — list bookings của user hiện tại + create booking.
 *
 * GET ?role=student|tutor|all (default all) — trả bookings user là student
 *      hoặc là tutor, sort startAt giảm dần.
 * POST: student tạo booking mới. Body { tutorId, subjectSlug, level, startAt,
 *       endAt, studentMessage? }. Server validate slot fit availability +
 *       không conflict. Status mặc định PENDING_TUTOR, đợi tutor confirm.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, desc, eq, gte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutoringBooking,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import { checkLimit } from '@/lib/rate-limit';
import {
  hasConflictBooking,
  isSlotInAvailability,
} from '@/lib/tutoring/booking-helpers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const url = new URL(request.url);
  const role = url.searchParams.get('role') ?? 'all';
  const upcoming = url.searchParams.get('upcoming') === 'true';

  // Tutor profile của user nếu có — để query role=tutor
  const [myProfile] = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(eq(tutorProfile.userId, userId))
    .limit(1);

  const conds = [] as ReturnType<typeof eq>[];
  if (role === 'student') {
    conds.push(eq(tutoringBooking.studentId, userId));
  } else if (role === 'tutor') {
    if (!myProfile) return NextResponse.json({ bookings: [] });
    conds.push(eq(tutoringBooking.tutorId, myProfile.id));
  } else {
    // all — union student-side OR tutor-side
    if (myProfile) {
      conds.push(
        or(
          eq(tutoringBooking.studentId, userId),
          eq(tutoringBooking.tutorId, myProfile.id),
        ) as ReturnType<typeof eq>,
      );
    } else {
      conds.push(eq(tutoringBooking.studentId, userId));
    }
  }

  if (upcoming) conds.push(gte(tutoringBooking.startAt, new Date()));

  // Alias user thứ 2 để lấy thông tin HỌC VIÊN (cho tutor view thấy ai đặt).
  const studentUser = alias(userTable, 'student_user');

  const rows = await db
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
      isTrial: tutoringBooking.isTrial,
      createdAt: tutoringBooking.createdAt,
      tutorHeadline: tutorProfile.headline,
      tutorAvatarUrl: tutorProfile.avatarUrl,
      tutorUserId: tutorProfile.userId,
      tutorName: userTable.name,
      studentName: studentUser.name,
      studentImage: studentUser.image,
    })
    .from(tutoringBooking)
    .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringBooking.tutorId))
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .innerJoin(studentUser, eq(studentUser.id, tutoringBooking.studentId))
    .where(and(...conds))
    .orderBy(upcoming ? asc(tutoringBooking.startAt) : desc(tutoringBooking.startAt))
    .limit(50);

  return NextResponse.json({ bookings: rows });
}

const CREATE_SCHEMA = z.object({
  tutorId: z.string().min(1),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  studentMessage: z.string().max(500).optional(),
  /**
   * V4 T2: trial booking — giảm 50% rate, 1 lần / pair (student, tutor).
   * Server enforce qua DB partial unique index + app check.
   */
  isTrial: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const rl = await checkLimit(`booking:${userId}`, 'default');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Quá nhiều booking — đợi vài phút' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  if (endAt <= startAt) {
    return NextResponse.json({ error: 'endAt phải sau startAt' }, { status: 400 });
  }
  const durationMin = (endAt.getTime() - startAt.getTime()) / 60000;
  if (durationMin < 30 || durationMin > 240) {
    return NextResponse.json(
      { error: 'Buổi học từ 30 phút đến 4 giờ' },
      { status: 400 },
    );
  }
  if (startAt.getTime() < Date.now() + 60 * 60 * 1000) {
    return NextResponse.json(
      { error: 'Phải book trước ít nhất 1 giờ' },
      { status: 400 },
    );
  }

  // Tutor tồn tại + PUBLISHED + không phải mình
  const [tutor] = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      status: tutorProfile.status,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      instantBookEnabled: tutorProfile.instantBookEnabled,
      trialSessionEnabled: tutorProfile.trialSessionEnabled,
    })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, parsed.data.tutorId))
    .limit(1);
  if (!tutor || tutor.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Tutor không tồn tại / chưa publish' }, { status: 404 });
  }
  if (tutor.userId === userId) {
    return NextResponse.json({ error: 'Không thể book chính mình' }, { status: 400 });
  }

  // V4 T2: validate trial eligibility
  const isTrial = parsed.data.isTrial === true;
  if (isTrial) {
    if (!tutor.trialSessionEnabled) {
      return NextResponse.json(
        { error: 'Gia sư này không bật trial session' },
        { status: 400 },
      );
    }
    // Check 1 trial / pair (student, tutor) — partial unique sẽ block insert,
    // nhưng pre-check để trả error friendly
    const [prior] = await db
      .select({ id: tutoringBooking.id })
      .from(tutoringBooking)
      .where(
        and(
          eq(tutoringBooking.studentId, userId),
          eq(tutoringBooking.tutorId, tutor.id),
          eq(tutoringBooking.isTrial, true),
        ),
      )
      .limit(1);
    if (prior) {
      return NextResponse.json(
        { error: 'Bạn đã dùng trial với gia sư này — đặt buổi học chính thức.' },
        { status: 400 },
      );
    }
    // Trial bắt buộc 30 phút
    if (durationMin !== 30) {
      return NextResponse.json(
        { error: 'Trial chỉ dài 30 phút' },
        { status: 400 },
      );
    }
  }

  // Slot fit availability
  const fits = await isSlotInAvailability(tutor.id, startAt, endAt);
  if (!fits) {
    return NextResponse.json(
      { error: 'Khung giờ không nằm trong lịch rảnh của gia sư' },
      { status: 400 },
    );
  }

  // No conflict
  const conflict = await hasConflictBooking(tutor.id, startAt, endAt);
  if (conflict) {
    return NextResponse.json(
      { error: 'Khung giờ này đã có booking khác — chọn giờ khác' },
      { status: 409 },
    );
  }

  // Tính rateVnd: per-hour rate × duration hours, trial giảm 50%
  const baseRate = Math.round(tutor.hourlyRateVnd * (durationMin / 60));
  const rateVnd = isTrial ? Math.round(baseRate / 2) : baseRate;

  // V4 T2: Instant Book — tutor opt-in cho phép student book ngay
  const status = tutor.instantBookEnabled ? 'CONFIRMED' : 'PENDING_TUTOR';
  const confirmedAt = tutor.instantBookEnabled ? new Date() : null;

  const [created] = await db
    .insert(tutoringBooking)
    .values({
      tutorId: tutor.id,
      studentId: userId,
      subjectSlug: parsed.data.subjectSlug,
      level: parsed.data.level,
      startAt,
      endAt,
      rateVnd,
      status,
      confirmedAt,
      studentMessage: parsed.data.studentMessage ?? null,
      isTrial,
    })
    .returning();

  // NOTE: Instant-book bypass tutor confirm step, nhưng KHÔNG auto-create
  // study group ở đây (giữ logic confirm endpoint). Hệ quả: instant book
  // status=CONFIRMED nhưng studyGroupId=null cho tới khi /confirm endpoint
  // được gọi (V4.1 sẽ wire auto-create cho instant book path).

  // Booking mới hiện ở "Đơn học sắp tới" của CẢ student + tutor → xoá cache mine cả hai.
  await onTutoringMineChanged(userId);
  await onTutoringMineChanged(tutor.userId);

  return NextResponse.json({ booking: created, instantBooked: tutor.instantBookEnabled }, { status: 201 });
}
