/**
 * /api/tutoring/concierge/threads/[id]/messages — V4 T1 (2026-05-22).
 *
 * GET   — list messages của thread (asc by createdAt)
 * POST  — gửi user message → planner → search (nếu cần) → stream AI response
 *
 * Response POST format: SSE stream với 3 event types:
 *   event: text       — char-by-char AI response text
 *   event: tutors     — JSON array tutor match (kèm reason)
 *   event: action     — JSON action object (clarify/search/no_match) — final
 *   event: done       — close stream
 *
 * Spec: docs/plans/tutoring-v4.md §5.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  tutorProfile,
  tutorRequest,
  tutoringConciergeMessage,
  tutoringConciergeThread,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  generateMatchReasons,
  planConciergeStep,
  validateFilters,
  type ConciergeAction,
  type ConciergeFilters,
  type ConciergeHistory,
} from '@/lib/tutoring/concierge-agent';
import { hybridSearchLibraryDocs } from '@/lib/library/hybrid-search-doc';
import { FAQ_ENTRIES, matchFaq, type FaqEntry } from '@/lib/tutoring/concierge-faq';
import { hybridSearchTutors } from '@/lib/tutoring/hybrid-search';
import { hybridSearchRequests } from '@/lib/tutoring/request-search';
import { resolveTutorDetail } from '@/lib/tutoring/tutor-detail-resolver';
import { SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';
import type { Plan } from '@/lib/observability/cost-guardrail';

/**
 * Build response text deterministic từ action — KHÔNG gọi LLM thứ 2.
 *
 * Lý do bỏ LLM responder:
 *   1. Templated text deterministic, không hallucinate
 *   2. Giảm 50% LLM cost (chỉ planner)
 *   3. Loại bỏ 1 failure point (responder timeout/empty)
 *   4. Faster: trả về ngay, không phải đợi streaming
 */
function buildResponseText(
  action: ConciergeAction,
  resultCount: number,
  relaxedNotes: string[],
  tutorDetailName?: string | null,
  tutorDetailAskAbout?: 'reviews' | 'availability' | 'price' | 'profile' | 'other',
  tutorDetailFound?: boolean,
  faqEntry?: FaqEntry | null,
  libraryDocCount?: number,
): string {
  if (action.type === 'clarify') {
    return action.question;
  }
  if (action.type === 'library_search') {
    if (!libraryDocCount || libraryDocCount === 0) {
      return `Mình chưa tìm thấy tài liệu khớp với "${action.query}" trong kho. Bạn thử browse trực tiếp ở /library hoặc tải lên tài liệu nếu có sẵn.`;
    }
    const subjLabel = action.filters.subjectSlug
      ? SUBJECT_BY_SLUG[action.filters.subjectSlug]?.name ?? ''
      : '';
    return `Đã tìm thấy ${libraryDocCount} tài liệu${subjLabel ? ` ${subjLabel}` : ''} phù hợp. Bấm card để xem chi tiết hoặc Import vào workspace để học với AI.`;
  }
  if (action.type === 'faq') {
    if (faqEntry) {
      return faqEntry.answer;
    }
    return 'Mình chưa có câu trả lời chính xác cho câu hỏi đó. Bạn thử gõ cụ thể hơn, hoặc liên hệ support hi@cogniva.vn nhé.';
  }
  if (action.type === 'tutor_detail') {
    if (!tutorDetailFound) {
      return `Mình chưa tìm thấy gia sư "${action.tutorRef}" trong các kết quả vừa rồi. Bạn thử gõ lại tên đầy đủ hoặc bấm vào card cụ thể nhé.`;
    }
    const name = tutorDetailName ?? 'gia sư này';
    switch (tutorDetailAskAbout) {
      case 'reviews':
        return `Đây là review về ${name}. Cuộn xuống xem chi tiết feedback từ học viên đã học.`;
      case 'availability':
        return `Đây là thông tin lịch dạy của ${name}. Để đặt buổi cụ thể, bấm "Xem profile" → chọn slot.`;
      case 'price':
        return `Đây là giá + pack ưu đãi của ${name}.`;
      case 'profile':
      case 'other':
      default:
        return `Đây là tóm tắt profile ${name}. Bấm card để xem đầy đủ.`;
    }
  }
  // action.type ở đây chỉ còn search | no_match
  const isTutorSide = action.searchTarget === 'request';
  const noun = isTutorSide ? 'yêu cầu' : 'gia sư';
  const subjectName = action.filters.subjectSlug
    ? SUBJECT_BY_SLUG[action.filters.subjectSlug]?.name ?? action.filters.subjectSlug
    : null;

  if (action.type === 'no_match') {
    const altCta = isTutorSide
      ? 'Bạn thử mở rộng môn / cấp độ, hoặc tự browse tab "Yêu cầu" nhé.'
      : 'Bạn thử đổi sang môn khác, hoặc đăng yêu cầu để gia sư đề xuất ngược nhé.';
    return `Hmm, mình chưa tìm thấy ${noun} khớp với ${subjectName ?? 'môn này'} (đã thử cả mở rộng bộ lọc). ${altCta}`;
  }

  // V5.2 globalReason — deterministic, giải thích vì sao N kết quả này
  const reasonBits: string[] = [];
  if (subjectName) reasonBits.push(`môn ${subjectName}`);
  if (action.filters.level) {
    const levelLabel: Record<string, string> = {
      PRIMARY: 'Tiểu học',
      SECONDARY: 'THCS',
      HIGH_SCHOOL: 'THPT',
      UNIVERSITY: 'Đại học',
      ADULT: 'Người đi làm',
    };
    reasonBits.push(`cấp ${levelLabel[action.filters.level] ?? action.filters.level}`);
  }
  if (action.filters.modality) {
    const modLabel: Record<string, string> = {
      ONLINE: 'Online',
      OFFLINE_HN: 'Offline HN',
      OFFLINE_HCM: 'Offline HCM',
      HYBRID: 'Linh hoạt',
    };
    reasonBits.push(`hình thức ${modLabel[action.filters.modality]}`);
  }
  if (action.filters.budgetMaxVnd) {
    reasonBits.push(
      isTutorSide
        ? `budget ≥ ${Math.round(action.filters.budgetMaxVnd / 1000)}K/h`
        : `giá ≤ ${Math.round(action.filters.budgetMaxVnd / 1000)}K/h`,
    );
  }
  const filterPhrase = reasonBits.length > 0 ? ` khớp ${reasonBits.join(' + ')}` : '';
  const sortReason = isTutorSide
    ? 'Mình sắp xếp theo mức độ khẩn cấp + thời gian đăng — đơn HOT lên đầu.'
    : 'Mình sắp xếp theo điểm tổng hợp (rating + buổi đã dạy + KYC + Instant Book) để top kết quả đáng tin nhất.';
  const relaxedSuffix =
    relaxedNotes.length > 0
      ? ` Đã mở rộng ${relaxedNotes.join(' · ')} vì kết quả strict ít.`
      : '';
  const ctaWord = isTutorSide
    ? 'Bấm card để xem chi tiết & ứng tuyển.'
    : 'Bấm card để xem profile. Gõ "review về cô X" để xem feedback chi tiết.';
  return `Tìm thấy ${resultCount} ${noun}${filterPhrase}.${relaxedSuffix} ${sortReason} ${ctaWord}`;
}

export const runtime = 'nodejs';

const POST_SCHEMA = z.object({
  message: z.string().min(1).max(2000),
});

const MAX_HISTORY_FOR_PLANNER = 8;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [thread] = await db
    .select({ id: tutoringConciergeThread.id })
    .from(tutoringConciergeThread)
    .where(
      and(
        eq(tutoringConciergeThread.id, id),
        eq(tutoringConciergeThread.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const messages = await db
    .select()
    .from(tutoringConciergeMessage)
    .where(eq(tutoringConciergeMessage.threadId, id))
    .orderBy(asc(tutoringConciergeMessage.createdAt));

  // ─── Hydrate: collect all referenced tutor/request IDs + faq IDs ─────
  const allTutorIds = new Set<string>();
  const allRequestIds = new Set<string>();
  const allFaqIds = new Set<string>();
  for (const m of messages) {
    const meta = m.metadata as
      | {
          tutorIds?: string[];
          requestIds?: string[];
          faqId?: string;
        }
      | null
      | undefined;
    for (const id of meta?.tutorIds ?? []) allTutorIds.add(id);
    for (const id of meta?.requestIds ?? []) allRequestIds.add(id);
    if (meta?.faqId) allFaqIds.add(meta.faqId);
  }

  // Bulk fetch — 2 parallel queries cho tutor + request
  const [tutorRows, requestRows] = await Promise.all([
    allTutorIds.size > 0
      ? db
          .select({
            id: tutorProfile.id,
            userId: tutorProfile.userId,
            headline: tutorProfile.headline,
            hourlyRateVnd: tutorProfile.hourlyRateVnd,
            modality: tutorProfile.modality,
            avatarUrl: tutorProfile.avatarUrl,
            ratingAvg: tutorProfile.ratingAvg,
            ratingCount: tutorProfile.ratingCount,
            sessionsCompleted: tutorProfile.sessionsCompleted,
            verificationStatus: tutorProfile.verificationStatus,
            tutorName: userTable.name,
          })
          .from(tutorProfile)
          .leftJoin(userTable, eq(userTable.id, tutorProfile.userId))
          .where(inArray(tutorProfile.id, [...allTutorIds]))
      : Promise.resolve([]),
    allRequestIds.size > 0
      ? db
          .select({
            id: tutorRequest.id,
            studentId: tutorRequest.studentId,
            studentName: userTable.name,
            title: tutorRequest.title,
            description: tutorRequest.description,
            subjectSlug: tutorRequest.subjectSlug,
            level: tutorRequest.level,
            budgetVnd: tutorRequest.budgetVnd,
            modality: tutorRequest.modality,
            urgency: tutorRequest.urgency,
            createdAt: tutorRequest.createdAt,
          })
          .from(tutorRequest)
          .leftJoin(userTable, eq(userTable.id, tutorRequest.studentId))
          .where(inArray(tutorRequest.id, [...allRequestIds]))
      : Promise.resolve([]),
  ]);

  const tutorMap = new Map(tutorRows.map((t) => [t.id, t]));
  const requestMap = new Map(requestRows.map((r) => [r.id, r]));
  const faqMap = new Map(FAQ_ENTRIES.map((f) => [f.id, f]));

  // Enrich từng message với hydrated payload
  const enriched = messages.map((m) => {
    const meta = m.metadata as
      | {
          action?: string;
          role?: 'student' | 'tutor';
          searchTarget?: 'tutor' | 'request';
          tutorIds?: string[];
          requestIds?: string[];
          faqId?: string;
          filters?: Record<string, unknown>;
          total?: number;
        }
      | null
      | undefined;

    const tutors = (meta?.tutorIds ?? [])
      .map((id) => tutorMap.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({
        id: t.id,
        userId: t.userId,
        headline: t.headline,
        hourlyRateVnd: t.hourlyRateVnd,
        modality: t.modality,
        avatarUrl: t.avatarUrl,
        ratingAvg: t.ratingAvg ? Number(t.ratingAvg) : null,
        ratingCount: t.ratingCount,
        sessionsCompleted: t.sessionsCompleted,
        verificationStatus: t.verificationStatus,
        name: t.tutorName,
        score: 0, // history score = 0, không re-rank
        matchReason: undefined,
      }));

    const requests = (meta?.requestIds ?? [])
      .map((id) => requestMap.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.studentName,
        title: r.title,
        description: r.description.slice(0, 180),
        subjectSlug: r.subjectSlug,
        level: r.level,
        budgetVnd: r.budgetVnd,
        modality: r.modality,
        urgency: r.urgency,
        createdAt: r.createdAt.toISOString(),
        score: 0,
      }));

    const faqEntry = meta?.faqId ? faqMap.get(meta.faqId) ?? null : null;

    return {
      id: m.id,
      threadId: m.threadId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      metadata: {
        action: meta?.action,
        role: meta?.role,
        searchTarget: meta?.searchTarget,
        filters: meta?.filters,
        total: meta?.total,
      },
      hydrated: {
        tutors,
        requests,
        faqEntry,
      },
    };
  });

  return NextResponse.json({ messages: enriched });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: threadId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [thread] = await db
    .select()
    .from(tutoringConciergeThread)
    .where(
      and(
        eq(tutoringConciergeThread.id, threadId),
        eq(tutoringConciergeThread.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 1. Insert user message
  await db.insert(tutoringConciergeMessage).values({
    threadId,
    role: 'user',
    content: parsed.data.message,
  });

  // 2. Load history cho planner
  const allMessages = await db
    .select()
    .from(tutoringConciergeMessage)
    .where(eq(tutoringConciergeMessage.threadId, threadId))
    .orderBy(asc(tutoringConciergeMessage.createdAt));

  const history: ConciergeHistory = allMessages
    .slice(-MAX_HISTORY_FOR_PLANNER)
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

  // 3. Auto-title nếu chưa có (sau msg đầu tiên user gửi)
  const isFirstUserMsg = allMessages.filter((m) => m.role === 'user').length === 1;
  if (isFirstUserMsg && !thread.title) {
    const title = parsed.data.message.slice(0, 60);
    await db
      .update(tutoringConciergeThread)
      .set({ title, lastMessageAt: new Date() })
      .where(eq(tutoringConciergeThread.id, threadId));
  } else {
    await db
      .update(tutoringConciergeThread)
      .set({ lastMessageAt: new Date() })
      .where(eq(tutoringConciergeThread.id, threadId));
  }

  // 4. SSE stream — Planner → Search (nếu cần) → Response stream
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const userId = session.user.id;
  const cachedFilters = (thread.extractedFilters ?? undefined) as
    | ConciergeFilters
    | undefined;
  const userMessage = parsed.data.message;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      let actionToPersist: ConciergeAction = {
        type: 'clarify',
        question: 'Bạn muốn học môn gì?',
        chips: ['Toán', 'Tiếng Anh', 'Lập trình', 'Vật lý'],
        role: 'student',
      };
      let tutorResults: Awaited<ReturnType<typeof hybridSearchTutors>> = [];
      let requestResults: Awaited<ReturnType<typeof hybridSearchRequests>> = [];
      const relaxedNotes: string[] = [];
      // V5.1 deep Q&A state
      let tutorDetailFound = false;
      let tutorDetailName: string | null = null;
      let tutorDetailAskAbout:
        | 'reviews'
        | 'availability'
        | 'price'
        | 'profile'
        | 'other'
        | undefined;
      // V5.2 FAQ state
      let faqEntry: FaqEntry | null = null;
      // V6 Library state
      let libraryDocs: Array<{
        id: string;
        title: string;
        subjectSlug: string;
        level: string;
        grade: number | null;
        docType: string;
        fileFormat: string;
        pageCount: number | null;
        previewThumbUrl: string | null;
        ratingAvg: number | null;
        ratingCount: number;
        workspaceImportCount: number;
        badges: string[];
      }> = [];

      // Pull shown tutor IDs from previous assistant messages — context cho
      // tutor_detail fuzzy match ("cô Mai" trong tutor đã hiện ra).
      const lastShownTutorIds: string[] = (() => {
        for (let i = allMessages.length - 1; i >= 0; i--) {
          const m = allMessages[i];
          if (!m || m.role !== 'assistant') continue;
          const meta = m.metadata as
            | { tutorIds?: string[] }
            | null
            | undefined;
          if (meta?.tutorIds && meta.tutorIds.length > 0) {
            return meta.tutorIds;
          }
        }
        return [];
      })();

      try {
        // Step 1: Planner — fail-soft thành default clarify
        let action: ConciergeAction;
        try {
          action = await planConciergeStep({
            history,
            currentFilters: cachedFilters,
            userId,
            plan,
          });
        } catch (err) {
          console.error('[concierge.planner]', err);
          action = actionToPersist;
        }
        actionToPersist = action;

        sendEvent('action', action);

        // Step 2a: faq action — match knowledge base + emit
        if (action.type === 'faq') {
          faqEntry = matchFaq(action.query, action.role);
          if (faqEntry) {
            sendEvent('faq', { entry: faqEntry });
          }
          actionToPersist = action;
        }
        // Step 2b: library_search — V6 hybrid search library_doc + emit
        else if (action.type === 'library_search') {
          const libResult = await hybridSearchLibraryDocs({
            query: action.query,
            filters: {
              subjectSlug: action.filters.subjectSlug,
              level: action.filters.level,
              grade: action.filters.grade ? [action.filters.grade] : undefined,
              docType: action.filters.docType,
            },
            sort: 'top',
            limit: 5,
          });
          libraryDocs = libResult.items.map((d) => ({
            id: d.id,
            title: d.title,
            subjectSlug: d.subjectSlug,
            level: d.level,
            grade: d.grade,
            docType: d.docType,
            fileFormat: d.fileFormat,
            pageCount: d.pageCount,
            previewThumbUrl: d.previewThumbUrl,
            ratingAvg: d.ratingAvg,
            ratingCount: d.ratingCount,
            workspaceImportCount: d.workspaceImportCount,
            badges: d.badges,
          }));
          if (libraryDocs.length > 0) {
            sendEvent('library_docs', { docs: libraryDocs });
          }
          actionToPersist = action;
        }
        // Step 2c: tutor_detail action — resolve tutor + emit detail
        else if (action.type === 'tutor_detail') {
          tutorDetailAskAbout = action.askAbout;
          const detail = await resolveTutorDetail({
            tutorRef: action.tutorRef,
            shownTutorIds: lastShownTutorIds,
            reviewLimit: 5,
          });
          if (detail) {
            tutorDetailFound = true;
            tutorDetailName = detail.name;
            sendEvent('tutor_detail', {
              detail,
              askAbout: action.askAbout,
            });
          }
          actionToPersist = action;
        }
        // Step 2b: Khi search → gọi hybrid search + merge filter cũ
        else if (action.type === 'search') {
          const role = action.role;
          const searchTarget = action.searchTarget;
          const { valid, cleaned } = validateFilters(action.filters);
          if (!valid) {
            // Fallback clarify nếu planner trả invalid
            actionToPersist = {
              type: 'clarify',
              question:
                role === 'tutor'
                  ? 'Bạn dạy môn gì để mình tìm yêu cầu phù hợp?'
                  : 'Bạn cho mình biết môn học cụ thể (vd: Toán THPT)?',
              chips: ['Toán THPT', 'IELTS', 'Lập trình'],
              role,
            };
            sendEvent('action', actionToPersist);
          } else if (searchTarget === 'request') {
            // Tutor side — search tutor_request (student yêu cầu OPEN).
            const mergedFilters: ConciergeFilters = {
              ...cachedFilters,
              ...cleaned,
              keywords: [
                ...(cachedFilters?.keywords ?? []),
                ...(cleaned.keywords ?? []),
              ],
            };
            await db
              .update(tutoringConciergeThread)
              .set({ extractedFilters: mergedFilters })
              .where(eq(tutoringConciergeThread.id, threadId));

            const searchQuery = [
              ...(mergedFilters.keywords ?? []),
              userMessage,
            ].join(' ');

            const reqResults = await hybridSearchRequests({
              query: searchQuery,
              filters: {
                subjectSlug: mergedFilters.subjectSlug,
                level: mergedFilters.level,
                modality: mergedFilters.modality,
                budgetMinVnd: mergedFilters.budgetMaxVnd, // reuse field — tutor mong tối thiểu
              },
              limit: 5,
            });

            // Relax level nếu 0
            requestResults = reqResults;
            if (requestResults.length === 0 && mergedFilters.level) {
              requestResults = await hybridSearchRequests({
                query: searchQuery,
                filters: { subjectSlug: mergedFilters.subjectSlug },
                limit: 5,
              });
              if (requestResults.length > 0) relaxedNotes.push('cấp độ');
            }

            if (requestResults.length === 0) {
              actionToPersist = {
                type: 'no_match',
                role,
                searchTarget,
                filters: mergedFilters,
              };
              sendEvent('action', actionToPersist);
            } else {
              sendEvent(
                'requests',
                requestResults.map((r) => ({
                  id: r.id,
                  studentId: r.studentId,
                  studentName: r.studentName,
                  title: r.title,
                  description: r.description.slice(0, 180),
                  subjectSlug: r.subjectSlug,
                  level: r.level,
                  budgetVnd: r.budgetVnd,
                  modality: r.modality,
                  urgency: r.urgency,
                  createdAt: r.createdAt,
                  score: r.score,
                })),
              );
              if (relaxedNotes.length > 0) {
                sendEvent('relaxed', { dropped: relaxedNotes });
              }
            }
          } else {
            // Merge với filter cached (giữ keywords cũ nếu có)
            const mergedFilters: ConciergeFilters = {
              ...cachedFilters,
              ...cleaned,
              keywords: [
                ...(cachedFilters?.keywords ?? []),
                ...(cleaned.keywords ?? []),
              ],
            };

            // Cache filter vào thread
            await db
              .update(tutoringConciergeThread)
              .set({ extractedFilters: mergedFilters })
              .where(eq(tutoringConciergeThread.id, threadId));

            // Build search query từ keywords + last user msg
            const searchQuery = [
              ...(mergedFilters.keywords ?? []),
              userMessage,
            ].join(' ');

            // Step 2a: Search với full filter
            tutorResults = await hybridSearchTutors({
              query: searchQuery,
              filters: {
                subjectSlug: mergedFilters.subjectSlug,
                level: mergedFilters.level,
                modality: mergedFilters.modality,
                budgetMaxVnd: mergedFilters.budgetMaxVnd,
              },
              limit: 5,
            });

            // Step 2b: Graceful relax — nếu 0 result, thử drop modality + budget.
            // User vẫn nên thấy tutor gần khớp (cùng subject+level) thay vì "no_match" cứng.
            if (tutorResults.length === 0 && (mergedFilters.modality || mergedFilters.budgetMaxVnd)) {
              tutorResults = await hybridSearchTutors({
                query: searchQuery,
                filters: {
                  subjectSlug: mergedFilters.subjectSlug,
                  level: mergedFilters.level,
                },
                limit: 5,
              });
              if (tutorResults.length > 0) {
                if (mergedFilters.modality) relaxedNotes.push('hình thức');
                if (mergedFilters.budgetMaxVnd) relaxedNotes.push('ngân sách');
              }
            }

            // Step 2c: Vẫn 0 → thử drop level (giữ subject)
            if (tutorResults.length === 0 && mergedFilters.level) {
              tutorResults = await hybridSearchTutors({
                query: searchQuery,
                filters: { subjectSlug: mergedFilters.subjectSlug },
                limit: 5,
              });
              if (tutorResults.length > 0) relaxedNotes.push('cấp độ');
            }

            if (tutorResults.length === 0) {
              actionToPersist = {
                type: 'no_match',
                role,
                searchTarget,
                filters: mergedFilters,
              };
              sendEvent('action', actionToPersist);
            } else {
              // Generate match reason CHỈ khi RRF semantic match (score > 0).
              // Khi fallback rating-sort (score === 0), bio không liên quan
              // user query → LLM dễ hallucinate. Skip cho cost + correctness.
              const reasons = new Map<string, string>();
              const semanticHits = tutorResults.filter((t) => t.score > 0);
              if (semanticHits.length > 0) {
                try {
                  const llmReasons = await generateMatchReasons({
                    tutors: semanticHits,
                    userQuery: userMessage,
                    filters: mergedFilters,
                    userId,
                    plan,
                  });
                  llmReasons.forEach((v, k) => reasons.set(k, v));
                } catch (err) {
                  console.error('[concierge.match-reason]', err);
                }
              }
              // Fallback reasons cho tutor có score===0 (deterministic).
              for (const t of tutorResults) {
                if (reasons.has(t.id)) continue;
                const subjPart = mergedFilters.subjectSlug
                  ? SUBJECT_BY_SLUG[mergedFilters.subjectSlug]?.name ?? ''
                  : '';
                const rating = t.ratingAvg
                  ? `${t.ratingAvg.toFixed(1)}★`
                  : 'mới (chưa có review)';
                reasons.set(t.id, `Gia sư ${subjPart} · ${rating}`);
              }
              sendEvent(
                'tutors',
                tutorResults.map((t) => ({
                  id: t.id,
                  userId: t.userId,
                  headline: t.headline,
                  hourlyRateVnd: t.hourlyRateVnd,
                  modality: t.modality,
                  avatarUrl: t.avatarUrl,
                  ratingAvg: t.ratingAvg,
                  ratingCount: t.ratingCount,
                  sessionsCompleted: t.sessionsCompleted,
                  verificationStatus: t.verificationStatus,
                  score: t.score,
                  matchReason: reasons.get(t.id),
                })),
              );
              // Báo client filter đã relax → render banner
              if (relaxedNotes.length > 0) {
                sendEvent('relaxed', { dropped: relaxedNotes });
              }
            }
          }
        }

        // Step 3: Deterministic response text — KHÔNG gọi LLM thứ 2.
        const resultCount =
          actionToPersist.type === 'search' &&
          actionToPersist.searchTarget === 'request'
            ? requestResults.length
            : tutorResults.length;
        const fullText = buildResponseText(
          actionToPersist,
          resultCount,
          relaxedNotes,
          tutorDetailName,
          tutorDetailAskAbout,
          tutorDetailFound,
          faqEntry,
          libraryDocs.length,
        );
        sendEvent('text', fullText);

        // Step 4: Persist assistant message
        await db.insert(tutoringConciergeMessage).values({
          threadId,
          role: 'assistant',
          content: fullText,
          metadata: {
            action: actionToPersist.type === 'clarify' ? 'clarify' : 'search',
            tutorIds: tutorResults.map((t) => t.id),
            filters:
              actionToPersist.type === 'search' || actionToPersist.type === 'no_match'
                ? (actionToPersist.filters as Record<string, unknown>)
                : undefined,
            total: resultCount,
            // Cast cho schema narrow — V5/V5.1/V5.2 metadata mở rộng.
            ...({
              role:
                actionToPersist.type !== 'clarify'
                  ? actionToPersist.role
                  : undefined,
              searchTarget:
                actionToPersist.type === 'search' ||
                actionToPersist.type === 'no_match'
                  ? actionToPersist.searchTarget
                  : undefined,
              requestIds: requestResults.map((r) => r.id),
              tutorDetailRef:
                actionToPersist.type === 'tutor_detail'
                  ? actionToPersist.tutorRef
                  : undefined,
              tutorDetailFound:
                actionToPersist.type === 'tutor_detail' ? tutorDetailFound : undefined,
              // V5.2: lưu faqId để GET hydrate đúng FAQ entry
              faqId: faqEntry?.id,
            } as Record<string, unknown>),
          },
        });

        sendEvent('done', { ok: true });
      } catch (err) {
        console.error('[concierge.stream]', err);
        // Fallback: vẫn emit text để bubble không trống
        const fallbackText =
          err instanceof Error
            ? `⚠ Có lỗi khi xử lý: ${err.message}. Bạn thử gõ lại nhé.`
            : '⚠ Có lỗi, thử lại sau nhé.';
        sendEvent('text', fallbackText);
        sendEvent('error', {
          message: err instanceof Error ? err.message : 'Unknown',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
