/**
 * Audit log helper — wrapper INSERT immutable.
 *
 * Plan v2 §10.8 + §15.1 W9-10 — compliance requirement (FERPA, SOC2, GDPR).
 *
 * Pattern dùng:
 *
 *   import { writeAudit } from '@/lib/observability/audit';
 *
 *   await writeAudit({
 *     action: 'auth.login',
 *     result: 'success',
 *     actorId: session.user.id,
 *     resourceType: 'user',
 *     resourceId: session.user.id,
 *     metadata: { method: 'email' },
 *   });
 *
 * Fail-open: nếu DB insert fail, log warning nhưng KHÔNG throw — caller flow
 * không bị block bởi audit issue. Audit miss được monitor riêng qua Sentry.
 *
 * Action naming convention: `{domain}.{verb}[.{outcome}]`
 *   - auth.login, auth.logout, auth.signup
 *   - gdpr.export.requested, gdpr.export.completed, gdpr.delete.requested
 *   - admin.role.changed, admin.user.banned
 *   - pii.accessed (vd teacher xem student record)
 *   - billing.subscription.upgraded
 *
 * actorType:
 *   - 'user': end-user action
 *   - 'admin': Cogniva staff (CSM, support)
 *   - 'system': background job, cron, BullMQ job
 *   - 'webhook': external (LiveKit, Stripe)
 */
import { db, auditLog, type NewAuditLog } from '@cogniva/db';

import { logger } from './logger';

export type AuditEvent = {
  action: string;
  result: 'success' | 'denied' | 'error';
  /** ID của actor — null nếu anonymous (vd failed login chưa biết user). */
  actorId?: string | null;
  actorType?: 'user' | 'admin' | 'system' | 'webhook';
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Write audit log entry. Fail-open.
 *
 * @param event - Audit event metadata.
 */
export async function writeAudit(event: AuditEvent): Promise<void> {
  // Trim user agent để tránh oversized rows (UA strings có thể > 500 char)
  const userAgent = event.userAgent ? event.userAgent.slice(0, 500) : null;

  const row: NewAuditLog = {
    actorId: event.actorId ?? null,
    actorType: event.actorType ?? 'user',
    action: event.action,
    result: event.result,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent,
    traceId: event.traceId ?? null,
    metadata: event.metadata ?? null,
  };

  try {
    await db.insert(auditLog).values(row);
  } catch (err) {
    logger.warn('audit.write_failed', {
      action: event.action,
      result: event.result,
      actor_id: event.actorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Extract request context (IP + UA + trace) từ Request — convenience cho
 * route handler.
 */
export function extractRequestContext(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
  traceId: string | null;
} {
  // X-Forwarded-For từ Vercel / Cloudflare proxy. Lấy IP đầu tiên (real client).
  const xff = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfIp = request.headers.get('cf-connecting-ip');
  const ipAddress =
    cfIp || (xff ? xff.split(',')[0]!.trim() : null) || realIp || null;

  return {
    ipAddress,
    userAgent: request.headers.get('user-agent'),
    traceId: request.headers.get('x-trace-id'),
  };
}

/**
 * Batch write — multiple events trong cùng tx (vd login success + session
 * created cùng lúc). Fail-open chung.
 */
export async function writeAuditBatch(events: AuditEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await db.insert(auditLog).values(
      events.map(
        (e): NewAuditLog => ({
          actorId: e.actorId ?? null,
          actorType: e.actorType ?? 'user',
          action: e.action,
          result: e.result,
          resourceType: e.resourceType ?? null,
          resourceId: e.resourceId ?? null,
          ipAddress: e.ipAddress ?? null,
          userAgent: e.userAgent ? e.userAgent.slice(0, 500) : null,
          traceId: e.traceId ?? null,
          metadata: e.metadata ?? null,
        }),
      ),
    );
  } catch (err) {
    logger.warn('audit.batch_write_failed', {
      count: events.length,
      first_action: events[0]?.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
