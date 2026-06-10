/**
 * LibraryRateLimitService — Phase 4 import rate limits, port từ
 * apps/web/src/lib/library/rate-limit.ts (KHÁC checkLimit Redis của
 * server-core: đây là count DB qua library_doc_import trong cửa sổ 24h).
 *
 * Free tier: 5 imports / 24h. PRO/TEAM/ENTERPRISE: unlimited.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';

export const FREE_IMPORTS_PER_DAY = 5;

export type RateLimitCheck = {
  allowed: boolean;
  count: number;
  limit: number | null; // null = unlimited
  resetAt: Date | null;
  reason?: string;
};

@Injectable()
export class LibraryRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kiểm tra user còn quota import không. Plan != FREE → unlimited. */
  async checkImportRateLimit(userId: string, plan: Plan): Promise<RateLimitCheck> {
    if (plan !== 'FREE') {
      return { allowed: true, count: 0, limit: null, resetAt: null };
    }

    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const count = await this.prisma.library_doc_import.count({
      where: { importer_id: userId, imported_at: { gte: cutoff } },
    });

    if (count >= FREE_IMPORTS_PER_DAY) {
      // ResetAt = earliest import trong window + 24h (window slides)
      const oldest = await this.prisma.library_doc_import.findFirst({
        where: { importer_id: userId, imported_at: { gte: cutoff } },
        orderBy: { imported_at: 'asc' },
        select: { imported_at: true },
      });
      const resetAt = oldest
        ? new Date(oldest.imported_at.getTime() + 24 * 3600 * 1000)
        : new Date(Date.now() + 24 * 3600 * 1000);
      return {
        allowed: false,
        count,
        limit: FREE_IMPORTS_PER_DAY,
        resetAt,
        reason: `Free tier: tối đa ${FREE_IMPORTS_PER_DAY} import / 24h. Đã dùng ${count}/${FREE_IMPORTS_PER_DAY}. Reset lúc ${resetAt.toLocaleString('vi-VN')}. Nâng cấp PRO để unlimited.`,
      };
    }

    return { allowed: true, count, limit: FREE_IMPORTS_PER_DAY, resetAt: null };
  }
}
