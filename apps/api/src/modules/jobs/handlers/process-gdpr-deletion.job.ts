/**
 * Job `process-gdpr-deletion` ('0 3 * * *' UTC daily, off-peak) — Plan v2 §5.9.
 * Port NGUYÊN semantics từ apps/web/src/jobs/process-gdpr-deletion.ts:
 * deletion_request PENDING đã hết grace (scheduled_for <= NOW) batch 50 →
 * claim CAS PENDING→PROCESSING (0 row = đã CANCELLED/xử lý → skip) → audit
 * processing → R2 cleanup STUB (Stage 2 mới implement) → DELETE user (cascade
 * FK wipe toàn bộ data) → COMPLETED + audit completed. Lỗi → FAILED +
 * error_message + audit error; manual retry qua admin.
 *
 * Idempotent nhờ CAS claim: whole-job chạy lại không DELETE lại request đã
 * xử lý (status đã rời PENDING).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';

type AuditEvent = {
  action: string;
  result: 'success' | 'denied' | 'error';
  actorId?: string | null;
  actorType?: 'user' | 'admin' | 'system' | 'webhook';
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ProcessGdprDeletionJob {
  constructor(private readonly prisma: PrismaService) {}

  /** Fail-open audit insert — port writeAudit web (lib/observability/audit.ts). */
  private async writeAudit(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          id: randomUUID(),
          actor_id: event.actorId ?? null,
          actor_type: event.actorType ?? 'user',
          action: event.action,
          result: event.result,
          resource_type: event.resourceType ?? null,
          resource_id: event.resourceId ?? null,
          metadata: (event.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        },
      });
    } catch (err) {
      logger.warn('audit.write_failed', {
        action: event.action,
        result: event.result,
        actor_id: event.actorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async run(): Promise<{ processed: number; succeeded?: number; failed?: number }> {
    const pendingDue = await this.prisma.deletion_request.findMany({
      where: { status: 'PENDING', scheduled_for: { lte: new Date() } },
      take: 50,
    });

    if (pendingDue.length === 0) {
      logger.info('gdpr.delete.no_due');
      return { processed: 0 };
    }

    logger.info('gdpr.delete.processing_batch', { count: pendingDue.length });

    let succeeded = 0;
    let failed = 0;

    for (const req of pendingDue) {
      try {
        // CAS claim — chỉ update nếu vẫn PENDING; 0 row → request đã được
        // CANCELLED/xử lý nơi khác. Bản web skip path vẫn tính succeeded.
        const updated = await this.prisma.deletion_request.updateMany({
          where: { id: req.id, status: 'PENDING' },
          data: { status: 'PROCESSING' },
        });
        if (updated.count === 0) {
          logger.warn('gdpr.delete.skip', { requestId: req.id, reason: 'đã CANCELLED hoặc xử lý' });
          succeeded++;
          continue;
        }

        await this.writeAudit({
          actorType: 'system',
          action: 'gdpr.delete.processing',
          result: 'success',
          actorId: null,
          resourceType: 'user',
          resourceId: req.user_id,
          metadata: { requestId: req.id },
        });

        // R2 cleanup prefix {userId}/ — Stage 1 stub như web, Stage 2 mới
        // implement listObjects + deleteObjects.
        logger.warn('gdpr.delete.r2_cleanup_stub', { userId: req.user_id });

        // DELETE user → cascade FK xoá toàn bộ data. deleteMany = no-throw
        // khi user đã biến mất (khớp Drizzle delete cũ).
        await this.prisma.user.deleteMany({ where: { id: req.user_id } });

        await this.prisma.deletion_request.updateMany({
          where: { id: req.id },
          data: { status: 'COMPLETED', completed_at: new Date() },
        });

        const scheduledTime = new Date(req.scheduled_for).getTime();
        const requestedTime = new Date(req.requested_at).getTime();
        await this.writeAudit({
          actorType: 'system',
          action: 'gdpr.delete.completed',
          result: 'success',
          actorId: null, // user đã không tồn tại
          resourceType: 'user',
          resourceId: req.user_id,
          metadata: {
            requestId: req.id,
            reason: req.reason,
            graceDays: Math.round((scheduledTime - requestedTime) / (1000 * 60 * 60 * 24)),
          },
        });
        succeeded++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('gdpr.delete.failed', { requestId: req.id, error: message });

        // Mark FAILED — manual retry qua admin
        await this.prisma.deletion_request.updateMany({
          where: { id: req.id },
          data: { status: 'FAILED', error_message: message.slice(0, 500) },
        });

        await this.writeAudit({
          actorType: 'system',
          action: 'gdpr.delete.failed',
          result: 'error',
          resourceType: 'user',
          resourceId: req.user_id,
          metadata: { requestId: req.id, error: message.slice(0, 500) },
        });
      }
    }

    return { processed: pendingDue.length, succeeded, failed };
  }
}
