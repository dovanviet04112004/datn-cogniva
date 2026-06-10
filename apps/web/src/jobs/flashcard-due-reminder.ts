/**
 * BullMQ job `flashcard-due-reminder` — daily push notification.
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 *
 * Stage 2 M7 — Mobile push delivery cho FSRS retention loop.
 *
 * Schedule: 13:00 UTC daily = 20:00 VN (giờ học buổi tối).
 *
 * Pipeline:
 *   1. Query users có ≥ 5 flashcards due (state != NEW AND due <= NOW) và chưa
 *      review trong 24h gần đây.
 *   2. Skip user đã nhận `flashcard-due` reminder trong 24h gần nhất (dedupe).
 *   3. Lookup push_token đang enabled cho mỗi user.
 *   4. Batch gửi qua Expo Push API (https://exp.host/--/api/v2/push/send) —
 *      max 100 token/batch (Expo limit).
 *   5. Insert notification_log row cho mỗi user (status sent/failed) + handle
 *      `DeviceNotRegistered` → xoá token.
 *
 * Tại sao cron daily thay vì per-user TZ:
 *   - Stage 2 simplification — TZ-aware notif (gửi 9am theo TZ user) cần
 *     thêm `user.timezone` field + cron mỗi giờ + check TZ match → phức tạp.
 *   - 20:00 VN cover được hầu hết user VN target market; user TZ khác (EU/US)
 *     có thể nhận giờ kỳ lạ — accept trade-off cho MVP.
 *   - Stage 3 sẽ thêm TZ-aware + user opt-in giờ ưa thích.
 *
 * Tại sao threshold 5 cards:
 *   - Tránh "spam" khi user chỉ có 1-2 thẻ due (chưa worth interrupt)
 *   - 5+ thẻ = đủ session ngắn 5-10 phút để worth reminder
 *
 * Expo Push API rate limit: 600 req/sec per IP, soft limit. Batch 100 tokens/req
 * → 6000 token/sec lý thuyết. Stage 2 < 100K MAU → 1 cron run đủ trong < 1 phút.
 *
 * Idempotency: dedupe step (24h `notification_log` "sent") đảm bảo chạy lại job
 * trong cùng cửa sổ 24h KHÔNG gửi lại notif cho user đã nhận → an toàn khi
 * BullMQ retry cả job. Lưu ý: nếu retry xảy ra GIỮA send (Expo OK) và insert
 * notification_log (chưa kịp ghi), lần chạy lại có thể gửi trùng cho user đó —
 * trade-off chấp nhận được (1 reminder thừa hiếm khi xảy ra, không phá dữ liệu).
 */
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';

import { db, flashcard, notificationLog, pushToken, user } from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const REMINDER_TYPE = 'flashcard-due';
const MIN_DUE_THRESHOLD = 5;
const DEDUPE_WINDOW_HOURS = 24;
const EXPO_BATCH_SIZE = 100;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { type: string; [k: string]: unknown };
  sound?: 'default';
  priority?: 'normal' | 'high';
  channelId?: string; // Android
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function flashcardDueReminder() {
  // Step 1: Query users có due cards ≥ threshold. Dùng raw SQL aggregate
  // để 1 round trip thay vì N+1.
  const candidates = await (async () => {
    const rows = await db
      .select({
        userId: flashcard.userId,
        dueCount: sql<number>`count(*)::int`,
        userName: user.name,
      })
      .from(flashcard)
      .innerJoin(user, eq(user.id, flashcard.userId))
      .where(
        and(
          lte(flashcard.due, new Date()),
          // state != 'NEW' → chỉ remind thẻ đã từng learn (NEW = chưa mở)
          sql`${flashcard.state} != 'NEW'`,
        ),
      )
      .groupBy(flashcard.userId, user.name)
      .having(sql`count(*) >= ${MIN_DUE_THRESHOLD}`);

    return rows;
  })();

  logger.info('flashcard-due-reminder.candidates', {
    count: candidates.length,
    threshold: MIN_DUE_THRESHOLD,
  });

  if (candidates.length === 0) {
    return { processed: 0, sent: 0, skipped: 0 };
  }

  // Step 2: Filter out users đã nhận reminder trong 24h (dedupe).
  const userIds = candidates.map((c) => c.userId);
  const dedupedUserIds = await (async () => {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
    const recent = await db
      .select({ userId: notificationLog.userId })
      .from(notificationLog)
      .where(
        and(
          inArray(notificationLog.userId, userIds),
          eq(notificationLog.type, REMINDER_TYPE),
          gte(notificationLog.createdAt, cutoff),
          eq(notificationLog.status, 'sent'),
        ),
      );
    const recentSet = new Set(recent.map((r) => r.userId));
    return userIds.filter((id) => !recentSet.has(id));
  })();

  logger.info('flashcard-due-reminder.after-dedupe', { eligible: dedupedUserIds.length });

  if (dedupedUserIds.length === 0) {
    return { processed: candidates.length, sent: 0, skipped: candidates.length };
  }

  // Step 3: Lookup tokens. 1 user có thể có nhiều device → 1 message / token.
  const targets = await (async () => {
    const tokens = await db
      .select({
        userId: pushToken.userId,
        token: pushToken.token,
      })
      .from(pushToken)
      .where(
        and(
          inArray(pushToken.userId, dedupedUserIds),
          eq(pushToken.enabled, true),
          isNotNull(pushToken.token),
        ),
      );

    // Map userId → dueCount để xây body message
    const dueByUser = new Map(candidates.map((c) => [c.userId, c.dueCount]));
    const nameByUser = new Map(candidates.map((c) => [c.userId, c.userName]));

    return tokens.map((t) => ({
      userId: t.userId,
      token: t.token,
      dueCount: dueByUser.get(t.userId) ?? 0,
      userName: nameByUser.get(t.userId) ?? null,
    }));
  })();

  if (targets.length === 0) {
    logger.warn('flashcard-due-reminder.no-tokens');
    return { processed: candidates.length, sent: 0, skipped: dedupedUserIds.length };
  }

  // Step 4: Batch gửi qua Expo Push API. Mỗi batch ≤ 100 message.
  // 1 khối cho toàn bộ HTTP work, log result tổng.
  const sendResult = await (async () => {
    const messages: ExpoPushMessage[] = targets.map((t) => ({
      to: t.token,
      title: 'Đến giờ ôn tập rồi!',
      body: `Bạn có ${t.dueCount} thẻ đang chờ — bật app lên review nhé.`,
      data: { type: REMINDER_TYPE, dueCount: t.dueCount },
      sound: 'default',
      priority: 'high',
      channelId: 'default', // Android
    }));

    const tickets: Array<{ token: string; userId: string; ticket: ExpoPushTicket }> = [];
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
          // 400 = batch malformed; 429 = rate limit; 5xx = Expo issue
          const text = await res.text().catch(() => '');
          logger.error('expo-push.batch-failed', {
            status: res.status,
            body_preview: text.slice(0, 500),
            batch_size: batch.length,
          });
          // Mark toàn bộ batch failed
          for (const t of batchTargets) {
            tickets.push({
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
          tickets.push({ token: target.token, userId: target.userId, ticket });
          // DeviceNotRegistered → token đã invalid, mark để xoá ở step sau
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
          tickets.push({
            token: t.token,
            userId: t.userId,
            ticket: { status: 'error', message: 'fetch threw' },
          });
        }
      }
    }

    return { tickets, invalidTokens };
  })();

  // Step 5a: Cleanup invalid tokens (DeviceNotRegistered = user gỡ app /
  // disable notif → Expo revoke token vĩnh viễn → xoá khỏi DB ngay).
  if (sendResult.invalidTokens.length > 0) {
    await (async () => {
      await db
        .delete(pushToken)
        .where(inArray(pushToken.token, sendResult.invalidTokens));
      logger.info('expo-push.cleanup-invalid', {
        count: sendResult.invalidTokens.length,
      });
    })();
  }

  // Step 5b: Insert notification_log rows — dedupe key (userId, type, createdAt).
  // 1 user nhiều device → 1 row "sent" nếu BẤT KỲ device thành công.
  await (async () => {
    const byUser = new Map<
      string,
      { anySuccess: boolean; firstError: string | null; receipts: string[]; dueCount: number }
    >();

    for (const t of sendResult.tickets) {
      const dueCount = targets.find((tg) => tg.userId === t.userId)?.dueCount ?? 0;
      const entry = byUser.get(t.userId) ?? {
        anySuccess: false,
        firstError: null,
        receipts: [],
        dueCount,
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
      userId,
      type: REMINDER_TYPE,
      title: 'Đến giờ ôn tập rồi!',
      body: `Bạn có ${info.dueCount} thẻ đang chờ — bật app lên review nhé.`,
      data: { type: REMINDER_TYPE, dueCount: info.dueCount, receipts: info.receipts },
      status: info.anySuccess ? 'sent' : 'failed',
      receiptId: info.receipts[0] ?? null,
      error: info.anySuccess ? null : info.firstError,
      sentAt: info.anySuccess ? new Date() : null,
    }));

    if (rows.length > 0) {
      await db.insert(notificationLog).values(rows);
    }
  })();

  const sent = sendResult.tickets.filter((t) => t.ticket.status === 'ok').length;
  const failed = sendResult.tickets.length - sent;

  logger.info('flashcard-due-reminder.done', {
    candidates: candidates.length,
    eligible_after_dedupe: dedupedUserIds.length,
    tokens: targets.length,
    sent,
    failed,
    invalidated: sendResult.invalidTokens.length,
  });

  return {
    processed: candidates.length,
    eligible: dedupedUserIds.length,
    sent,
    failed,
    invalidated: sendResult.invalidTokens.length,
  };
}
