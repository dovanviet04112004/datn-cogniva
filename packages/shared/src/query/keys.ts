/**
 * Query key factory tập trung cho React Query — dùng chung web + mobile.
 *
 * Mọi useQuery/useMutation tham chiếu key qua `qk.*` thay vì gõ tay mảng rời rạc
 * → tránh lệch key (cache miss ngầm) + invalidate theo prefix.
 *
 * Key dạng mảng phân cấp `[domain, id, sub, ...filters]` để invalidate theo prefix
 * (vd `['channel', id]` xoá mọi query của channel đó).
 *
 * File MỞ RỘNG DẦN theo từng wave migrate — chỉ thêm key khi feature được chuyển.
 */
export const qk = {
  // ── groups / channels ──
  channelMessages: (channelId: string) => ['channel', channelId, 'messages'] as const,
  channelRead: (channelId: string) => ['channel', channelId, 'read'] as const,
  forum: (channelId: string, sort: string, tag: string | null) =>
    ['channel', channelId, 'forum', sort, tag ?? ''] as const,
  thread: (channelId: string, rootId: string) =>
    ['channel', channelId, 'thread', rootId] as const,
  groupMembers: (groupId: string) => ['group', groupId, 'members'] as const,

  // ── groups / channels extras (Wave 5 sweep) ──
  groupDetail: (groupId: string) => ['group', groupId, 'detail'] as const,
  groupChannels: (groupId: string) => ['group', groupId, 'channels'] as const,
  groupCategories: (groupId: string) =>
    ['group', groupId, 'categories'] as const,
  groupRoles: (groupId: string) => ['group', groupId, 'roles'] as const,
  groupAudit: (groupId: string) => ['group', groupId, 'audit'] as const,
  groupInvites: (groupId: string) => ['group', groupId, 'invites'] as const,
  groupMemberDetail: (groupId: string, userId: string) =>
    ['group', groupId, 'member', userId] as const,
  groupSearch: (groupId: string, q: string) =>
    ['group', groupId, 'search', q] as const,
  channelNotificationSetting: (channelId: string) =>
    ['channel', channelId, 'notification-setting'] as const,
  channelPinned: (channelId: string) => ['channel', channelId, 'pinned'] as const,
  channelMessageHistory: (channelId: string, messageId: string) =>
    ['channel', channelId, 'message', messageId, 'history'] as const,

  // ── global / user / account (Wave 5 sweep) ──
  search: (q: string) => ['search', q] as const,
  notifications: () => ['notifications'] as const,
  userStatus: () => ['user', 'status'] as const,
  profileMe: () => ['profile', 'me'] as const,
  accountDeletion: () => ['account', 'deletion'] as const,
  accountUsage: () => ['account', 'usage'] as const,
  parentalConsent: () => ['account', 'parental-consent'] as const,

  // ── mastery (Wave 5 sweep) ──
  mastery: (limit: number) => ['mastery', 'list', limit] as const,
  masteryRecommendations: (limit: number) =>
    ['mastery', 'recommendations', limit] as const,

  // ── chunks (chat doc preview) ──
  chunk: (chunkId: string) => ['chunk', chunkId] as const,
  documentChunks: (docId: string) => ['documents', docId, 'chunks'] as const,

  // ── DM ──
  dmThreads: () => ['dm', 'threads'] as const,
  dmMessages: (threadId: string) => ['dm', threadId, 'messages'] as const,

  // ── flashcards ──
  flashcardStats: () => ['flashcards', 'stats'] as const,
  flashcardQueue: (workspaceId?: string) =>
    ['flashcards', 'queue', workspaceId ?? 'all'] as const,

  // ── quiz ──
  quiz: (quizId: string) => ['quiz', quizId] as const,

  // ── dashboard / wallet / study-plan (Wave 3) ──
  analytics: () => ['analytics'] as const,
  leaderboard: () => ['leaderboard'] as const,
  wallet: () => ['wallet'] as const,
  studyPlan: () => ['study-plan'] as const,

  // ── tutoring (Wave 3) ──
  tutoringClasses: (subject?: string, level?: string) =>
    ['tutoring', 'classes', subject ?? '', level ?? ''] as const,
  tutoringFavorites: () => ['tutoring', 'favorites'] as const,
  tutoringPayouts: () => ['tutoring', 'payouts'] as const,
  tutoringBookings: (role: string) => ['tutoring', 'bookings', role] as const,
  tutoringCalendar: (from: string, to: string) =>
    ['tutoring', 'calendar', from, to] as const,
  tutoringBookingDetail: (id: string) => ['tutoring', 'booking', id] as const,
  tutoringRequestDetail: (id: string) => ['tutoring', 'request', id] as const,
  tutoringCompare: (idsCsv: string) => ['tutoring', 'compare', idsCsv] as const,

  // ── notes ──
  note: (noteId: string) => ['note', noteId] as const,

  // ── workspaces list (pickers dùng chung: import, course-picker…) ──
  workspaces: () => ['workspaces'] as const,

  // ── documents list (shared: ai-generate / quiz-generate / flashcards gen) ──
  documents: () => ['documents'] as const,

  // ── exams (shared: exam-editor-dialog + trang /exams/[id]) ──
  exam: (examId: string) => ['exam', examId] as const,

  // ── library (Wave 4) ──
  libraryDocRelated: (docId: string) =>
    ['library', 'doc', docId, 'related'] as const,
  libraryDocReviews: (docId: string) =>
    ['library', 'doc', docId, 'reviews'] as const,
  libraryDocAnnotations: (docId: string) =>
    ['library', 'doc', docId, 'annotations'] as const,
  libraryDocAtoms: (docId: string) => ['library', 'doc', docId, 'atoms'] as const,
  libraryDocEndorse: (docId: string) =>
    ['library', 'doc', docId, 'endorse'] as const,
  libraryDocPrereq: (docId: string) =>
    ['library', 'doc', docId, 'prereq'] as const,
  libraryDocDuplicates: (docId: string) =>
    ['library', 'doc', docId, 'duplicates'] as const,
  libraryDocDownload: (docId: string) =>
    ['library', 'doc', docId, 'download'] as const,
  librarySavedSearches: () => ['library', 'saved-searches'] as const,
  libraryUniversities: (q: string) => ['library', 'universities', q] as const,
  libraryCourses: (q: string, universityId: string | null) =>
    ['library', 'courses', q, universityId ?? ''] as const,

  // ── admin (Wave 3) — KHÔNG persist xuống IndexedDB (xem query-provider) ──
  adminUsers: (q: string, plan: string, status: string, adminOnly: boolean) =>
    ['admin', 'users', q, plan, status, adminOnly] as const,
  adminUserDetail: (id: string) => ['admin', 'user', id] as const,
  adminGroups: (q: string, status: string) =>
    ['admin', 'groups', q, status] as const,
  adminGroupDetail: (id: string) => ['admin', 'group', id] as const,
  adminConversations: (q: string, email: string) =>
    ['admin', 'conversations', q, email] as const,
  adminConversationDetail: (id: string) =>
    ['admin', 'conversation', id] as const,
  adminDocuments: (q: string, status: string, email: string, mime: string) =>
    ['admin', 'documents', q, status, email, mime] as const,
  adminReports: (status: string, targetType: string) =>
    ['admin', 'reports', status, targetType] as const,
  adminModerationContext: (type: string, id: string) =>
    ['admin', 'moderation', 'context', type, id] as const,
  adminBanned: (q: string) => ['admin', 'banned', q] as const,
  adminSearch: (q: string) => ['admin', 'search', q] as const,
  adminAudit: (filterKey: string) => ['admin', 'audit', filterKey] as const,
  adminFlags: () => ['admin', 'flags'] as const,
  adminMaintenance: () => ['admin', 'maintenance'] as const,
  adminAiUsage: (filterKey: string) => ['admin', 'ai', 'usage', filterKey] as const,
  adminAiCost: (range: string) => ['admin', 'ai', 'cost', range] as const,
  adminAiCircuits: () => ['admin', 'ai', 'circuits'] as const,
  adminTutoringBookings: (q: string, status: string) =>
    ['admin', 'tutoring', 'bookings', q, status] as const,
  adminTutoringBookingDetail: (id: string) =>
    ['admin', 'tutoring', 'booking', id] as const,
  adminTutoringReviews: (filterKey: string) =>
    ['admin', 'tutoring', 'reviews', filterKey] as const,

  // ── profile / graph / atoms (Wave 2) ──
  publicProfile: (userId: string) => ['profile', userId] as const,
  graph: (workspaceId?: string) => ['graph', workspaceId ?? 'all'] as const,
  graphConcept: (conceptId: string) => ['graph', 'concept', conceptId] as const,
  atomItems: (atomId: string, workspaceId: string) =>
    ['atom', atomId, 'items', workspaceId] as const,
  atomDetail: (atomId: string) => ['atom', atomId, 'detail'] as const,

  // ── workspaces (Wave 4) ──
  // version = notesVersion bump → đổi key để refetch atoms+notes list.
  workspaceSources: (workspaceId: string, version: number) =>
    ['workspace', workspaceId, 'sources', version] as const,
  // Studio recipe previews (session/flashcard/quiz/atom-guide/briefing…).
  workspaceRecipe: (workspaceId: string, recipe: string) =>
    ['workspace', workspaceId, 'recipe', recipe] as const,
  // Exam preview trong Studio (kèm examsVersion bump để refetch sau publish/del).
  workspaceExamPreview: (examId: string, version: number) =>
    ['workspace', 'exam-preview', examId, version] as const,
  workspaceConversations: (workspaceId: string) =>
    ['workspace', workspaceId, 'conversations'] as const,
  workspaceExams: (workspaceId: string, version: number) =>
    ['workspace', workspaceId, 'exams', version] as const,
  // Quản trị flashcard + câu hỏi của workspace (list + đã-làm/chưa-làm).
  workspaceManage: (workspaceId: string) =>
    ['workspace', workspaceId, 'manage'] as const,
} as const;
