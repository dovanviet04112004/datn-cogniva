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
 * TOÀN BỘ cron đã PORT sang worker NestJS (apps/api, queue `cron-v2`) — giữ
 * mảng RỖNG để worker boot tự remove scheduler thừa còn persist trong Redis.
 */
export const CRON_JOBS: readonly { id: string; pattern: string }[] = [];

export type CronId = (typeof CRON_JOBS)[number]['id'];
