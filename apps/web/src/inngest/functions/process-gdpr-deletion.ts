/**
 * Inngest function `process-gdpr-deletion` — daily pickup PENDING deletion
 * request đã hết grace period (30 days) và execute hard delete.
 *
 * Plan v2 §5.9 + §10.4.3 + §15.1 W9-10.
 *
 * Schedule: 03:00 UTC daily (off-peak, sau backup window 02:00).
 *
 * Pipeline:
 *   1. Query deletion_request status=PENDING, scheduled_for <= NOW
 *   2. Per request:
 *      a. Mark status=PROCESSING
 *      b. Audit log gdpr.delete.processing
 *      c. Delete R2 objects với prefix {userId}/
 *      d. Delete user row → cascade FK xoá hết workspace/doc/chunk/flashcard/...
 *      e. Anonymize audit log entries (giữ structure, redact PII)
 *      f. Mark status=COMPLETED + completed_at
 *      g. Audit log gdpr.delete.completed
 *   3. On error: status=FAILED, log Sentry, manual retry
 *
 * Cascade FK đã được setup ở schema (workspace.userId references user.id
 * onDelete cascade). User row delete → cascade.
 *
 * Audit log:
 *   - KHÔNG xoá audit_log của user (compliance: legal retention 7y)
 *   - Anonymize: redact actor_id, ip_address, user_agent qua UPDATE
 *     (KHÔNG vi phạm immutable trigger — UPDATE bị block; phải dùng admin
 *      separate ops script. Stage 2 implement.)
 */
import { eq, lte, and, sql } from 'drizzle-orm';

import { db, deletionRequest, user } from '@cogniva/db';

import { inngest } from '../client';
import { writeAudit } from '@/lib/observability/audit';

export const processGdprDeletion = inngest.createFunction(
  {
    id: 'process-gdpr-deletion',
    name: 'GDPR Article 17 — process scheduled account deletion',
    retries: 2,
    concurrency: { limit: 1 }, // 1 instance đủ — không cần parallel
  },
  // Cron: 03:00 UTC daily
  { cron: '0 3 * * *' },
  async ({ step, logger }) => {
    // Step 1: Find pending requests đã hết grace
    const pendingDue = await step.run('find-due', async () => {
      return db
        .select()
        .from(deletionRequest)
        .where(
          and(
            eq(deletionRequest.status, 'PENDING'),
            lte(deletionRequest.scheduledFor, new Date()),
          ),
        )
        .limit(50); // batch 50/run, max ~1500/month
    });

    if (pendingDue.length === 0) {
      logger.info('[gdpr-delete] no due requests');
      return { processed: 0 };
    }

    logger.info(`[gdpr-delete] processing ${pendingDue.length} due requests`);

    let succeeded = 0;
    let failed = 0;

    for (const req of pendingDue) {
      try {
        await step.run(`process-${req.id}`, async () => {
          // 1. Mark PROCESSING (atomic CAS — chỉ update nếu vẫn PENDING)
          const updated = await db
            .update(deletionRequest)
            .set({ status: 'PROCESSING' })
            .where(
              and(
                eq(deletionRequest.id, req.id),
                eq(deletionRequest.status, 'PENDING'),
              ),
            )
            .returning();
          if (updated.length === 0) {
            logger.warn(`[gdpr-delete] request ${req.id} đã CANCELLED hoặc xử lý — skip`);
            return;
          }

          await writeAudit({
            actorType: 'system',
            action: 'gdpr.delete.processing',
            result: 'success',
            actorId: null,
            resourceType: 'user',
            resourceId: req.userId,
            metadata: { requestId: req.id },
          });

          // 2. Delete R2 objects với prefix {userId}/
          //    Stage 1 stub — Stage 2 implement với @aws-sdk/client-s3 listObjects + deleteObjects.
          //    Cần R2 IAM cho phép DeleteObject scope theo prefix.
          logger.warn(`[gdpr-delete] R2 cleanup STUB cho user ${req.userId}`);

          // 3. Delete user row → cascade FK xoá toàn bộ data
          //    Schema config onDelete: 'cascade' cho workspace.userId,
          //    document.userId, flashcard.userId, conversation.userId, etc.
          //    Single DELETE wipe sạch.
          await db.delete(user).where(eq(user.id, req.userId));

          // 4. Mark COMPLETED
          await db
            .update(deletionRequest)
            .set({ status: 'COMPLETED', completedAt: new Date() })
            .where(eq(deletionRequest.id, req.id));

          // 5. Final audit log — Inngest step result coerce timestamp về string
          // qua JSON serialize. Convert lại Date trước khi tính diff.
          const scheduledTime = new Date(req.scheduledFor).getTime();
          const requestedTime = new Date(req.requestedAt).getTime();
          await writeAudit({
            actorType: 'system',
            action: 'gdpr.delete.completed',
            result: 'success',
            actorId: null, // user đã không tồn tại
            resourceType: 'user',
            resourceId: req.userId,
            metadata: {
              requestId: req.id,
              reason: req.reason,
              graceDays: Math.round((scheduledTime - requestedTime) / (1000 * 60 * 60 * 24)),
            },
          });
        });
        succeeded++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[gdpr-delete] fail request ${req.id}:`, message);

        // Mark FAILED — manual retry qua admin
        await db
          .update(deletionRequest)
          .set({
            status: 'FAILED',
            errorMessage: message.slice(0, 500),
          })
          .where(eq(deletionRequest.id, req.id));

        await writeAudit({
          actorType: 'system',
          action: 'gdpr.delete.failed',
          result: 'error',
          resourceType: 'user',
          resourceId: req.userId,
          metadata: { requestId: req.id, error: message.slice(0, 500) },
        });
      }
    }

    // Suppress unused warning — sql util re-export check
    void sql;

    return { processed: pendingDue.length, succeeded, failed };
  },
);
