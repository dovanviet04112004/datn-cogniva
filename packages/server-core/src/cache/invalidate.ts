/**
 * invalidate.ts — Invalidator theo domain, gọi TẠI CHOKE POINT ghi (server-only).
 *
 * Triết lý "phủ đầy đủ by-construction": thay vì rải lời gọi xoá cache khắp các
 * route (dễ sót), gom về các hàm invalidator ở đây rồi hook vào ĐÚNG choke point —
 * nơi mọi đường ghi đều phải đi qua:
 *   - `awardXp()`    → onXpChanged   (quiz/flashcard/upload/note đều gọi awardXp)
 *   - `awardKarma()` → onKarmaChanged (import/remix/endorse/purchase/quality)
 * Nhờ vậy hook 2 hàm là phủ XP-leaderboard/profile/karma cho MỌI route gọi chúng.
 * Các count không qua choke point chung (dashboard/analytics/study-plan/wallet) thì
 * hook tại từng route create tương ứng — bảng đối chiếu đầy đủ ở §3 plan.
 *
 * Phase 0: CHỈ định nghĩa (chưa hook vào writer nào — đó là Phase 2). Tất cả best-effort.
 */
import { cacheDelete, bumpCacheVersion } from './cache-aside';
import { ck, TAG_LIBRARY } from './keys';
import { lbIncr } from './leaderboard';

/**
 * XP/streak đổi → gọi BÊN TRONG awardXp (choke point duy nhất cho XP).
 * Cộng ZSET leaderboard + xoá dashboard & profile của user.
 */
export async function onXpChanged(userId: string, xpDelta: number): Promise<void> {
  await lbIncr(userId, xpDelta); // ZSET atomic (Phase 3 mới đọc; populate sớm vô hại)
  await cacheDelete(ck.dashboard(userId), ck.profileMe(userId), ck.profilePublic(userId));
}

/** Doc/conversation/flashcard count đổi (đường KHÔNG qua awardXp). */
export async function onDashboardChanged(userId: string): Promise<void> {
  await cacheDelete(ck.dashboard(userId));
}

/** Assistant message mới (cost) → analytics 30 ngày của user cũ. */
export async function onAnalyticsChanged(userId: string): Promise<void> {
  await cacheDelete(ck.analytics(userId));
}

/** Karma đổi → gọi BÊN TRONG awardKarma (choke point 5 nguồn karma). Xoá karma-board. */
export async function onKarmaChanged(): Promise<void> {
  await cacheDelete(ck.karmaBoard());
}

/**
 * Doc publish/finalize (docCount trường+môn ++) → catalog directory cũ.
 * Xoá directory đơn-key + bump version cho các trang chi tiết theo id.
 */
export async function onLibraryCatalogChanged(): Promise<void> {
  await cacheDelete(ck.universities(), ck.libraryHubStats());
  // bump phủ TẤT CẢ public version-fold: course/university detail + docs feed + doc detail.
  await bumpCacheVersion(TAG_LIBRARY);
}

/** Study-plan write (toggle/skip/delete/create/materialize) — day = YYYY-MM-DD. */
export async function onStudyPlanChanged(userId: string, day: string): Promise<void> {
  await cacheDelete(ck.studyPlan(userId, day));
}

/** Wallet write (nạp/trừ/promo). */
export async function onWalletChanged(userId: string): Promise<void> {
  await cacheDelete(ck.wallet(userId));
}

/** Profile đổi tên/visibility (PATCH /api/profile/me) — KHÔNG qua awardXp. */
export async function onProfileChanged(userId: string): Promise<void> {
  await cacheDelete(ck.profileMe(userId), ck.profilePublic(userId));
}

// ──────────────────────────────────────────────────────────────────────────
// Wave 2 — app-shell / list-feed invalidators (fan-out tới mọi key bị ảnh hưởng)
// ──────────────────────────────────────────────────────────────────────────

/** Workspace tạo/sửa/xoá → sidebar workspaces list. */
export async function onWorkspaceChanged(userId: string): Promise<void> {
  // + dashboard: trang chủ đọc `firstWorkspaceId` (đã có workspace chưa) để quyết
  //   onboarding — tạo workspace mới phải bust để bước "Tạo workspace" tick ngay.
  await cacheDelete(ck.workspaces(userId), ck.dashboard(userId));
}

/** Content trong workspace đổi (note/flashcard/quiz/exam/doc/conversation) → badge stats + atoms. */
export async function onWorkspaceContentChanged(userId: string, workspaceId: string): Promise<void> {
  await cacheDelete(ck.workspaceStats(userId, workspaceId), ck.workspaceAtoms(userId, workspaceId));
}

/**
 * Document upload/delete/move → fan-out: list documents + docCount(workspaces sidebar) +
 * graph(concept đổi) + dashboard count + (nếu biết ws) stats/atoms workspace đó.
 */
export async function onDocumentChanged(userId: string, workspaceId?: string | null): Promise<void> {
  await cacheDelete(
    ck.documents(userId),
    ck.workspaces(userId),
    ck.graph(userId, 'all'),
    ck.dashboard(userId),
  );
  if (workspaceId) {
    await cacheDelete(
      ck.graph(userId, workspaceId),
      ck.workspaceStats(userId, workspaceId),
      ck.workspaceAtoms(userId, workspaceId),
    );
  }
}

/** AtomView (preview khi bấm 1 atom) đổi count/mastery → bust. Gọi khi gen
 *  flashcard/quiz THEO atom (count đổi) — mastery đã có onMasteryChanged lo. */
export async function onAtomChanged(userId: string, atomId: string): Promise<void> {
  await cacheDelete(ck.atomView(userId, atomId));
}

/** Flashcard create/delete → flashcard stats + dashboard cardsDue (+ workspace
 *  stats & ATOM list nếu có ws — atoms hiển thị flashcardCount per atom). */
export async function onFlashcardChanged(userId: string, workspaceId?: string | null): Promise<void> {
  await cacheDelete(ck.flashcardStats(userId), ck.dashboard(userId));
  if (workspaceId) {
    await cacheDelete(
      ck.workspaceStats(userId, workspaceId),
      ck.workspaceAtoms(userId, workspaceId),
    );
  }
}

/** Exam create/update/delete + attempt submit → list exams (+ workspace stats). */
export async function onExamChanged(userId: string, workspaceId?: string | null): Promise<void> {
  await cacheDelete(ck.exams(userId, 'all'), ck.exams(userId, workspaceId ?? 'all'));
  if (workspaceId) await cacheDelete(ck.workspaceStats(userId, workspaceId));
}

/** Group nội dung đổi (tên/channel) → detail + members của group (chung mọi member). */
export async function onGroupChanged(groupId: string): Promise<void> {
  await cacheDelete(ck.groupDetail(groupId), ck.groupMembers(groupId));
}

/** Membership đổi (join/leave) → list của user đó + detail/members group. */
export async function onGroupMembershipChanged(userId: string, groupId: string): Promise<void> {
  await cacheDelete(ck.groupsList(userId), ck.groupDetail(groupId), ck.groupMembers(groupId));
}

/** User đọc 1 group (mark-read) → unread badge của user đó về 0. */
export async function onGroupReadChanged(groupId: string, userId: string): Promise<void> {
  await cacheDelete(ck.groupUnread(groupId, userId));
}

/** Room create/join/leave → rooms list của user. */
export async function onRoomChanged(userId: string): Promise<void> {
  await cacheDelete(ck.roomsList(userId));
}

/** Recording mới finalize → list recordings của room. */
export async function onRoomRecordingsChanged(roomId: string): Promise<void> {
  await cacheDelete(ck.roomRecordings(roomId));
}

/** Conversation tạo mới / có message mới → chat conversations list. */
export async function onConversationsChanged(userId: string): Promise<void> {
  await cacheDelete(ck.conversationsList(userId));
}

/** Tutoring booking/request/application của user đổi → Mine dashboard. */
export async function onTutoringMineChanged(userId: string): Promise<void> {
  await cacheDelete(ck.mineTab(userId));
}

/**
 * Graph concept/edge đổi NGOÀI đường document (vd mine prerequisite thủ công).
 * Chỉ bust được key 'all' (mine không biết workspaceId); per-ws dựa TTL.
 */
export async function onGraphChanged(userId: string): Promise<void> {
  await cacheDelete(ck.graph(userId, 'all'));
}

/**
 * Mastery (BKT score) đổi sau quiz/flashcard/exam attempt → graph tô màu node theo
 * mastery nên cache graph cũ. Bust key 'all' (attempt không chắc biết workspaceId).
 */
export async function onMasteryChanged(
  userId: string,
  workspaceId?: string | null,
  conceptId?: string | null,
): Promise<void> {
  await cacheDelete(ck.graph(userId, 'all'));
  // Atom-list hiển thị masteryScore/level (check-list "đã nắm/đang học") → bust
  // ngay khi biết workspace user vừa quiz/review trong đó, không chờ TTL 60s.
  // Concept có thể thuộc nhiều workspace; chỉ bust cái user đang thao tác (đủ cho
  // 99% case), workspace khác tự mới qua TTL.
  if (workspaceId) await cacheDelete(ck.workspaceAtoms(userId, workspaceId));
  // AtomView (preview khi bấm atom) hiển thị mastery → bust khi biết atom nào.
  if (conceptId) await cacheDelete(ck.atomView(userId, conceptId));
}

/**
 * Import 1 doc (workspaceImportCount++) → chỉ hub-stats `totalImports` đổi.
 * CỐ Ý KHÔNG bump TAG_LIBRARY (import xảy ra thường xuyên → bump cả catalog version
 * sẽ flush sạch docs-feed/detail mỗi import, hit-rate sụp). Feed sort=popular + doc
 * detail importCount dựa TTL ngắn (300/600s) tự reconcile.
 */
export async function onLibraryImportChanged(): Promise<void> {
  await cacheDelete(ck.libraryHubStats());
}
