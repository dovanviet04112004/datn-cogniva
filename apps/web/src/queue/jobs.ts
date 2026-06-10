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
 * reconcile-leaderboard.
 */
export const CRON_JOBS = [
  { id: 'tutoring-auto-complete', pattern: '5 * * * *' },
  { id: 'thread-archive-stale', pattern: '0 2 * * *' },
  { id: 'tutoring-recurring-rollout', pattern: '30 2 * * *' },
  { id: 'process-gdpr-deletion', pattern: '0 3 * * *' },
  { id: 'tutoring-refresh-embeddings', pattern: '0 3 * * *' },
  { id: 'library-pro-downgrade', pattern: '0 3 * * *' },
  { id: 'library-pro-expiry-warn', pattern: '0 9 * * *' },
  { id: 'flashcard-due-reminder', pattern: '0 13 * * *' },
  { id: 'library-saved-search-notify', pattern: '0 14 * * *' },
] as const;

export type CronId = (typeof CRON_JOBS)[number]['id'];
