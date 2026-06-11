import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';
import {
  NotificationsService,
  type ExpoPushMessage,
} from '../../notifications/notifications.service';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const REMINDER_TYPE = 'flashcard-due';
const MIN_DUE_THRESHOLD = 5;
const DEDUPE_WINDOW_HOURS = 24;
const EXPO_BATCH_SIZE = 100;

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class FlashcardDueReminderJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(): Promise<Record<string, number>> {
    const candidates = await this.prisma.$queryRaw<
      Array<{ userId: string; dueCount: number; userName: string | null }>
    >(Prisma.sql`
      SELECT f."user_id" AS "userId", count(*)::int AS "dueCount", u."name" AS "userName"
      FROM "flashcard" f
      INNER JOIN "user" u ON u."id" = f."user_id"
      WHERE f."due" <= ${new Date()}
        AND f."state" != 'NEW'
      GROUP BY f."user_id", u."name"
      HAVING count(*) >= ${MIN_DUE_THRESHOLD}
    `);

    logger.info('flashcard-due-reminder.candidates', {
      count: candidates.length,
      threshold: MIN_DUE_THRESHOLD,
    });

    if (candidates.length === 0) {
      return { processed: 0, sent: 0, skipped: 0 };
    }

    const userIds = candidates.map((c) => c.userId);
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
    const recent = await this.prisma.notification_log.findMany({
      where: {
        user_id: { in: userIds },
        type: REMINDER_TYPE,
        created_at: { gte: cutoff },
        status: 'sent',
      },
      select: { user_id: true },
    });
    const recentSet = new Set(recent.map((r) => r.user_id));
    const dedupedUserIds = userIds.filter((id) => !recentSet.has(id));

    logger.info('flashcard-due-reminder.after-dedupe', { eligible: dedupedUserIds.length });

    if (dedupedUserIds.length === 0) {
      return { processed: candidates.length, sent: 0, skipped: candidates.length };
    }

    const tokens = await this.notifications.getPushTokens(dedupedUserIds);
    const dueByUser = new Map(candidates.map((c) => [c.userId, c.dueCount]));
    const targets = tokens.map((t) => ({
      userId: t.userId,
      token: t.token,
      dueCount: dueByUser.get(t.userId) ?? 0,
    }));

    if (targets.length === 0) {
      logger.warn('flashcard-due-reminder.no-tokens');
      return { processed: candidates.length, sent: 0, skipped: dedupedUserIds.length };
    }

    const messages: ExpoPushMessage[] = targets.map((t) => ({
      to: t.token,
      title: 'Đến giờ ôn tập rồi!',
      body: `Bạn có ${t.dueCount} thẻ đang chờ — bật app lên review nhé.`,
      data: { type: REMINDER_TYPE, dueCount: t.dueCount },
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }));

    const ticketResults: Array<{ token: string; userId: string; ticket: ExpoPushTicket }> = [];
    const invalidTokens: string[] = [];

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const batchTargets = targets.slice(i, i + EXPO_BATCH_SIZE);

      try {
        const res = await fetch(EXPO_PUSH_API_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'accept-encoding': 'gzip, deflate',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logger.error('expo-push.batch-failed', {
            status: res.status,
            body_preview: text.slice(0, 500),
            batch_size: batch.length,
          });
          for (const t of batchTargets) {
            ticketResults.push({
              token: t.token,
              userId: t.userId,
              ticket: { status: 'error', message: `HTTP ${res.status}` },
            });
          }
          continue;
        }

        const json = (await res.json()) as { data: ExpoPushTicket[] };
        json.data.forEach((ticket, idx) => {
          const target = batchTargets[idx]!;
          ticketResults.push({ token: target.token, userId: target.userId, ticket });
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(target.token);
          }
        });
      } catch (err) {
        logger.error('expo-push.fetch-throw', {
          error: err instanceof Error ? err.message : String(err),
          batch_size: batch.length,
        });
        for (const t of batchTargets) {
          ticketResults.push({
            token: t.token,
            userId: t.userId,
            ticket: { status: 'error', message: 'fetch threw' },
          });
        }
      }
    }

    if (invalidTokens.length > 0) {
      await this.prisma.push_token.deleteMany({ where: { token: { in: invalidTokens } } });
      logger.info('expo-push.cleanup-invalid', { count: invalidTokens.length });
    }

    const byUser = new Map<
      string,
      { anySuccess: boolean; firstError: string | null; receipts: string[]; dueCount: number }
    >();
    for (const t of ticketResults) {
      const entry = byUser.get(t.userId) ?? {
        anySuccess: false,
        firstError: null,
        receipts: [],
        dueCount: dueByUser.get(t.userId) ?? 0,
      };
      if (t.ticket.status === 'ok') {
        entry.anySuccess = true;
        if (t.ticket.id) entry.receipts.push(t.ticket.id);
      } else if (!entry.firstError) {
        entry.firstError = t.ticket.message ?? t.ticket.details?.error ?? 'unknown';
      }
      byUser.set(t.userId, entry);
    }

    const rows = Array.from(byUser.entries()).map(([userId, info]) => ({
      id: randomUUID(),
      user_id: userId,
      type: REMINDER_TYPE,
      title: 'Đến giờ ôn tập rồi!',
      body: `Bạn có ${info.dueCount} thẻ đang chờ — bật app lên review nhé.`,
      data: {
        type: REMINDER_TYPE,
        dueCount: info.dueCount,
        receipts: info.receipts,
      } as Prisma.InputJsonValue,
      status: info.anySuccess ? 'sent' : 'failed',
      receipt_id: info.receipts[0] ?? null,
      error: info.anySuccess ? null : info.firstError,
      sent_at: info.anySuccess ? new Date() : null,
    }));
    if (rows.length > 0) {
      await this.prisma.notification_log.createMany({ data: rows });
    }

    const sent = ticketResults.filter((t) => t.ticket.status === 'ok').length;
    const failed = ticketResults.length - sent;

    logger.info('flashcard-due-reminder.done', {
      candidates: candidates.length,
      eligible_after_dedupe: dedupedUserIds.length,
      tokens: targets.length,
      sent,
      failed,
      invalidated: invalidTokens.length,
    });

    return {
      processed: candidates.length,
      eligible: dedupedUserIds.length,
      sent,
      failed,
      invalidated: invalidTokens.length,
    };
  }
}
