/**
 * BullMQ worker — process thứ 2 của apps/web (chạy `pnpm --filter @cogniva/web worker`,
 * hoặc service `worker` trên VPS). Chia sẻ TOÀN BỘ code apps/web (db, lib, ai, r2, redis).
 *
 * 2 worker:
 *   - `recording` (event, concurrency 2): processRecording
 *   - `cron`      (concurrency 1, serial — an toàn cho gdpr): dispatch theo job.name
 * Queue `document` (extract-document-concepts) đã PORT sang worker NestJS
 * (apps/api DocumentProcessor) Wave 3 — web chỉ còn produce (admin reingest).
 *
 * Repeatable cron (11) đăng ký qua upsertJobScheduler (idempotent) lúc boot, GIỮ giờ UTC.
 *
 * Retry semantics (QUAN TRỌNG cho idempotency):
 *   - Cron jobs dùng attempts MẶC ĐỊNH = 1 (KHÔNG retry). Lỡ 1 lần thì lần schedule
 *     sau chạy lại (đa số dedupe qua notification_log / WHERE status). → KHÔNG gửi push
 *     trùng, KHÔNG double-act dù side-effect không nguyên tử. ĐỪNG đặt attempts>1 cho cron
 *     trừ khi job đã idempotent hoàn toàn.
 *   - Event jobs CÓ retry (recording attempts=2, document attempts=3) → đã idempotent:
 *     recording = checkpoint PROCESSED + flashcards atomic; document = ON CONFLICT DO NOTHING.
 *
 * Server-only. KHÔNG import vào packages/shared / apps/mobile.
 */
import { Worker, type Job } from 'bullmq';

import { logger } from '@/lib/observability/logger';
import { makeBullConnection } from '@/queue/connection';
import { getCronQueue } from '@/queue/queues';
import { QUEUE, CRON_JOBS, type RecordingJob } from '@/queue/jobs';
import * as jobs from '@/jobs';

/** Map cron job.name → logic. job.name = CRON_JOBS[].id (set qua scheduler template). */
const CRON_MAP: Record<string, () => Promise<unknown>> = {
  'tutoring-auto-complete': jobs.tutoringAutoComplete,
  'thread-archive-stale': jobs.threadArchiveStale,
  'tutoring-recurring-rollout': jobs.tutoringRecurringRollout,
  'process-gdpr-deletion': jobs.processGdprDeletion,
  'tutoring-refresh-embeddings': jobs.tutoringRefreshEmbeddings,
  'library-pro-downgrade': jobs.libraryProDowngrade,
  'library-pro-expiry-warn': jobs.libraryProExpiryWarn,
  'flashcard-due-reminder': jobs.flashcardDueReminder,
  'library-saved-search-notify': jobs.librarySavedSearchNotify,
};

async function main() {
  const recordingWorker = new Worker(
    QUEUE.recording,
    (job: Job<RecordingJob>) => jobs.processRecording(job.data),
    { connection: makeBullConnection(), concurrency: 2 },
  );

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

  const workers = [recordingWorker, cronWorker];
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
