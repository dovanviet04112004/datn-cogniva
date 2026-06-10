/**
 * NotificationsService — insert notification_log + realtime ping + Expo push.
 *
 * NGUỒN GỐC:
 *   - createNotification: apps/web/src/lib/notifications/notify.ts — web CÒN BẢN
 *     RIÊNG tới Wave 6 (tutoring booking/DM vẫn gọi bản web), đừng xóa bên đó.
 *   - Expo push (getPushTokens / sendExpoPush): web KHÔNG có helper push riêng —
 *     logic fetch exp.host được inline ở apps/web/src/lib/group/mention-notify.ts
 *     và apps/web/src/jobs/flashcard-due-reminder.ts. Ở đây gom thành method
 *     dùng chung, giữ nguyên semantics (batch 100, fail-soft chỉ log warn).
 *   - notifyWithPush: combined flow theo mention-notify (status 'pending'/'no-token'
 *     tùy user có token, push 1 message/token).
 *
 * Xử lý ticket/receipt + cleanup DeviceNotRegistered KHÔNG port vào đây — đó là
 * việc của BullMQ job flashcard-due-reminder (vẫn chạy ở worker apps/web).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo limit 100 message/request. */
const EXPO_BATCH_SIZE = 100;

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Shape message Expo Push API — như ExpoMessage ở mention-notify.ts. */
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

  /**
   * Insert notificationLog + bắn realtime để chuông cập nhật NGAY (không đợi
   * poll 60s). Mỗi user nhận `notification:new` trên `presence-user-{userId}`
   * → NotificationBell nghe event này refetch tức thì.
   *
   * KHÔNG gửi push — dùng notifyWithPush nếu cần cả hai.
   */
  async createNotification(input: NewNotification | NewNotification[]): Promise<void> {
    const rows = (Array.isArray(input) ? input : [input]).filter((r) => r.userId);
    if (rows.length === 0) return;

    await this.prisma.notification_log.createMany({
      data: rows.map((r) => ({
        // id sinh app-side (Drizzle cũ $defaultFn cuid2 — DB không có default).
        id: randomUUID(),
        user_id: r.userId,
        type: r.type,
        title: r.title,
        body: r.body,
        // Route cũ `r.data ?? null` → jsonb NULL = Prisma.DbNull.
        data: (r.data as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        status: 'pending',
      })),
    });

    // Ping realtime mỗi user (dedupe) — chuông sẽ refetch.
    const userIds = [...new Set(rows.map((r) => r.userId))];
    await Promise.all(
      userIds.map((uid) =>
        triggerEvent(`presence-user-${uid}`, 'notification:new', {}).catch(() => {}),
      ),
    );
  }

  /**
   * Token Expo enabled của các user — caller dùng để biết user nào nhận được
   * push (mention-notify cần phân biệt status 'pending' vs 'no-token').
   * Web filter thêm isNotNull(token) nhưng cột NOT NULL nên bỏ (vô nghĩa).
   */
  async getPushTokens(userIds: string[]): Promise<Array<{ userId: string; token: string }>> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.push_token.findMany({
      where: { user_id: { in: userIds }, enabled: true },
      select: { user_id: true, token: true },
    });
    return rows.map((r) => ({ userId: r.user_id, token: r.token }));
  }

  /**
   * Batch gửi qua Expo Push API — fail-soft y mention-notify: HTTP !ok hoặc
   * fetch throw chỉ log warn, KHÔNG throw lên caller (push là best-effort).
   */
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

  /**
   * Push cùng 1 nội dung tới mọi device của các user (1 message/token — user
   * nhiều device nhận đủ). KHÔNG ghi notification_log — dùng notifyWithPush
   * nếu cần log + chuông.
   *
   * @returns số token đã gửi tới (0 = không user nào có device đăng ký).
   */
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
        channelId: 'default', // Android notification channel
      })),
    );
    return tokens.length;
  }

  /**
   * Log + chuông + push gộp — semantics theo mention-notify.ts:
   *   - notification_log status 'pending' nếu user có token, 'no-token' nếu không
   *     (khác createNotification luôn 'pending').
   *   - realtime ping cho MỌI user (kể cả no-token — in-app notif vẫn hiện).
   *   - Push 1 message/token, nội dung lấy từ row của chính user đó.
   *
   * @param push  Override nội dung push (mention-notify dùng title/body NGẮN HƠN
   *              bản log: "X đã mention bạn" vs "X đã mention bạn trong #ch").
   *              Bỏ trống → dùng title/body/data của notification.
   *
   * Fail-soft: push không throw; DB insert throw như notify.ts cũ — caller muốn
   * fire-and-forget thì tự .catch (như fireMentionEvents bên web).
   */
  async notifyWithPush(
    input: NewNotification | NewNotification[],
    push?: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<void> {
    const rows = (Array.isArray(input) ? input : [input]).filter((r) => r.userId);
    if (rows.length === 0) return;

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const tokens = await this.getPushTokens(userIds);
    const hasToken = new Set(tokens.map((t) => t.userId));

    // Insert log cho mọi user (kể cả không có token → in-app notif).
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

    // Input trùng userId (hiếm) → message lấy row CUỐI của user đó.
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
