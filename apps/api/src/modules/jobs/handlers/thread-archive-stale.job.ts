/**
 * Job `thread-archive-stale` (02:00 UTC = 09:00 VN daily) — archive thread root
 * idle > 7 ngày. Port từ apps/web/src/jobs/thread-archive-stale.ts (V2 G6.3).
 *
 * Web có COALESCE(thread_last_at, created_at) NHƯNG kèm điều kiện
 * thread_last_at IS NOT NULL → COALESCE không bao giờ rơi nhánh fallback;
 * rút gọn còn `thread_last_at < cutoff` (so sánh NULL = false tự loại NULL) —
 * row set CHẠM y hệt. Idempotent: chỉ UPDATE row archived_at IS NULL.
 *
 * Unarchive vẫn handled inline ở POST /messages/[id]/thread (route web).
 */
import { Injectable } from '@nestjs/common';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';

const IDLE_DAYS = 7;

@Injectable()
export class ThreadArchiveStaleJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ archived: number; cutoff: string }> {
    const cutoff = new Date(Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.study_group_message.updateMany({
      where: {
        thread_count: { gt: 0 },
        thread_root_id: null,
        archived_at: null,
        thread_last_at: { lt: cutoff },
      },
      data: { archived_at: new Date() },
    });

    const result = { archived: updated.count, cutoff: cutoff.toISOString() };

    logger.info('thread-archive.done', result);
    logger.info('thread-archive.cron-done', result);

    return result;
  }
}
