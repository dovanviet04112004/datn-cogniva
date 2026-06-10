/**
 * get-hub-stats — số liệu tổng của Library Hub (server-only).
 *
 * Trang `/library` hiển thị 2 con số global ở hero: tổng số doc PUBLISHED và
 * tổng lượt thêm-vào-workspace (SUM workspaceImportCount). Đây là DATA CÔNG KHAI
 * ĐƠN-KEY (giống mọi visitor, không userId) → cache đơn-key `ck.libraryHubStats()`,
 * xoá trực tiếp khi catalog đổi.
 *
 * Vì sao cache TẦNG DATA (không `export const revalidate`)?
 *   `(app)/layout.tsx` đọc session (headers) → ép mọi route con sang dynamic
 *   (Next 15, PPR off) → revalidate ở page VÔ TÁC DỤNG. Nên cache ở tầng data:
 *   kết quả query lưu Redis + chia sẻ giữa request → cắt DB round-trip dù route
 *   render động. Web-only (mobile gọi API). Qua lớp `cached()` (xem cache-aside.ts).
 *
 * Invalidation: `onLibraryCatalogChanged` xoá `ck.libraryHubStats()` khi doc
 * finalize (docCount đổi). TTL 3600s là lưới an toàn cuối (vd import bump
 * workspaceImportCount nhưng đường import chưa wire invalidator — xem note dưới).
 *
 * dbReplica: read công khai thuần → route replica (fallback primary). Không field
 * Date → serialize an toàn tuyệt đối qua cache.
 */
import { count, eq, sql } from 'drizzle-orm';

import { dbReplica, libraryDoc } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

/** Kết quả hub-stats: tổng doc PUBLISHED + tổng lượt thêm-vào-workspace. */
export type LibraryHubStats = {
  /** Số doc trạng thái PUBLISHED. */
  total: number;
  /** SUM(workspaceImportCount) — chỉ hiện ở hero khi > 0. */
  totalImports: number;
};

/**
 * Bản CACHE Redis (cache-aside, TTL 3600s) cho 2 con số hero của Library Hub.
 * Tách query inline khỏi `(app)/library/page.tsx` để cache 1 chỗ, có invalidation
 * thật qua `onLibraryCatalogChanged`.
 */
export async function getLibraryHubStats(): Promise<LibraryHubStats> {
  return cached(ck.libraryHubStats(), 3600, async () => {
    const [row] = await dbReplica
      .select({
        total: count(libraryDoc.id),
        totalImports: sql<number>`COALESCE(SUM(${libraryDoc.workspaceImportCount}),0)::int`,
      })
      .from(libraryDoc)
      .where(eq(libraryDoc.status, 'PUBLISHED'));

    return { total: row?.total ?? 0, totalImports: row?.totalImports ?? 0 };
  });
}
