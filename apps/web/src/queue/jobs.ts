/**
 * Định nghĩa queue name, payload type của event job, và lịch cron — 1 nguồn chân lý
 * cho BullMQ. Server-only.
 */

/** Tên các queue BullMQ. */
export const QUEUE = {
  recording: 'recording',
  document: 'document',
  cron: 'cron',
} as const;

/**
 * Payload `recording/finished` (cũ) → job queue `recording`. Bắn từ webhook LiveKit
 * sau khi egress xong. process-recording dùng recordingId + fileUrl (+ roomId/channelId).
 */
export type RecordingJob = {
  recordingId: string;
  fileUrl: string;
  egressId?: string;
  r2Key?: string;
  roomId?: string;
  channelId?: string;
  duration?: number;
  fileSize?: number;
};

/**
 * Payload `document/ingested` (cũ) → job queue `document`. Bắn sau khi ingestDocument()
 * chunk + embed xong. Idempotent (ON CONFLICT DO NOTHING ở pivot).
 * Wave 3: PROCESSOR đã chuyển sang worker NestJS (apps/api DocumentProcessor) —
 * web chỉ còn produce từ admin reingest (lib/ingest/pipeline.ts).
 */
export type DocumentJob = {
  documentId: string;
  userId: string;
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
};

/**
 * Cron jobs CÒN LẠI trên queue `cron` (UTC). `id` = scheduler key + job.name.
 * Job đã PORT sang worker NestJS (apps/api, queue `cron-v2`) phải GỠ khỏi đây
 * (worker boot sẽ tự remove scheduler thừa) — đã port: health-monitor,
 * reconcile-leaderboard, thread-archive-stale, flashcard-due-reminder,
 * library-pro-downgrade, library-pro-expiry-warn, library-saved-search-notify.
 */
export const CRON_JOBS = [
  { id: 'tutoring-auto-complete', pattern: '5 * * * *' },
  { id: 'tutoring-recurring-rollout', pattern: '30 2 * * *' },
  { id: 'process-gdpr-deletion', pattern: '0 3 * * *' },
  { id: 'tutoring-refresh-embeddings', pattern: '0 3 * * *' },
] as const;

export type CronId = (typeof CRON_JOBS)[number]['id'];
