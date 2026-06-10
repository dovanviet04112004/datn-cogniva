/**
 * BullMQ job `thread-archive-stale` — V2 G6.3 (2026-05-21).
 *
 * Chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker.
 *
 * Cron daily quét thread idle > 7 ngày → set `archived_at = now()`.
 *
 * Schedule: 02:00 UTC daily = 09:00 VN (giờ low traffic).
 *
 * Logic:
 *   UPDATE study_group_message
 *      SET archived_at = NOW()
 *    WHERE thread_count > 0
 *      AND thread_root_id IS NULL
 *      AND archived_at IS NULL
 *      AND thread_last_at < NOW() - INTERVAL '7 days'
 *
 * Partial index `study_group_message_thread_active_idx` (migration 0039) tăng
 * tốc query.
 *
 * Unarchive: handled inline trong POST /messages/[id]/thread — khi reply mới
 * vào archived thread, set archived_at = NULL atomic cùng tx insert reply.
 *
 * Idempotency: UPDATE chỉ chạm row có `archived_at IS NULL`, nên chạy lại
 * (whole-job retry) không archive trùng — các row đã set sẽ bị loại khỏi WHERE.
 *
 * Spec: docs/plans/study-group-v2.md §G6.
 */
import { and, gt, isNotNull, isNull, sql } from 'drizzle-orm';

import { db, studyGroupMessage } from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

const IDLE_DAYS = 7;

export async function threadArchiveStale() {
  const cutoff = new Date(Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000);

  const updated = await db
    .update(studyGroupMessage)
    .set({ archivedAt: new Date() })
    .where(
      and(
        gt(studyGroupMessage.threadCount, 0),
        isNull(studyGroupMessage.threadRootId),
        isNull(studyGroupMessage.archivedAt),
        // thread_last_at < cutoff. Nếu thread_last_at NULL, fallback createdAt.
        sql`COALESCE(${studyGroupMessage.threadLastAt}, ${studyGroupMessage.createdAt}) < ${cutoff}`,
        isNotNull(studyGroupMessage.threadLastAt),
      ),
    )
    .returning({ id: studyGroupMessage.id });

  const result = { archived: updated.length, cutoff: cutoff.toISOString() };

  logger.info('thread-archive.done', result);
  logger.info('thread-archive.cron-done', result);

  return result;
}
