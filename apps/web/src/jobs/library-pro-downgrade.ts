/**
 * library-pro-downgrade — Phase 4 Step 5 (2026-05-27).
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 * Cron 03:00 UTC daily (10:00 VN — early morning low-traffic window).
 * Scan user.plan='PRO' với pro_until_at < NOW() → downgrade plan='FREE'.
 *
 * Không gửi notification ngay (Phase 5 sẽ thêm "PRO hết hạn 3 ngày trước"
 * pre-emptive notif để upsell renewal). Chỉ flip plan.
 *
 * Idempotent: nếu user đã FREE → skip (WHERE plan='PRO'). Vì điều kiện
 * WHERE chỉ match PRO đã hết hạn, chạy lại nhiều lần (whole-job retry)
 * không gây tác dụng phụ — lần sau các user đã FREE bị loại khỏi update.
 */
import { and, eq, isNotNull, lt } from 'drizzle-orm';

import { db, user } from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

/**
 * libraryProDowngrade — thân job thuần (không tham số, chạy theo cron).
 * Trả về object summary để BullMQ lưu làm job result.
 */
export async function libraryProDowngrade() {
  // Downgrade các user PRO đã hết hạn về FREE (giữ nguyên query gốc).
  const result = await (async () => {
    const rows = await db
      .update(user)
      .set({ plan: 'FREE', updatedAt: new Date() })
      .where(
        and(
          eq(user.plan, 'PRO'),
          isNotNull(user.proUntilAt),
          lt(user.proUntilAt, new Date()),
        ),
      )
      .returning({ id: user.id });
    return { downgradedCount: rows.length };
  })();

  logger.info(`Downgraded ${result.downgradedCount} expired PRO users to FREE`);
  logger.info('library-pro-downgrade.done', result);

  return result;
}
