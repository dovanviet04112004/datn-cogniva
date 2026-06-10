/**
 * Seed Tutoring V2 demo: 3 bookings (1 PENDING, 1 CONFIRMED, 1 COMPLETED)
 * giữa user hiện tại (owner) và các seed tutor — DEV ONLY.
 *
 * Mục tiêu test UI: booking detail, action buttons, payment box, review form,
 * earnings card.
 *
 * Usage:
 *   cd apps/web
 *   pnpm exec tsx --env-file=.env.local scripts/seed-tutoring-v2.ts <ownerEmail>
 *
 * Reset:
 *   pnpm exec tsx --env-file=.env.local scripts/seed-tutoring-v2.ts <ownerEmail> --reset
 */
import { and, eq, like } from 'drizzle-orm';
import {
  db,
  tutorProfile,
  tutorReview,
  tutoringBooking,
  tutoringPayment,
  user,
} from '@cogniva/db';

import { autoCreateBookingGroup, refreshTutorStats } from '../src/lib/tutoring/booking-helpers';

const ownerEmailArg = process.argv[2];
if (!ownerEmailArg) {
  console.error('Usage: tsx seed-tutoring-v2.ts <ownerEmail>');
  process.exit(1);
}
const OWNER_EMAIL: string = ownerEmailArg;

const SEED_EMAIL_SUFFIX = '@seed.cogniva.local';

async function reset(ownerId: string) {
  console.log('🧹 Xoá bookings + reviews của owner...');
  // Xoá review trước (FK), payment, rồi booking
  const bookings = await db
    .select({ id: tutoringBooking.id })
    .from(tutoringBooking)
    .where(eq(tutoringBooking.studentId, ownerId));
  for (const b of bookings) {
    await db.delete(tutorReview).where(eq(tutorReview.bookingId, b.id));
    await db.delete(tutoringPayment).where(eq(tutoringPayment.bookingId, b.id));
  }
  await db.delete(tutoringBooking).where(eq(tutoringBooking.studentId, ownerId));
  console.log(`  ✓ Xoá ${bookings.length} booking`);
}

async function main() {
  const shouldReset = process.argv.includes('--reset');

  // Resolve owner user
  const [owner] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.email, OWNER_EMAIL))
    .limit(1);
  if (!owner) {
    console.error(`Không tìm thấy user với email ${OWNER_EMAIL}`);
    process.exit(1);
  }

  if (shouldReset) {
    await reset(owner.id);
    console.log('✅ Reset xong.');
    process.exit(0);
  }

  console.log(`🌱 Seed V2 bookings cho owner: ${owner.name} (${OWNER_EMAIL})`);

  // Resolve seed tutors — lấy 2 đầu tiên
  const seedTutors = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      userName: user.name,
    })
    .from(tutorProfile)
    .innerJoin(user, eq(user.id, tutorProfile.userId))
    .where(like(user.email, `%${SEED_EMAIL_SUFFIX}`))
    .limit(2);

  if (seedTutors.length < 2) {
    console.error('Cần seed-tutoring.ts trước (cần ≥ 2 tutor)');
    process.exit(1);
  }
  const [t1, t2] = seedTutors;
  console.log(`  Tutors: ${t1!.userName} + ${t2!.userName}`);

  // Booking 1: PENDING_TUTOR (chờ confirm) — 3 ngày tới
  const start1 = new Date();
  start1.setDate(start1.getDate() + 3);
  start1.setHours(19, 0, 0, 0);
  const end1 = new Date(start1.getTime() + 90 * 60_000);
  const rate1 = Math.round(t1!.hourlyRateVnd * 1.5);

  const [b1] = await db
    .insert(tutoringBooking)
    .values({
      tutorId: t1!.id,
      studentId: owner.id,
      subjectSlug: 'math',
      level: 'HIGH_SCHOOL',
      startAt: start1,
      endAt: end1,
      rateVnd: rate1,
      status: 'PENDING_TUTOR',
      studentMessage: 'Em đang yếu phần Tích phân + Hình OXYZ, mong cô luyện đề THPT trắc nghiệm.',
    })
    .returning();
  console.log(`  ✓ Booking 1 PENDING_TUTOR (${t1!.userName}) — ${rate1}đ`);

  // Booking 2: CONFIRMED (đã tạo study group + payment CAPTURED) — 2 ngày tới
  const start2 = new Date();
  start2.setDate(start2.getDate() + 2);
  start2.setHours(20, 0, 0, 0);
  const end2 = new Date(start2.getTime() + 120 * 60_000);
  const rate2 = t2!.hourlyRateVnd * 2;

  const b2 = await db.transaction(async (tx) => {
    const group = await autoCreateBookingGroup(tx, {
      bookingId: `seed-b2-${Date.now()}`,
      tutorUserId: t2!.userId,
      studentUserId: owner.id,
      subjectName: 'IELTS',
    });
    const [inserted] = await tx
      .insert(tutoringBooking)
      .values({
        tutorId: t2!.id,
        studentId: owner.id,
        subjectSlug: 'english-ielts',
        level: 'ADULT',
        startAt: start2,
        endAt: end2,
        rateVnd: rate2,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        studyGroupId: group.groupId,
        studentMessage: 'Mục tiêu IELTS 7.0 trong 4 tháng. Hiện đang 5.5.',
      })
      .returning();

    await tx.insert(tutoringPayment).values({
      bookingId: inserted!.id,
      amountVnd: rate2,
      feeVnd: Math.round(rate2 * 0.1),
      provider: 'STUB',
      providerRef: `stub-seed-${Date.now()}`,
      orderCode: `BK-SEED-${inserted!.id.slice(0, 8)}`,
      status: 'CAPTURED',
      capturedAt: new Date(),
      rawResponse: { mode: 'seed-stub' },
    });
    return inserted;
  });
  console.log(`  ✓ Booking 2 CONFIRMED (${t2!.userName}) — ${rate2}đ + study group`);

  // Booking 3: COMPLETED (đã review) — 1 tuần trước
  const start3 = new Date();
  start3.setDate(start3.getDate() - 7);
  start3.setHours(19, 0, 0, 0);
  const end3 = new Date(start3.getTime() + 90 * 60_000);
  const rate3 = Math.round(t1!.hourlyRateVnd * 1.5);

  const b3 = await db.transaction(async (tx) => {
    const completedAt = new Date(end3.getTime() + 30 * 60_000);
    const escrowAt = new Date(completedAt.getTime() + 7 * 24 * 60 * 60_000);
    // Set escrowAt about 5 days ago - so released earnings có sẵn
    const escrowReleaseAt = new Date(Date.now() - 5 * 24 * 60 * 60_000);

    const [inserted] = await tx
      .insert(tutoringBooking)
      .values({
        tutorId: t1!.id,
        studentId: owner.id,
        subjectSlug: 'math',
        level: 'HIGH_SCHOOL',
        startAt: start3,
        endAt: end3,
        rateVnd: rate3,
        status: 'COMPLETED',
        confirmedAt: new Date(start3.getTime() - 24 * 60 * 60_000),
        completedAt,
        studentMessage: 'Em cần luyện đề ĐH khối A.',
        sessionNotes: 'HS làm tốt 7 câu đầu, 3 câu cuối khó. Bài về: ôn lại Tích phân đổi biến.',
      })
      .returning();

    await tx.insert(tutoringPayment).values({
      bookingId: inserted!.id,
      amountVnd: rate3,
      feeVnd: Math.round(rate3 * 0.1),
      provider: 'STUB',
      providerRef: `stub-seed-${Date.now() + 1}`,
      orderCode: `BK-SEED-${inserted!.id.slice(0, 8)}-OLD`,
      status: 'CAPTURED',
      capturedAt: new Date(start3.getTime() - 12 * 60 * 60_000),
      escrowReleaseAt,
      rawResponse: { mode: 'seed-stub' },
    });

    // Insert review 5 sao
    await tx.insert(tutorReview).values({
      bookingId: inserted!.id,
      reviewerId: owner.id,
      tutorId: t1!.id,
      rating: 5,
      comment: 'Cô dạy rất tận tình, mình tăng được 1 điểm sau 4 buổi. Sẽ học tiếp!',
    });
    return inserted;
  });

  await refreshTutorStats(t1!.id);
  console.log(`  ✓ Booking 3 COMPLETED + review (${t1!.userName}) — ${rate3}đ`);

  console.log('\n✅ Seed V2 xong:');
  console.log(`   • /tutoring/bookings/${b1!.id}  — PENDING_TUTOR`);
  console.log(`   • /tutoring/bookings/${b2!.id}  — CONFIRMED + study group`);
  console.log(`   • /tutoring/bookings/${b3!.id}  — COMPLETED + reviewed`);
  console.log(`   • /tutoring?tab=mine            — xem dashboard cá nhân`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed V2 thất bại:', err);
  process.exit(1);
});
