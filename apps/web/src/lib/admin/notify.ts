/**
 * Admin notification helpers — in-app notifications (notification_log).
 *
 * Phase 2 V1 chỉ insert vào notification_log với status='pending'. Mobile push
 * worker (Phase 7 V2 — chưa wire production) sẽ pick up và gọi Expo Push API.
 * Web client poll notification_log để hiện trong notification panel.
 *
 * Email integration (Resend) deferred — khi Phase 2.1 wire xong sẽ thêm
 * `notifyByEmail` để admin chọn channel.
 *
 * Fire-and-forget pattern: caller `void notifyXxx().catch(log)` — không await
 * để không block HTTP response.
 */
import { eq } from 'drizzle-orm';

import { db, notificationLog, studyGroupMember } from '@cogniva/db';

/**
 * Insert 1 notification cho mỗi member của group khi admin suspend/unsuspend/delete.
 *
 * Type field: 'admin-group-suspend' | 'admin-group-unsuspend' | 'admin-group-delete'
 * → mobile client switch để deep link tới /groups (hoặc home nếu deleted).
 */
export async function notifyGroupSuspend(opts: {
  groupId: string;
  groupName: string;
  memberIds: string[];
  reason: string;
  /** Loại action — 'suspend' | 'unsuspend' | 'delete'. Default suspend. */
  kind?: 'suspend' | 'unsuspend' | 'delete';
}): Promise<void> {
  const { groupId, groupName, memberIds, reason, kind = 'suspend' } = opts;
  if (memberIds.length === 0) return;

  const cfg = {
    suspend: {
      type: 'admin-group-suspend',
      title: `Group "${groupName}" đã bị tạm khóa`,
      bodyPrefix: 'Lý do',
    },
    unsuspend: {
      type: 'admin-group-unsuspend',
      title: `Group "${groupName}" đã được khôi phục`,
      bodyPrefix: 'Ghi chú',
    },
    delete: {
      type: 'admin-group-delete',
      title: `Group "${groupName}" đã bị xóa vĩnh viễn`,
      bodyPrefix: 'Lý do',
    },
  }[kind];

  // Lookup member nếu caller không truyền — defensive. Skip nếu đã pass.
  const ids =
    memberIds.length > 0
      ? memberIds
      : (
          await db
            .select({ userId: studyGroupMember.userId })
            .from(studyGroupMember)
            .where(eq(studyGroupMember.groupId, groupId))
        ).map((m) => m.userId);

  if (ids.length === 0) return;

  await db.insert(notificationLog).values(
    ids.map((userId) => ({
      userId,
      type: cfg.type,
      title: cfg.title,
      body: `${cfg.bodyPrefix}: ${reason}`,
      data: { groupId, groupName, kind, reason },
      status: 'pending',
    })),
  );
}

/**
 * Insert warning notification cho 1 user khi report resolution=warn.
 *
 * Dùng cho cả targetType='user' (warn user trực tiếp) và 'message' (warn author
 * của message).
 */
export async function notifyWarnUser(opts: {
  userId: string;
  reason: string;
  /** Context — vd report ID hoặc targetType/Id để mobile deep link. */
  context?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(notificationLog).values({
    userId: opts.userId,
    type: 'admin-warn',
    title: 'Cảnh báo từ ban quản trị',
    body: opts.reason,
    data: { ...opts.context, reason: opts.reason },
    status: 'pending',
  });
}
