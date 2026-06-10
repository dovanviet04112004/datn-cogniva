/**
 * Job `library-pro-expiry-warn` (09:00 UTC = 16:00 VN daily) — Phase 5.
 * Port NGUYÊN semantics từ apps/web/src/jobs/library-pro-expiry-warn.ts:
 *
 *   1. PRO có pro_until_at trong [NOW+2d, NOW+4d] → push "sắp hết hạn 3 ngày"
 *      upsell renewal.
 *   2. Dedupe: skip user đã có notification_log type 'pro-expiry-warn' status
 *      'sent' trong 7 ngày (cron chạy 3 ngày liên tiếp cùng window + retry
 *      cùng ngày đều không gửi trùng).
 *   3. Token qua NotificationsService.getPushTokens; send loop giữ TẠI ĐÂY
 *      (như flashcard-due-reminder) vì cần TICKET từng message để phân
 *      sent/failed per-user + gom token DeviceNotRegistered.
 *
 * Message type local — KHÔNG dùng ExpoPushMessage của NotificationsService vì
 * type đó khoá priority 'high'; job này gửi priority 'normal' y job cũ.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const NOTIF_TYPE = 'pro-expiry-warn';
const EXPO_BATCH_SIZE = 100;
const DEDUPE_WINDOW_DAYS = 7;
const WARN_WINDOW_DAYS_MIN = 2;
const WARN_WINDOW_DAYS_MAX = 4;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { type: string; [k: string]: unknown };
  sound?: 'default';
  priority?: 'normal' | 'high';
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class LibraryProExpiryWarnJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(): Promise<Record<string, number>> {
    const now = new Date();
    const lo = new Date(now.getTime() + WARN_WINDOW_DAYS_MIN * 86400_000);
    const hi = new Date(now.getTime() + WARN_WINDOW_DAYS_MAX * 86400_000);

    // Step 1: candidates trong window
    const candidateRows = await this.prisma.user.findMany({
      where: { plan: 'PRO', pro_until_at: { not: null, gte: lo, lte: hi } },
      select: { id: true, name: true, pro_until_at: true },
    });
    const candidates = candidateRows.map((r) => ({
      id: r.id,
      name: r.name,
      proUntilAt: r.pro_until_at,
    }));

    logger.info(
      `PRO expiring in [${WARN_WINDOW_DAYS_MIN},${WARN_WINDOW_DAYS_MAX}]d: ${candidates.length}`,
    );

    if (candidates.length === 0) {
      return { candidates: 0, sent: 0, deduped: 0 };
    }

    // Step 2: dedupe — đã nhận warn trong 7 ngày?
    const userIds = candidates.map((c) => c.id);
    const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_DAYS * 86400_000);
    const recent = await this.prisma.notification_log.findMany({
      where: {
        user_id: { in: userIds },
        type: NOTIF_TYPE,
        created_at: { gte: cutoff },
        status: 'sent',
      },
      select: { user_id: true },
    });
    const recentSet = new Set(recent.map((r) => r.user_id));
    const eligibleIds = userIds.filter((id) => !recentSet.has(id));

    if (eligibleIds.length === 0) {
      return { candidates: candidates.length, sent: 0, deduped: candidates.length };
    }

    // Step 3: tokens (enabled, 1 user nhiều device) — qua NotificationsService.
    const tokens = await this.notifications.getPushTokens(eligibleIds);
    const targets = tokens.map((t) => {
      const c = candidates.find((x) => x.id === t.userId);
      return {
        ...t,
        userName: c?.name ?? null,
        proUntilAt: c?.proUntilAt ?? null,
      };
    });

    if (targets.length === 0) {
      return {
        candidates: candidates.length,
        sent: 0,
        deduped: candidates.length - eligibleIds.length,
      };
    }

    // Step 4: gửi push — giữ ticket từng message.
    const messages: ExpoPushMessage[] = targets.map((t) => {
      const daysLeft = t.proUntilAt
        ? Math.max(1, Math.ceil((new Date(t.proUntilAt).getTime() - now.getTime()) / 86400_000))
        : 3;
      return {
        to: t.token,
        title: '⏰ Cogniva PRO sắp hết hạn',
        body: `Còn ${daysLeft} ngày — gia hạn ngay để giữ unlimited import & premium access.`,
        data: { type: NOTIF_TYPE, daysLeft },
        sound: 'default',
        priority: 'normal',
        channelId: 'default',
      };
    });

    const tickets: Array<{ userId: string; token: string; ticket: ExpoPushTicket }> = [];
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
          logger.error('pro-warn.expo-batch-failed', {
            status: res.status,
            body_preview: text.slice(0, 500),
          });
          for (const t of batchTargets) {
            tickets.push({
              userId: t.userId,
              token: t.token,
              ticket: { status: 'error', message: `HTTP ${res.status}` },
            });
          }
          continue;
        }
        const json = (await res.json()) as { data: ExpoPushTicket[] };
        json.data.forEach((ticket, idx) => {
          const t = batchTargets[idx]!;
          tickets.push({ userId: t.userId, token: t.token, ticket });
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(t.token);
          }
        });
      } catch (err) {
        logger.error('pro-warn.fetch-throw', {
          error: err instanceof Error ? err.message : String(err),
        });
        for (const t of batchTargets) {
          tickets.push({
            userId: t.userId,
            token: t.token,
            ticket: { status: 'error', message: 'fetch threw' },
          });
        }
      }
    }

    // Step 5a: cleanup invalid tokens (idempotent — delete by token).
    if (invalidTokens.length > 0) {
      await this.prisma.push_token.deleteMany({ where: { token: { in: invalidTokens } } });
    }

    // Step 5b: notification_log — 1 row/user, 'sent' nếu BẤT KỲ device ok.
    const byUser = new Map<string, { ok: boolean; err: string | null; daysLeft: number }>();
    for (const t of tickets) {
      const cur = byUser.get(t.userId) ?? { ok: false, err: null, daysLeft: 0 };
      if (t.ticket.status === 'ok') cur.ok = true;
      else if (!cur.err) cur.err = t.ticket.message ?? 'unknown';
      const c = candidates.find((x) => x.id === t.userId);
      cur.daysLeft = c?.proUntilAt
        ? Math.max(1, Math.ceil((new Date(c.proUntilAt).getTime() - now.getTime()) / 86400_000))
        : 3;
      byUser.set(t.userId, cur);
    }
    const rows = Array.from(byUser.entries()).map(([userId, info]) => ({
      // id sinh app-side (Drizzle cũ $defaultFn cuid2 — DB không có default).
      id: randomUUID(),
      user_id: userId,
      type: NOTIF_TYPE,
      title: '⏰ Cogniva PRO sắp hết hạn',
      body: `Còn ${info.daysLeft} ngày — gia hạn ngay`,
      data: { type: NOTIF_TYPE, daysLeft: info.daysLeft } as Prisma.InputJsonValue,
      status: info.ok ? 'sent' : 'failed',
      error: info.ok ? null : info.err,
      sent_at: info.ok ? new Date() : null,
    }));
    if (rows.length > 0) {
      await this.prisma.notification_log.createMany({ data: rows });
    }

    const sent = tickets.filter((t) => t.ticket.status === 'ok').length;
    logger.info('pro-expiry-warn.done', {
      candidates: candidates.length,
      eligible: eligibleIds.length,
      sent,
      invalidated: invalidTokens.length,
    });

    return {
      candidates: candidates.length,
      eligible: eligibleIds.length,
      sent,
      invalidated: invalidTokens.length,
    };
  }
}
