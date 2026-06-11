import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { onKarmaChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';

export type KarmaEventType =
  | 'doc_imported'
  | 'doc_remixed'
  | 'endorsed'
  | 'high_quality'
  | 'premium_sale';

const POINTS_BY_TYPE: Record<KarmaEventType, number> = {
  doc_imported: 1,
  doc_remixed: 5,
  endorsed: 10,
  high_quality: 20,
  premium_sale: 10,
};

@Injectable()
export class KarmaService {
  constructor(private readonly prisma: PrismaService) {}

  async awardKarma(input: {
    userId: string;
    eventType: KarmaEventType;
    docId?: string;
    context?: Record<string, unknown>;
  }): Promise<{ points: number; total: number }> {
    const points = POINTS_BY_TYPE[input.eventType];
    if (!points) return { points: 0, total: 0 };

    await this.prisma.library_karma_event.create({
      data: {
        id: randomUUID(),
        user_id: input.userId,
        event_type: input.eventType,
        points,
        doc_id: input.docId ?? null,
        context: (input.context as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      },
    });

    const result = await this.prisma.library_creator_karma.upsert({
      where: { user_id: input.userId },
      create: { user_id: input.userId, points, last_event_at: new Date() },
      update: {
        points: { increment: points },
        last_event_at: new Date(),
        updated_at: new Date(),
      },
      select: { points: true },
    });

    await onKarmaChanged();

    return { points, total: result?.points ?? points };
  }
}
