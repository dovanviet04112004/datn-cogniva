/**
 * BullMQ worker — process thứ 2 của apps/web (chạy `pnpm --filter @cogniva/web worker`,
 * hoặc service `worker` trên VPS). Chia sẻ TOÀN BỘ code apps/web (db, lib, ai, r2, redis).
 *
 * 1 worker:
 *   - `cron` (concurrency 1, serial — an toàn cho gdpr): dispatch theo job.name
 * Queue `document` (W3) + `recording` (W4) đã PORT sang worker NestJS
 * (apps/api Document/RecordingProcessor) — web chỉ còn PRODUCE
 * (admin reingest, webhook LiveKit).
 *
 * Repeatable cron (CRON_JOBS) đăng ký qua upsertJobScheduler (idempotent) lúc boot, GIỮ giờ UTC.
 *
 * Retry semantics (QUAN TRỌNG cho idempotency): cron jobs dùng attempts MẶC
 * ĐỊNH = 1 (KHÔNG retry). Lỡ 1 lần thì lần schedule sau chạy lại (đa số dedupe
 * qua notification_log / WHERE status). ĐỪNG đặt attempts>1 cho cron trừ khi
 * job đã idempotent hoàn toàn.
 *
 * Server-only. KHÔNG import vào packages/shared / apps/mobile.
 */
import { Worker, type Job } from 'bullmq';

import { logger } from '@/lib/observability/logger';
import { makeBullConnection } from '@/queue/connection';
import { getCronQueue } from '@/queue/queues';
import { CRON_JOBS, QUEUE } from '@/queue/jobs';
import * as jobs from '@/jobs';

/** Map cron job.name → logic. job.name = CRON_JOBS[].id (set qua scheduler template). */
const CRON_MAP: Record<string, () => Promise<unknown>> = {
  'tutoring-auto-complete': jobs.tutoringAutoComplete,
  'tutoring-recurring-rollout': jobs.tutoringRecurringRollout,
  'process-gdpr-deletion': jobs.processGdprDeletion,
  'tutoring-refresh-embeddings': jobs.tutoringRefreshEmbeddings,
  'library-pro-downgrade': jobs.libraryProDowngrade,
  'library-pro-expiry-warn': jobs.libraryProExpiryWarn,
  'library-saved-search-notify': jobs.librarySavedSearchNotify,
};

async function main() {
  const cronWorker = new Worker(
    QUEUE.cron,
    (job: Job) => {
      const fn = CRON_MAP[job.name];
      if (!fn) {
        logger.warn('worker.cron.unknown', { name: job.name });
        return Promise.resolve();
      }
      return fn();
    },
    { connection: makeBullConnection(), concurrency: 1 },
  );

  const workers = [cronWorker];
  for (const w of workers) {
    w.on('completed', (job) =>
      logger.info('worker.job.completed', { queue: w.name, name: job.name, id: job.id }),
    );
    w.on('failed', (job, err) =>
      logger.error('worker.job.failed', {
        queue: w.name,
        name: job?.name,
        id: job?.id,
        attempts: job?.attemptsMade,
        error: err?.message,
      }),
    );
  }

  // Đăng ký repeatable cron (idempotent — chạy lại boot không tạo trùng).
  const cronQueue = getCronQueue();
  for (const c of CRON_JOBS) {
    await cronQueue.upsertJobScheduler(c.id, { pattern: c.pattern, tz: 'UTC' }, { name: c.id });
  }
  // Dọn scheduler MỒ CÔI (job đã port sang worker NestJS queue cron-v2 hoặc bị
  // gỡ khỏi CRON_JOBS) — scheduler persist trong Redis nên không tự biến mất.
  const keep = new Set<string>(CRON_JOBS.map((c) => c.id));
  for (const s of await cronQueue.getJobSchedulers()) {
    if (s.key && !keep.has(s.key)) {
      await cronQueue.removeJobScheduler(s.key);
      logger.info('worker.cron.removed_stale', { id: s.key });
    }
  }
  logger.info('worker.ready', { crons: CRON_JOBS.length });

  // Graceful shutdown — đóng worker (chờ job đang chạy xong) rồi thoát.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      logger.info('worker.shutdown', { signal: sig });
      void Promise.allSettled(workers.map((w) => w.close())).then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  logger.error('worker.boot.fail', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
