/**
 * library-pro-expiry-warn — Phase 5 (2026-05-27).
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 * Cron daily 09:00 UTC (16:00 VN — mid-afternoon, attention sweet spot).
 *
 * Scan user.plan='PRO' với pro_until_at trong khoảng [NOW+2d, NOW+4d]:
 *   → gửi push warn "PRO sắp hết hạn 3 ngày" để upsell renewal.
 *
 * Dedupe: skip user đã nhận notif type 'pro-expiry-warn' trong 7 ngày qua
 *   (avoid spam khi cron chạy 3 ngày liên tiếp với cùng user trong window).
 *   → Đây cũng là lớp idempotency: nếu cả job bị retry trong cùng ngày,
 *     những user đã có notification_log status='sent' sẽ bị dedupe, không
 *     gửi trùng. Tokens DeviceNotRegistered cleanup là idempotent (delete by token).
 *
 * Pipeline copy từ library-saved-search-notify.ts:
 *   - Expo Push API batch 100/req
 *   - Cleanup DeviceNotRegistered
 *   - Insert notification_log (status sent/failed)
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';

import { db, notificationLog, pushToken, user } from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

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

export async function libraryProExpiryWarn() {
  const now = new Date();
  const lo = new Date(now.getTime() + WARN_WINDOW_DAYS_MIN * 86400_000);
  const hi = new Date(now.getTime() + WARN_WINDOW_DAYS_MAX * 86400_000);

  // Step 1: candidates trong window
  const candidates = await db
    .select({
      id: user.id,
      name: user.name,
      proUntilAt: user.proUntilAt,
    })
    .from(user)
    .where(
      and(
        eq(user.plan, 'PRO'),
        isNotNull(user.proUntilAt),
        gte(user.proUntilAt, lo),
        lte(user.proUntilAt, hi),
      ),
    );

  logger.info(`PRO expiring in [${WARN_WINDOW_DAYS_MIN},${WARN_WINDOW_DAYS_MAX}]d: ${candidates.length}`);

  if (candidates.length === 0) {
    return { candidates: 0, sent: 0, deduped: 0 };
  }

  // Step 2: dedupe — đã nhận warn trong 7 ngày?
  const userIds = candidates.map((c) => c.id);
  const eligibleIds = await (async () => {
    const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_DAYS * 86400_000);
    const recent = await db
      .select({ userId: notificationLog.userId })
      .from(notificationLog)
      .where(
        and(
          inArray(notificationLog.userId, userIds),
          eq(notificationLog.type, NOTIF_TYPE),
          gte(notificationLog.createdAt, cutoff),
          eq(notificationLog.status, 'sent'),
        ),
      );
    const recentSet = new Set(recent.map((r) => r.userId));
    return userIds.filter((id) => !recentSet.has(id));
  })();

  if (eligibleIds.length === 0) {
    return { candidates: candidates.length, sent: 0, deduped: candidates.length };
  }

  // Step 3: tokens
  const targets = await (async () => {
    const tokens = await db
      .select({ userId: pushToken.userId, token: pushToken.token })
      .from(pushToken)
      .where(
        and(
          inArray(pushToken.userId, eligibleIds),
          eq(pushToken.enabled, true),
          isNotNull(pushToken.token),
        ),
      );
    return tokens.map((t) => {
      const c = candidates.find((x) => x.id === t.userId);
      return {
        ...t,
        userName: c?.name ?? null,
        proUntilAt: c?.proUntilAt ?? null,
      };
    });
  })();

  if (targets.length === 0) {
    return { candidates: candidates.length, sent: 0, deduped: candidates.length - eligibleIds.length };
  }

  // Step 4: gửi push
  const sendResult = await (async () => {
    const messages: ExpoPushMessage[] = targets.map((t) => {
      // proUntilAt giữ nguyên Date (không còn step boundary serialize), cast lại an toàn.
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

    return { tickets, invalidTokens };
  })();

  // Step 5a: cleanup invalid tokens
  if (sendResult.invalidTokens.length > 0) {
    await db
      .delete(pushToken)
      .where(inArray(pushToken.token, sendResult.invalidTokens));
  }

  // Step 5b: notification_log
  await (async () => {
    const byUser = new Map<string, { ok: boolean; err: string | null; daysLeft: number }>();
    for (const t of sendResult.tickets) {
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
      userId,
      type: NOTIF_TYPE,
      title: '⏰ Cogniva PRO sắp hết hạn',
      body: `Còn ${info.daysLeft} ngày — gia hạn ngay`,
      data: { type: NOTIF_TYPE, daysLeft: info.daysLeft },
      status: info.ok ? 'sent' : 'failed',
      error: info.ok ? null : info.err,
      sentAt: info.ok ? new Date() : null,
    }));
    if (rows.length > 0) await db.insert(notificationLog).values(rows);
  })();

  const sent = sendResult.tickets.filter((t) => t.ticket.status === 'ok').length;
  logger.info('pro-expiry-warn.done', {
    candidates: candidates.length,
    eligible: eligibleIds.length,
    sent,
    invalidated: sendResult.invalidTokens.length,
  });

  return {
    candidates: candidates.length,
    eligible: eligibleIds.length,
    sent,
    invalidated: sendResult.invalidTokens.length,
  };
}
