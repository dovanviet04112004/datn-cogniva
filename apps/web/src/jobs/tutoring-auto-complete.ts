/**
 * BullMQ job `tutoring-auto-complete` — auto mark booking COMPLETED.
 *
 * Chạy bởi worker; lịch/trigger ở src/queue/jobs.ts (CRON_JOBS, pattern
 * '5 * * * *') + src/worker dispatch theo job.name.
 *
 * Phase 21 V2 — Khi endAt + 1h đã qua mà tutor chưa bấm "Mark Complete",
 * cron tự đánh dấu để:
 *   - sessions_completed counter chính xác (rating sau review)
 *   - escrow_release_at trên payment được set → tutor có thể payout
 *
 * Schedule: mỗi giờ — kiểm tra mọi booking CONFIRMED/IN_PROGRESS với
 * endAt < (NOW() - 1h).
 *
 * Idempotent: chỉ select status còn pending, set COMPLETED. Nếu cron chạy
 * 2 lần trong cùng 1h → lần 2 sẽ thấy 0 row. Phần escrow cũng idempotent
 * nhờ WHERE escrow_release_at IS NULL → an toàn khi whole-job retry.
 *
 * Khi nào KHÔNG run:
 *   - Booking đã CANCELLED → skip
 *   - Booking đã COMPLETED → skip
 *   - Booking IN_PROGRESS với endAt trong tương lai → skip
 */
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';

import {
  db,
  tutoringBooking,
  tutoringPayment,
  tutorProfile,
  tutorReview,
} from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

/** Grace 1h sau endAt — tránh complete buổi còn đang diễn ra do delay user. */
const GRACE_MS = 60 * 60 * 1000;

export async function tutoringAutoComplete() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - GRACE_MS);

  // Step 1: select bookings to complete
  const toComplete = await db
    .select({
      id: tutoringBooking.id,
      tutorId: tutoringBooking.tutorId,
      endAt: tutoringBooking.endAt,
    })
    .from(tutoringBooking)
    .where(
      and(
        or(
          eq(tutoringBooking.status, 'CONFIRMED'),
          eq(tutoringBooking.status, 'IN_PROGRESS'),
        ),
        lte(tutoringBooking.endAt, cutoff),
      ),
    )
    .limit(500);

  if (toComplete.length === 0) {
    logger.info('tutoring.auto_complete.none_due');
    return { processed: 0 };
  }

  logger.info('tutoring.auto_complete.processing', { count: toComplete.length });

  const ids = toComplete.map((b) => b.id);
  const tutorIds = Array.from(new Set(toComplete.map((b) => b.tutorId)));

  const escrowHours = parseInt(process.env.TUTORING_ESCROW_HOURS ?? '168', 10);
  const escrowReleaseAt = new Date(now.getTime() + escrowHours * 60 * 60 * 1000);

  // Step 2: mark COMPLETED + set escrow
  await db.transaction(async (tx) => {
    await tx
      .update(tutoringBooking)
      .set({
        status: 'COMPLETED',
        completedAt: now,
      })
      .where(inArray(tutoringBooking.id, ids));

    // Set escrow release cho payment CAPTURED chưa có escrow time.
    // Idempotent: WHERE escrow_release_at IS NULL → nếu cron chạy lại
    // sẽ không reset escrow đã set rồi.
    await tx
      .update(tutoringPayment)
      .set({ escrowReleaseAt })
      .where(
        and(
          inArray(tutoringPayment.bookingId, ids),
          eq(tutoringPayment.status, 'CAPTURED'),
          sql`escrow_release_at IS NULL`,
        ),
      );
  });

  // Step 3: refresh stats cho mỗi tutor unique
  for (const tutorId of tutorIds) {
    await db
      .update(tutorProfile)
      .set({
        ratingAvg: sql<string>`(
          SELECT round(avg(rating)::numeric, 2)
          FROM ${tutorReview}
          WHERE ${tutorReview.tutorId} = ${tutorId}
        )`,
        ratingCount: sql<number>`(
          SELECT count(*)::int
          FROM ${tutorReview}
          WHERE ${tutorReview.tutorId} = ${tutorId}
        )`,
        sessionsCompleted: sql<number>`(
          SELECT count(*)::int
          FROM ${tutoringBooking}
          WHERE ${tutoringBooking.tutorId} = ${tutorId}
            AND ${tutoringBooking.status} = 'COMPLETED'
        )`,
        updatedAt: now,
      })
      .where(eq(tutorProfile.id, tutorId));
  }

  return { processed: toComplete.length, tutorsAffected: tutorIds.length };
}
