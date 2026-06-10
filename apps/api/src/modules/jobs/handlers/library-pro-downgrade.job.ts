/**
 * Job `library-pro-downgrade` (03:00 UTC = 10:00 VN daily) — Phase 4 Step 5.
 * Port NGUYÊN semantics từ apps/web/src/jobs/library-pro-downgrade.ts:
 * scan user.plan='PRO' với pro_until_at < NOW() → flip plan='FREE'. KHÔNG gửi
 * notification (pre-emptive warn là job library-pro-expiry-warn riêng).
 *
 * Idempotent: WHERE chỉ match PRO đã hết hạn — chạy lại nhiều lần không gây
 * tác dụng phụ (user đã FREE bị loại khỏi update).
 */
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
