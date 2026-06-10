/**
 * keys.ts — Factory khoá cache DUY NHẤT (`ck`) cho lớp cache Tier 1 (server-only).
 *
 * Vì sao tập trung 1 chỗ:
 *   - Read (cached) và invalidate (cacheDelete) PHẢI dùng CÙNG 1 key cho cùng 1 data,
 *     nếu không sẽ "ghi 1 nơi, xoá 1 nẻo" → cache cũ không bao giờ bị bust. Gom về
 *     `ck` để key chỉ định nghĩa MỘT lần, cả 2 phía import chung.
 *   - Convention: `domain:v{N}:...` — version `v1` trong key để bump-flush hàng loạt
 *     khi đổi shape data (không phải version-fold runtime; cái đó là tham số `ver`).
 *
 * Phân biệt với `qk` (query keys) ở `packages/shared`: `qk` cho React Query (web+mobile
 * chung, RN-safe). `ck` là CACHE key server-side, WEB-ONLY — mobile KHÔNG cần (chỉ gọi API).
 *
 * Phân loại key:
 *   - Per-user (có userId): xoá trực tiếp bằng cacheDelete khi user đó có write.
 *   - Public (fold `ver`): nhiều visitor chung 1 data; bust bằng bumpCacheVersion(tag)
 *     rồi `ver` mới làm mọi key cũ thành mồ côi.
 */

/** Factory khoá cache — đừng tự nối chuỗi key rời rạc ở nơi khác. */
export const ck = {
  // ── Per-user (xoá trực tiếp) ──────────────────────────────────────────────
  /** Analytics usage+cost 30 ngày của user. */
  analytics: (u: string) => `analytics:v1:${u}:30d`,
  /** Dashboard stats tổng hợp của user. */
  dashboard: (u: string) => `dashboard:v1:${u}`,
  /** Profile/streak của chính user (StreakBadge). */
  profileMe: (u: string) => `profile:v1:${u}`,
  /** Số dư ví của user. */
  wallet: (u: string) => `wallet:v1:${u}`,
  /** Study-plan của user theo NGÀY (day = YYYY-MM-DD, vì proposal đổi mỗi ngày). */
  studyPlan: (u: string, day: string) => `study-plan:v1:${u}:${day}`,
  /** Profile CÔNG KHAI của 1 user (share link) — khác profileMe (của chính mình). */
  profilePublic: (u: string) => `profile-pub:v1:${u}`,

  // ── Per-user — app-shell / list feed (Wave 2 coverage) ───────────────────
  /** Sidebar workspaces (kèm docCount) — app-shell, hot nhất. */
  workspaces: (u: string) => `workspaces:v1:${u}`,
  /** Badge stats 1 workspace (6 count content). */
  workspaceStats: (u: string, ws: string) => `ws-stats:v1:${u}:${ws}`,
  /** Atom view 1 workspace (concept + mastery + count). */
  workspaceAtoms: (u: string, ws: string) => `ws-atoms:v1:${u}:${ws}`,
  /** AtomView 1 atom (concept + mastery + 3 count) — preview khi bấm atom. */
  atomView: (u: string, atomId: string) => `atom-view:v1:${u}:${atomId}`,
  /** List documents của user (kèm chunkCount). */
  documents: (u: string) => `documents:v1:${u}`,
  /** Flashcard stats (count theo state + due + avg rating). */
  flashcardStats: (u: string) => `flashcard-stats:v1:${u}`,
  /** List exams (owned + joined) trong 1 workspace (ws='all' nếu không lọc). */
  exams: (u: string, ws: string) => `exams:v1:${u}:${ws}`,
  /** Knowledge graph của user (ws='all' = toàn bộ). */
  graph: (u: string, ws: string) => `graph:v1:${u}:${ws}`,
  /** Sidebar study-groups của user (kèm memberCount). */
  groupsList: (u: string) => `groups:v1:${u}`,
  /** Unread badge của 1 group cho 1 user (per-user). */
  groupUnread: (g: string, u: string) => `group-unread:v1:${g}:${u}`,
  /** Chat conversations list của user (kèm messageCount). */
  conversationsList: (u: string) => `conversations:v1:${u}`,
  /** Tutoring "Mine" dashboard (profile + requests + bookings + applications). */
  mineTab: (u: string) => `tutoring-mine:v1:${u}`,

  // ── Per-RESOURCE (chung mọi member; access-check NGOÀI cache) ─────────────
  /** Group detail (group + channels) — nội dung chung member, guard ngoài cache. */
  groupDetail: (g: string) => `group-detail:v1:${g}`,
  /** Member list 1 group. */
  groupMembers: (g: string) => `group-members:v1:${g}`,
  /** List recordings 1 room. */
  roomRecordings: (r: string) => `room-recordings:v1:${r}`,
  /** Rooms list của user (per-user vì gồm room user là member). */
  roomsList: (u: string) => `rooms:v1:${u}`,

  // ── Public, ĐƠN-KEY (xoá trực tiếp bằng cacheDelete — chính xác, rẻ hơn fold) ──
  /** Bảng karma library (leaderboard + feed) — 1 object global. */
  karmaBoard: () => `library:v1:karma-board`,
  /** Catalog trường + môn của library — 1 object global. */
  universities: () => `library:v1:universities`,
  /** Hub stats library (SUM import + COUNT doc toàn bảng) — 1 object global. */
  libraryHubStats: () => `library:v1:hub-stats`,

  // ── Public, NHIỀU-KEY theo id/filter (fold version `ver` vì không enumerate hết key) ──
  /** Chi tiết 1 môn (course) trong catalog. */
  courseDetail: (id: string, ver: number) => `library:v1:course:${id}:${ver}`,
  /** Chi tiết 1 trường (university) trong catalog. */
  universityDetail: (id: string, ver: number) => `library:v1:university:${id}:${ver}`,
  /** Feed library docs theo filter (hash các filter+sort+page) — chỉ cache khi q rỗng. */
  libraryDocsFeed: (filterHash: string, ver: number) => `library:v1:docs:${filterHash}:${ver}`,
  /** Chi tiết 1 library doc + top reviews (public). */
  libraryDocDetail: (id: string, ver: number) => `library:v1:doc:${id}:${ver}`,

  // ── Public tutoring browse (TTL-only, đổi chậm) ──────────────────────────
  /** Browse tutors theo filter+sort+page (hash). */
  tutorsBrowse: (filterHash: string) => `tutoring:v1:tutors:${filterHash}`,
  /** Browse open requests theo filter (hash). */
  tutoringRequests: (filterHash: string) => `tutoring:v1:requests:${filterHash}`,
} as const;

/** ZSET leaderboard XP toàn cục (precompute — xem leaderboard.ts). */
export const LB_XP = 'lb:xp:v1';

/**
 * Version tag cho các trang CHI TIẾT library theo id (course/university detail —
 * nhiều key, dùng version-fold). KHÔNG dùng cho directory/karma-board (đơn-key,
 * đã xoá trực tiếp). Bump khi catalog đổi.
 */
export const TAG_LIBRARY = 'library:catalog';
