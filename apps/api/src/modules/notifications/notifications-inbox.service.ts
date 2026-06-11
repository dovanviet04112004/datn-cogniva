import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import type { MarkReadInput } from './dto/notifications.dto';

@Injectable()
export class NotificationsInboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, limit: number, unreadOnly: boolean) {
    const where = unreadOnly ? { user_id: userId, read_at: null } : { user_id: userId };

    const [rows, countRows] = await Promise.all([
      this.prisma.notification_log.findMany({
        where,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          read_at: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      }),
      this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM "notification_log"
        WHERE user_id = ${userId} AND read_at IS NULL
      `),
    ]);

    return {
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.read_at?.toISOString() ?? null,
        createdAt: n.created_at.toISOString(),
      })),
      unreadCount: Number(countRows[0]?.n ?? 0),
    };
  }

  async markRead(userId: string, input: MarkReadInput) {
    const now = new Date();
    const updated = input.all
      ? await this.prisma.notification_log.updateMany({
          where: { user_id: userId, read_at: null },
          data: { read_at: now },
        })
      : await this.prisma.notification_log.updateMany({
          where: { user_id: userId, id: { in: input.ids! } },
          data: { read_at: now },
        });

    return { ok: true, affected: updated.count };
  }
}
