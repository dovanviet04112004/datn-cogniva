/**
 * Job `tutoring-auto-complete` ('5 * * * *' UTC — mỗi giờ) — Phase 21 V2.
 * Port NGUYÊN semantics từ apps/web/src/jobs/tutoring-auto-complete.ts:
 * booking CONFIRMED/IN_PROGRESS có end_at quá hạn (grace 1h sau end_at —
 * tránh complete buổi còn đang diễn ra) → COMPLETED batch 500; cùng tx set
 * escrow_release_at = now + TUTORING_ESCROW_HOURS (env, default 168h) cho
 * payment CAPTURED chưa có escrow → tutor mới payout được. Sau đó recompute
 * stats per tutor.
 *
 * Idempotent: chạy lại trong cùng giờ thấy 0 booking pending; escrow chỉ set
 * WHERE escrow_release_at IS NULL nên không reset mốc đã có.
 *
 * LƯU Ý: recompute rating ở đây KHÔNG filter hidden_at trên tutor_review
 * (khác refreshTutorStats của route) — GIỮ NGUYÊN khác biệt của bản cron cũ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';

/** Grace 1h sau endAt — tránh complete buổi còn đang diễn ra do delay user. */
const GRACE_MS = 60 * 60 * 1000;

@Injectable()
export class TutoringAutoCompleteJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ processed: number; tutorsAffected?: number }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - GRACE_MS);

    const toComplete = await this.prisma.tutoring_booking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        end_at: { lte: cutoff },
      },
      select: { id: true, tutor_id: true },
      take: 500,
    });

    if (toComplete.length === 0) {
      logger.info('tutoring.auto_complete.none_due');
      return { processed: 0 };
    }

    logger.info('tutoring.auto_complete.processing', { count: toComplete.length });

    const ids = toComplete.map((b) => b.id);
    const tutorIds = Array.from(new Set(toComplete.map((b) => b.tutor_id)));

    const escrowHours = parseInt(process.env.TUTORING_ESCROW_HOURS ?? '168', 10);
    const escrowReleaseAt = new Date(now.getTime() + escrowHours * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.tutoring_booking.updateMany({
        where: { id: { in: ids } },
        data: { status: 'COMPLETED', completed_at: now },
      });
      await tx.tutoring_payment.updateMany({
        where: {
          booking_id: { in: ids },
          status: 'CAPTURED',
          escrow_release_at: null,
        },
        data: { escrow_release_at: escrowReleaseAt },
      });
    });

    // Subquery tương quan như bản Drizzle cũ — Prisma client không express
    // được nên giữ raw UPDATE per tutor.
    for (const tutorId of tutorIds) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE tutor_profile SET
          rating_avg = (
            SELECT round(avg(rating)::numeric, 2)
            FROM tutor_review
            WHERE tutor_review.tutor_id = ${tutorId}
          ),
          rating_count = (
            SELECT count(*)::int
            FROM tutor_review
            WHERE tutor_review.tutor_id = ${tutorId}
          ),
          sessions_completed = (
            SELECT count(*)::int
            FROM tutoring_booking
            WHERE tutoring_booking.tutor_id = ${tutorId}
              AND tutoring_booking.status = 'COMPLETED'
          ),
          updated_at = ${now}
        WHERE tutor_profile.id = ${tutorId}
      `);
    }

    return { processed: toComplete.length, tutorsAffected: tutorIds.length };
  }
}
