/**
 * Queue (phía PRODUCER) — dùng để enqueue từ Next route/lib. Lazy getter: KHÔNG tạo
 * Queue/connection lúc import/build (tránh `next build` cố connect Redis), chỉ tạo ở
 * lần enqueue đầu (runtime). Server-only.
 *
 * Enqueue ví dụ:
 *   getRecordingQueue().add('process', data, { jobId: data.recordingId, attempts: 2,
 *     backoff: { type: 'exponential', delay: 30_000 } });
 */
import { Queue } from 'bullmq';

import { sharedConnection } from './connection';
import { QUEUE } from './jobs';

let _recording: Queue | null = null;
let _document: Queue | null = null;
let _cron: Queue | null = null;

export function getRecordingQueue(): Queue {
  if (!_recording) _recording = new Queue(QUEUE.recording, { connection: sharedConnection() });
  return _recording;
}

export function getDocumentQueue(): Queue {
  if (!_document) _document = new Queue(QUEUE.document, { connection: sharedConnection() });
  return _document;
}

export function getCronQueue(): Queue {
  if (!_cron) _cron = new Queue(QUEUE.cron, { connection: sharedConnection() });
  return _cron;
}
