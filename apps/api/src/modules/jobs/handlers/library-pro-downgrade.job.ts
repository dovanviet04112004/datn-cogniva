import { Injectable } from '@nestjs/common';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';

@Injectable()
export class LibraryProDowngradeJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ downgradedCount: number }> {
    const updated = await this.prisma.user.updateMany({
      where: { plan: 'PRO', pro_until_at: { not: null, lt: new Date() } },
      data: { plan: 'FREE', updated_at: new Date() },
    });
    const result = { downgradedCount: updated.count };

    logger.info(`Downgraded ${result.downgradedCount} expired PRO users to FREE`);
    logger.info('library-pro-downgrade.done', result);

    return result;
  }
}
