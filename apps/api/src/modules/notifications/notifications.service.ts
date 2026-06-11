import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(input: NewNotification | NewNotification[]): Promise<void> {
    const rows = (Array.isArray(input) ? input : [input]).filter((r) => r.userId);
    if (rows.length === 0) return;

    await this.prisma.notification_log.createMany({
      data: rows.map((r) => ({
        id: randomUUID(),
        user_id: r.userId,
        type: r.type,
        title: r.title,
        body: r.body,
        data: (r.data as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        status: 'pending',
      })),
    });

    const userIds = [...new Set(rows.map((r) => r.userId))];
    await Promise.all(
      userIds.map((uid) =>
        triggerEvent(`presence-user-${uid}`, 'notification:new', {}).catch(() => {}),
      ),
    );
  }

  async getPushTokens(userIds: string[]): Promise<Array<{ userId: string; token: string }>> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.push_token.findMany({
      where: { user_id: { in: userIds }, enabled: true },
      select: { user_id: true, token: true },
    });
    return rows.map((r) => ({ userId: r.user_id, token: r.token }));
  }

  async sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_API_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          logger.warn('notifications.expo-batch-failed', {
            status: res.status,
            batch_size: batch.length,
          });
        }
      } catch (err) {
        logger.warn('notifications.expo-fetch-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async sendPush(
    userIds: string[],
    notif: { title: string; body: string; data: Record<string, unknown> },
  ): Promise<number> {
    const tokens = await this.getPushTokens([...new Set(userIds)]);
    if (tokens.length === 0) return 0;

    await this.sendExpoPush(
      tokens.map((t) => ({
        to: t.token,
        title: notif.title,
        body: notif.body,
        data: notif.data,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      })),
    );
    return tokens.length;
  }

  async notifyWithPush(
    input: NewNotification | NewNotification[],
    push?: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<void> {
    const rows = (Array.isArray(input) ? input : [input]).filter((r) => r.userId);
    if (rows.length === 0) return;

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const tokens = await this.getPushTokens(userIds);
    const hasToken = new Set(tokens.map((t) => t.userId));

    await this.prisma.notification_log.createMany({
      data: rows.map((r) => ({
        id: randomUUID(),
        user_id: r.userId,
        type: r.type,
        title: r.title,
        body: r.body,
        data: (r.data as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        status: hasToken.has(r.userId) ? 'pending' : 'no-token',
        receipt_id: null,
        error: null,
        sent_at: null,
      })),
    });

    await Promise.all(
      userIds.map((uid) =>
        triggerEvent(`presence-user-${uid}`, 'notification:new', {}).catch(() => {}),
      ),
    );

    if (tokens.length === 0) return;

    const rowByUser = new Map(rows.map((r) => [r.userId, r]));
    const messages: ExpoPushMessage[] = tokens.map((t) => {
      const row = rowByUser.get(t.userId)!;
      return {
        to: t.token,
        title: push?.title ?? row.title,
        body: push?.body ?? row.body,
        data: (push?.data ?? row.data ?? {}) as Record<string, unknown>,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      };
    });
    await this.sendExpoPush(messages);
  }
}
