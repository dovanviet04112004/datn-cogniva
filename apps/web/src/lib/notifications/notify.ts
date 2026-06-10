/**
 * createNotification — insert notificationLog + bắn realtime để chuông cập nhật
 * NGAY (không đợi poll 60s).
 *
 * Mỗi user nhận event `notification:new` trên kênh `presence-user-{userId}`
 * (đã được /api/realtime/auth cho phép chính chủ sub). NotificationBell nghe
 * event này → refetch tức thì.
 *
 * Dùng ở: booking confirm/complete/cancel, DM, admin actions…
 */
import { db, notificationLog } from '@cogniva/db';

import { triggerEvent } from '@/lib/realtime-server';

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function createNotification(
  input: NewNotification | NewNotification[],
): Promise<void> {
  const rows = (Array.isArray(input) ? input : [input]).filter((r) => r.userId);
  if (rows.length === 0) return;

  await db.insert(notificationLog).values(
    rows.map((r) => ({
      userId: r.userId,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data ?? null,
      status: 'pending' as const,
    })),
  );

  // Ping realtime mỗi user (dedupe) — chuông sẽ refetch.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  await Promise.all(
    userIds.map((uid) =>
      triggerEvent(`presence-user-${uid}`, 'notification:new', {}).catch(() => {}),
    ),
  );
}
