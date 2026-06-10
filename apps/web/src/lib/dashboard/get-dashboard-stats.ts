/**
 * getDashboardStats — số liệu tổng quan trang chủ /dashboard (server-only).
 *
 * Tách khỏi page (trước inline 5 query) làm 1 nguồn dùng chung + cache được.
 * Cache-aside Redis (TTL 60s): dashboard đổi khi upload doc / tạo flashcard /
 * chat / thưởng XP. Invalidate:
 *   - `onXpChanged` (trong awardXp) → phủ review/quiz/note/upload (đều awardXp).
 *   - `onDashboardChanged` tại chat (conversation/message) + flashcard create
 *     (cardsDue) — các đường KHÔNG qua awardXp.
 *
 * dbReplica: 5 read thuần đếm/sort, không read-your-own-write tức thì (lệch ≤ TTL
 * cache đã chấp nhận) → route replica giảm tải primary (fallback primary).
 *
 * Date-serialization: chỉ `recentDocs[].createdAt` là Date → re-hydrate sau cache
 * để giữ type honest (tránh type-lie). Các field còn lại đều number.
 */
import { and, count, desc, eq, lte } from 'drizzle-orm';

import { conversation, dbReplica, document, flashcard, userStats, workspace } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export type DashboardRecentDoc = {
  id: string;
  filename: string;
  createdAt: Date;
  status: string;
};

export type DashboardStats = {
  totalDocs: number;
  cardsDue: number;
  totalConv: number;
  xp: number;
  streak: number;
  recentDocs: DashboardRecentDoc[];
  /**
   * Workspace gần nhất của user (id) — để quick-action "Hỏi AI Tutor" deep-link
   * THẲNG vào khung chat (`/workspaces/[id]`) thay vì đổ user ra trang chọn
   * workspace. `null` khi user chưa có workspace nào (brand-new) → fallback
   * `/workspaces`. Read-only, KHÔNG auto-create (tránh side-effect lúc render).
   */
  firstWorkspaceId: string | null;
  /**
   * User đã có flashcard nào chưa — signal RIÊNG cho bước onboarding "Ôn flashcard"
   * (KHÔNG dùng `xp>0` vì upload/notes/quiz cũng cộng xp → đánh dấu bước flashcard
   * xong oan). True khi đã tạo/generate ≥1 thẻ.
   */
  hasFlashcards: boolean;
};

/** Bản CACHE (TTL 60s) + re-hydrate Date. */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const data = await cached(ck.dashboard(userId), 60, () => fetchDashboardStats(userId));
  return {
    ...data,
    recentDocs: data.recentDocs.map((d) => ({ ...d, createdAt: new Date(d.createdAt) })),
  };
}

/** Truy vấn thật — chỉ chạy khi cache MISS. */
async function fetchDashboardStats(userId: string): Promise<DashboardStats> {
  const [[docCountRow], [cardDueRow], [convCountRow], [stats], recentDocs, firstWs, [fcCountRow]] =
    await Promise.all([
    dbReplica.select({ n: count(document.id) }).from(document).where(eq(document.userId, userId)),

    dbReplica
      .select({ n: count(flashcard.id) })
      .from(flashcard)
      .where(and(eq(flashcard.userId, userId), lte(flashcard.due, new Date()))),

    dbReplica
      .select({ n: count(conversation.id) })
      .from(conversation)
      .where(eq(conversation.userId, userId)),

    dbReplica
      .select({ xp: userStats.xp, currentStreak: userStats.currentStreak })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1),

    dbReplica
      .select({
        id: document.id,
        filename: document.filename,
        createdAt: document.createdAt,
        status: document.status,
      })
      .from(document)
      .where(eq(document.userId, userId))
      .orderBy(desc(document.createdAt))
      .limit(3),

    // Workspace mới nhất (chỉ cần id) cho deep-link chat ở dashboard.
    dbReplica
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.userId, userId))
      .orderBy(desc(workspace.createdAt))
      .limit(1),

    // Đã có flashcard nào chưa (bất kỳ) — cho bước onboarding "Ôn flashcard".
    dbReplica
      .select({ n: count(flashcard.id) })
      .from(flashcard)
      .where(eq(flashcard.userId, userId)),
  ]);

  return {
    totalDocs: docCountRow?.n ?? 0,
    cardsDue: cardDueRow?.n ?? 0,
    totalConv: convCountRow?.n ?? 0,
    xp: stats?.xp ?? 0,
    streak: stats?.currentStreak ?? 0,
    recentDocs,
    firstWorkspaceId: firstWs[0]?.id ?? null,
    hasFlashcards: (fcCountRow?.n ?? 0) > 0,
  };
}
