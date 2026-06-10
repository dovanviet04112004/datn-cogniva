/**
 * BullMQ job `process-gdpr-deletion` — daily pickup PENDING deletion
 * request đã hết grace period (30 days) và execute hard delete.
 *
 * Chạy bởi worker; lịch/trigger ở src/queue/jobs.ts (CRON_JOBS, cron '0 3 * * *')
 * + src/worker dispatch theo job.name.
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
 *
 * Idempotency: mỗi request được claim qua atomic CAS (UPDATE ... WHERE
 *   status='PENDING'); nếu một request đã PROCESSING/COMPLETED/CANCELLED thì
 *   CAS trả 0 row → skip. Nhờ vậy whole-job retry an toàn: request đã xử lý
 *   xong sẽ không bị DELETE lại (user row đã biến mất + status đã COMPLETED).
 */
import { eq, lte, and, sql } from 'drizzle-orm';

import { db, deletionRequest, user } from '@cogniva/db';

import { writeAudit } from '@/lib/observability/audit';
import { logger } from '@/lib/observability/logger';

export async function processGdprDeletion() {
  // Step 1: Find pending requests đã hết grace
  const pendingDue = await db
    .select()
    .from(deletionRequest)
    .where(
      and(
        eq(deletionRequest.status, 'PENDING'),
        lte(deletionRequest.scheduledFor, new Date()),
      ),
    )
    .limit(50); // batch 50/run, max ~1500/month

  if (pendingDue.length === 0) {
    logger.info('gdpr.delete.no_due');
    return { processed: 0 };
  }

  logger.info('gdpr.delete.processing_batch', { count: pendingDue.length });

  let succeeded = 0;
  let failed = 0;

  for (const req of pendingDue) {
    try {
      await (async () => {
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
          logger.warn('gdpr.delete.skip', { requestId: req.id, reason: 'đã CANCELLED hoặc xử lý' });
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
        logger.warn('gdpr.delete.r2_cleanup_stub', { userId: req.userId });

        // 3. Delete user row → cascade FK xoá toàn bộ data
        //    Schema config onDelete: 'cascade' cho workspace.userId,
        //    document.userId, flashcard.userId, conversation.userId, etc.
        //    Phase 20 add: study_group_member, study_group_message,
        //      study_group_voice_state, study_group_invite, dm_thread,
        //      dm_message, dm_read_state — đều cascade từ user.id.
        //    study_group_channel.created_by là SET NULL (channel tồn tại
        //      sau khi creator xoá account — class continuity).
        //    Single DELETE wipe sạch toàn bộ.
        await db.delete(user).where(eq(user.id, req.userId));

        // 4. Mark COMPLETED
        await db
          .update(deletionRequest)
          .set({ status: 'COMPLETED', completedAt: new Date() })
          .where(eq(deletionRequest.id, req.id));

        // 5. Final audit log — timestamp coerce về string qua serialize.
        // Convert lại Date trước khi tính diff.
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
      })();
      succeeded++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      logger.error('gdpr.delete.failed', { requestId: req.id, error: message });

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
}
