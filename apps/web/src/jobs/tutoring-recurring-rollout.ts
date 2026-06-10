/**
 * BullMQ job `tutoring-recurring-rollout` — V4 T4 (2026-05-22).
 *
 * Chạy bởi worker; lịch/trigger ở src/queue/jobs.ts (CRON_JOBS) + src/worker.
 * Cron daily tạo booking ahead 7 ngày từ pack purchase có recurring_schedule
 * và tutoring_class enrollment WEEKLY/BIWEEKLY.
 *
 * Schedule: 02:30 UTC daily = 09:30 VN.
 *
 * Logic pack:
 *   1. SELECT purchase WHERE status='ACTIVE' AND remaining_sessions > 0
 *      AND recurring_schedule IS NOT NULL
 *   2. Parse "WEEKLY:TUE:19:00" → compute next slot trong 7 ngày tới
 *   3. Tạo booking PENDING_TUTOR (hoặc CONFIRMED nếu instant_book_enabled)
 *   4. Trừ remaining_sessions -1
 *   5. Nếu hết → status = 'EXHAUSTED'
 *
 * Idempotency: BullMQ retry CẢ job → an toàn vì trước khi tạo booking đã check
 * trùng slot (SELECT booking WHERE packPurchaseId + startAt) và bỏ qua nếu tồn tại;
 * mỗi insert + trừ session nằm trong transaction. Chạy lại không tạo booking trùng.
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutoringBooking,
  tutoringPack,
  tutoringPackPurchase,
} from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

const DAY_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

/** Parse "WEEKLY:TUE:19:00" → { freq, day, hour, minute } */
function parseSchedule(s: string): {
  freq: 'WEEKLY' | 'BIWEEKLY';
  day: number;
  hour: number;
  minute: number;
} | null {
  const m = s.match(/^(WEEKLY|BIWEEKLY):([A-Z]{3}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const day = DAY_MAP[m[2]!];
  if (day === undefined) return null;
  return {
    freq: m[1] as 'WEEKLY' | 'BIWEEKLY',
    day,
    hour: parseInt(m[3]!, 10),
    minute: parseInt(m[4]!, 10),
  };
}

/** Compute next occurrence within `aheadDays` (default 7). */
function nextOccurrence(
  schedule: ReturnType<typeof parseSchedule>,
  fromDate: Date,
  aheadDays = 7,
): Date | null {
  if (!schedule) return null;
  const d = new Date(fromDate);
  d.setHours(schedule.hour, schedule.minute, 0, 0);
  const dayDiff = (schedule.day - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + dayDiff);
  if (d.getTime() < fromDate.getTime()) {
    d.setDate(d.getDate() + 7);
  }
  // Verify trong window
  if (d.getTime() - fromDate.getTime() > aheadDays * 24 * 60 * 60 * 1000) {
    return null;
  }
  return d;
}

/**
 * Thân job (cron, không nhận tham số). Trả về summary { created } để BullMQ lưu
 * làm job result.
 */
export async function tutoringRecurringRollout(): Promise<{ created: number }> {
  // Trước đây là step.run('rollout-pack-purchases', …) — inline nguyên thân, giá
  // trị trả về gán vào `created`.
  const created = await (async () => {
    const activeRecurring = await db
      .select({
        purchase: tutoringPackPurchase,
        pack: tutoringPack,
        tutorUserId: tutorProfile.userId,
        instantBookEnabled: tutorProfile.instantBookEnabled,
      })
      .from(tutoringPackPurchase)
      .innerJoin(tutoringPack, eq(tutoringPack.id, tutoringPackPurchase.packId))
      .innerJoin(tutorProfile, eq(tutorProfile.id, tutoringPack.tutorId))
      .where(
        and(
          eq(tutoringPackPurchase.status, 'ACTIVE'),
          gt(tutoringPackPurchase.remainingSessions, 0),
          isNotNull(tutoringPackPurchase.recurringSchedule),
        ),
      );

    let count = 0;
    const now = new Date();
    for (const row of activeRecurring) {
      const schedule = parseSchedule(row.purchase.recurringSchedule ?? '');
      const next = nextOccurrence(schedule, now);
      if (!next) continue;

      // Check chưa có booking nào tại slot này từ pack này (idempotent)
      const [existing] = await db
        .select({ id: tutoringBooking.id })
        .from(tutoringBooking)
        .where(
          and(
            eq(tutoringBooking.packPurchaseId, row.purchase.id),
            eq(tutoringBooking.startAt, next),
          ),
        )
        .limit(1);
      if (existing) continue;

      const endAt = new Date(next.getTime() + row.pack.durationMin * 60_000);

      try {
        await db.transaction(async (tx) => {
          await tx.insert(tutoringBooking).values({
            tutorId: row.pack.tutorId,
            studentId: row.purchase.studentId,
            subjectSlug: row.pack.subjectSlug,
            level: row.pack.level,
            startAt: next,
            endAt,
            rateVnd: row.pack.ratePerSessionVnd,
            status: row.instantBookEnabled ? 'CONFIRMED' : 'PENDING_TUTOR',
            confirmedAt: row.instantBookEnabled ? new Date() : null,
            packPurchaseId: row.purchase.id,
          });
          await tx
            .update(tutoringPackPurchase)
            .set({
              remainingSessions: sql`${tutoringPackPurchase.remainingSessions} - 1`,
              status: sql`CASE WHEN ${tutoringPackPurchase.remainingSessions} - 1 = 0 THEN 'EXHAUSTED' ELSE 'ACTIVE' END`,
            })
            .where(eq(tutoringPackPurchase.id, row.purchase.id));
        });
        count++;
      } catch (err) {
        logger.error('tutoring-rollout.create-failed', {
          purchaseId: row.purchase.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return count;
  })();

  logger.info('tutoring-recurring-rollout.done', { created });
  return { created };
}
