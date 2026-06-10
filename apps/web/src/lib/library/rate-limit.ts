/**
 * library/rate-limit — Phase 4 import rate limits (2026-05-27).
 *
 * Free tier: 5 imports / 24h
 * PRO tier:  unlimited
 *
 * Count qua library_doc_import.imported_at trong cửa sổ 24h.
 *
 * Spec: docs/plans/library-share.md §Storage + Cost Model §Limits.
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import { db, libraryDocImport } from '@cogniva/db';

import type { Plan } from '@/lib/observability/cost-guardrail';

export const FREE_IMPORTS_PER_DAY = 5;

export type RateLimitCheck = {
  allowed: boolean;
  count: number;
  limit: number | null; // null = unlimited
  resetAt: Date | null;
  reason?: string;
};

/**
 * Kiểm tra user còn quota import không. PRO+/TEAM/ENTERPRISE → unlimited.
 */
export async function checkImportRateLimit(
  userId: string,
  plan: Plan,
): Promise<RateLimitCheck> {
  if (plan !== 'FREE') {
    return { allowed: true, count: 0, limit: null, resetAt: null };
  }

  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const [agg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(libraryDocImport)
    .where(
      and(
        eq(libraryDocImport.importerId, userId),
        gte(libraryDocImport.importedAt, cutoff),
      ),
    );
  const count = agg ? Number(agg.count) : 0;

  if (count >= FREE_IMPORTS_PER_DAY) {
    // ResetAt = cutoff + 24h (window slides — earliest import expire)
    // Lấy earliest import trong window để compute reset chính xác hơn
    const [oldest] = await db
      .select({ importedAt: libraryDocImport.importedAt })
      .from(libraryDocImport)
      .where(
        and(
          eq(libraryDocImport.importerId, userId),
          gte(libraryDocImport.importedAt, cutoff),
        ),
      )
      .orderBy(libraryDocImport.importedAt)
      .limit(1);
    const resetAt = oldest
      ? new Date(oldest.importedAt.getTime() + 24 * 3600 * 1000)
      : new Date(Date.now() + 24 * 3600 * 1000);
    return {
      allowed: false,
      count,
      limit: FREE_IMPORTS_PER_DAY,
      resetAt,
      reason: `Free tier: tối đa ${FREE_IMPORTS_PER_DAY} import / 24h. Đã dùng ${count}/${FREE_IMPORTS_PER_DAY}. Reset lúc ${resetAt.toLocaleString('vi-VN')}. Nâng cấp PRO để unlimited.`,
    };
  }

  return {
    allowed: true,
    count,
    limit: FREE_IMPORTS_PER_DAY,
    resetAt: null,
  };
}
