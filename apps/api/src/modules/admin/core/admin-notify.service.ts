import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';

const GROUP_NOTIFY_CFG = {
  suspend: {
    type: 'admin-group-suspend',
    title: (name: string) => `Group "${name}" đã bị tạm khóa`,
    bodyPrefix: 'Lý do',
  },
  unsuspend: {
    type: 'admin-group-unsuspend',
    title: (name: string) => `Group "${name}" đã được khôi phục`,
    bodyPrefix: 'Ghi chú',
  },
  delete: {
    type: 'admin-group-delete',
    title: (name: string) => `Group "${name}" đã bị xóa vĩnh viễn`,
    bodyPrefix: 'Lý do',
  },
} as const;

@Injectable()
export class AdminNotifyService {
  constructor(private readonly prisma: PrismaService) {}

  async notifyGroupSuspend(opts: {
    groupId: string;
    groupName: string;
    memberIds: string[];
    reason: string;
    kind?: 'suspend' | 'unsuspend' | 'delete';
  }): Promise<void> {
    const { groupId, groupName, memberIds, reason, kind = 'suspend' } = opts;
    if (memberIds.length === 0) return;
    const cfg = GROUP_NOTIFY_CFG[kind];

    await this.prisma.notification_log.createMany({
      data: memberIds.map((userId) => ({
        id: randomUUID(),
        user_id: userId,
        type: cfg.type,
        title: cfg.title(groupName),
        body: `${cfg.bodyPrefix}: ${reason}`,
        data: { groupId, groupName, kind, reason } as Prisma.InputJsonValue,
        status: 'pending',
      })),
    });
  }

  async notifyWarnUser(opts: {
    userId: string;
    reason: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.notification_log.create({
      data: {
        id: randomUUID(),
        user_id: opts.userId,
        type: 'admin-warn',
        title: 'Cảnh báo từ ban quản trị',
        body: opts.reason,
        data: { ...opts.context, reason: opts.reason } as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
  }
}
