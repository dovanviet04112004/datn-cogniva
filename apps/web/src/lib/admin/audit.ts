/**
 * Audit wrapper — bao mọi mutation admin trong 1 hàm, tự log row vào
 * admin_audit_log table. Bắt buộc dùng cho mọi API handler /api/admin/*
 * thực hiện write operation (suspend, delete, refund, change plan, …).
 *
 * Cách dùng:
 *   await withAudit(
 *     { admin, ip, userAgent },
 *     'user.suspend',
 *     { type: 'user', id: targetUserId },
 *     async () => {
 *       const before = await db.select()...
 *       await db.update(user).set({ suspendedAt: new Date() })...
 *       const after = await db.select()...
 *       return { before, after, reason: 'spam', result: { ok: true } };
 *     },
 *   );
 *
 * Nếu fn throw, audit log KHÔNG ghi (mutation rollback semantic). Caller
 * tự bao try/catch để xử lý error response.
 */
import { adminAuditLog, db } from '@cogniva/db';

import type { AdminContext } from './guard';

export type AuditRequestContext = {
  admin: AdminContext;
  ip: string | null;
  userAgent: string | null;
};

export type AuditFnResult<T> = {
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
  result: T;
};

export async function withAudit<T>(
  ctx: AuditRequestContext,
  action: string,
  target: { type: string; id: string },
  fn: () => Promise<AuditFnResult<T>>,
): Promise<T> {
  const { before, after, reason, metadata, result } = await fn();
  // Insert sau khi mutation thành công — nếu fn throw thì await trên không
  // chạy được tới đây, audit không ghi.
  await db.insert(adminAuditLog).values({
    adminId: ctx.admin.userId,
    action,
    targetType: target.type,
    targetId: target.id,
    payload: {
      before: before ?? null,
      after: after ?? null,
      reason: reason ?? null,
      metadata: metadata ?? null,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return result;
}

/**
 * Helper extract IP + UA từ request headers — dùng đầu mỗi handler để
 * build AuditRequestContext gọn.
 */
export function getAuditMeta(
  headers: Headers,
): { ip: string | null; userAgent: string | null } {
  // Vercel forward IP qua x-forwarded-for (chain: client, proxy, …)
  // Lấy IP đầu — đó là client thật.
  const fwd = headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : headers.get('x-real-ip');
  return {
    ip: ip || null,
    userAgent: headers.get('user-agent'),
  };
}
