import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';

const DAY_MAP: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

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
  if (d.getTime() - fromDate.getTime() > aheadDays * 24 * 60 * 60 * 1000) {
    return null;
  }
  return d;
}

@Injectable()
export class TutoringRecurringRolloutJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ created: number }> {
    const activeRecurring = await this.prisma.tutoring_pack_purchase.findMany({
      where: {
        status: 'ACTIVE',
        remaining_sessions: { gt: 0 },
        recurring_schedule: { not: null },
      },
      include: {
        tutoring_pack: {
          include: { tutor_profile: { select: { instant_book_enabled: true } } },
        },
      },
    });

    let created = 0;
    const now = new Date();
    for (const purchase of activeRecurring) {
      const pack = purchase.tutoring_pack;
      const instantBookEnabled = pack.tutor_profile.instant_book_enabled;
      const schedule = parseSchedule(purchase.recurring_schedule ?? '');
      const next = nextOccurrence(schedule, now);
      if (!next) continue;

      const existing = await this.prisma.tutoring_booking.findFirst({
        where: { pack_purchase_id: purchase.id, start_at: next },
        select: { id: true },
      });
      if (existing) continue;

      const endAt = new Date(next.getTime() + pack.duration_min * 60_000);

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.tutoring_booking.create({
            data: {
              id: randomUUID(),
              tutor_id: pack.tutor_id,
              student_id: purchase.student_id,
              subject_slug: pack.subject_slug,
              level: pack.level,
              start_at: next,
              end_at: endAt,
              rate_vnd: pack.rate_per_session_vnd,
              status: instantBookEnabled ? 'CONFIRMED' : 'PENDING_TUTOR',
              confirmed_at: instantBookEnabled ? new Date() : null,
              pack_purchase_id: purchase.id,
            },
          });
          await tx.$executeRaw(Prisma.sql`
            UPDATE tutoring_pack_purchase
            SET remaining_sessions = remaining_sessions - 1,
                status = CASE WHEN remaining_sessions - 1 = 0 THEN 'EXHAUSTED' ELSE 'ACTIVE' END
            WHERE id = ${purchase.id}
          `);
        });
        created++;
      } catch (err) {
        logger.error('tutoring-rollout.create-failed', {
          purchaseId: purchase.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('tutoring-recurring-rollout.done', { created });
    return { created };
  }
}
