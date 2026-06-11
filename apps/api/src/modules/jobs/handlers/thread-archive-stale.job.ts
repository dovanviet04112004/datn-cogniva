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
