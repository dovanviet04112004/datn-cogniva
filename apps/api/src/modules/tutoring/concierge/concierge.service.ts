import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

import type { AuthUser } from '../../../common/auth/session.types';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HybridSearchService } from '../../library/search/hybrid-search.service';
import { SUBJECT_BY_SLUG } from '../../../common/subject-taxonomy';
import {
  ConciergeAgentService,
  validateFilters,
  type ConciergeAction,
  type ConciergeFilters,
  type ConciergeHistory,
  type Plan,
} from './concierge-agent.service';
import { FAQ_ENTRIES, matchFaq, type FaqEntry } from './concierge-faq';
import { TutorDetailResolverService } from './tutor-detail-resolver.service';
import {
  TutorSearchService,
  type HybridSearchResult,
  type RequestSearchResult,
} from './tutor-search.service';

const MAX_THREADS = 20;
const MAX_HISTORY_FOR_PLANNER = 8;

type MessageMeta = {
  action?: string;
  role?: 'student' | 'tutor';
  searchTarget?: 'tutor' | 'request';
  tutorIds?: string[];
  requestIds?: string[];
  faqId?: string;
  filters?: Record<string, unknown>;
  total?: number;
};

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
      ? (SUBJECT_BY_SLUG[action.filters.subjectSlug]?.name ?? '')
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
  const isTutorSide = action.searchTarget === 'request';
  const noun = isTutorSide ? 'yêu cầu' : 'gia sư';
  const subjectName = action.filters.subjectSlug
    ? (SUBJECT_BY_SLUG[action.filters.subjectSlug]?.name ?? action.filters.subjectSlug)
    : null;

  if (action.type === 'no_match') {
    const altCta = isTutorSide
      ? 'Bạn thử mở rộng môn / cấp độ, hoặc tự browse tab "Yêu cầu" nhé.'
      : 'Bạn thử đổi sang môn khác, hoặc đăng yêu cầu để gia sư đề xuất ngược nhé.';
    return `Hmm, mình chưa tìm thấy ${noun} khớp với ${subjectName ?? 'môn này'} (đã thử cả mở rộng bộ lọc). ${altCta}`;
  }

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
    relaxedNotes.length > 0 ? ` Đã mở rộng ${relaxedNotes.join(' · ')} vì kết quả strict ít.` : '';
  const ctaWord = isTutorSide
    ? 'Bấm card để xem chi tiết & ứng tuyển.'
    : 'Bấm card để xem profile. Gõ "review về cô X" để xem feedback chi tiết.';
  return `Tìm thấy ${resultCount} ${noun}${filterPhrase}.${relaxedSuffix} ${sortReason} ${ctaWord}`;
}

@Injectable()
export class ConciergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: ConciergeAgentService,
    private readonly tutorSearch: TutorSearchService,
    private readonly detailResolver: TutorDetailResolverService,
    private readonly librarySearch: HybridSearchService,
  ) {}

  async listThreads(userId: string) {
    const threads = await this.prisma.tutoring_concierge_thread.findMany({
      where: { user_id: userId },
      orderBy: { last_message_at: 'desc' },
      take: MAX_THREADS,
      select: {
        id: true,
        title: true,
        last_message_at: true,
        extracted_filters: true,
        created_at: true,
      },
    });

    return {
      threads: threads.map((t) => ({
        id: t.id,
        title: t.title,
        lastMessageAt: t.last_message_at,
        extractedFilters: t.extracted_filters,
        createdAt: t.created_at,
      })),
    };
  }

  async createThread(userId: string) {
    const thread = await this.prisma.tutoring_concierge_thread.create({
      data: { id: randomUUID(), user_id: userId },
    });

    return {
      thread: {
        id: thread.id,
        userId: thread.user_id,
        title: thread.title,
        lastMessageAt: thread.last_message_at,
        extractedFilters: thread.extracted_filters,
        createdAt: thread.created_at,
      },
    };
  }

  async listMessages(userId: string, threadId: string) {
    const thread = await this.prisma.tutoring_concierge_thread.findFirst({
      where: { id: threadId, user_id: userId },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException({ error: 'Not found' });

    const messages = await this.prisma.tutoring_concierge_message.findMany({
      where: { thread_id: threadId },
      orderBy: { created_at: 'asc' },
    });

    const allTutorIds = new Set<string>();
    const allRequestIds = new Set<string>();
    for (const m of messages) {
      const meta = m.metadata as MessageMeta | null | undefined;
      for (const id of meta?.tutorIds ?? []) allTutorIds.add(id);
      for (const id of meta?.requestIds ?? []) allRequestIds.add(id);
    }

    const [tutorRows, requestRows] = await Promise.all([
      allTutorIds.size > 0
        ? this.prisma.tutor_profile.findMany({
            where: { id: { in: [...allTutorIds] } },
            select: {
              id: true,
              user_id: true,
              headline: true,
              hourly_rate_vnd: true,
              modality: true,
              avatar_url: true,
              rating_avg: true,
              rating_count: true,
              sessions_completed: true,
              verification_status: true,
              user: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      allRequestIds.size > 0
        ? this.prisma.tutor_request.findMany({
            where: { id: { in: [...allRequestIds] } },
            select: {
              id: true,
              student_id: true,
              title: true,
              description: true,
              subject_slug: true,
              level: true,
              budget_vnd: true,
              modality: true,
              urgency: true,
              created_at: true,
              user: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const tutorMap = new Map(tutorRows.map((t) => [t.id, t]));
    const requestMap = new Map(requestRows.map((r) => [r.id, r]));
    const faqMap = new Map(FAQ_ENTRIES.map((f) => [f.id, f]));

    const enriched = messages.map((m) => {
      const meta = m.metadata as MessageMeta | null | undefined;

      const tutors = (meta?.tutorIds ?? [])
        .map((id) => tutorMap.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => ({
          id: t.id,
          userId: t.user_id,
          headline: t.headline,
          hourlyRateVnd: t.hourly_rate_vnd,
          modality: t.modality,
          avatarUrl: t.avatar_url,
          ratingAvg: t.rating_avg ? Number(t.rating_avg) : null,
          ratingCount: t.rating_count,
          sessionsCompleted: t.sessions_completed,
          verificationStatus: t.verification_status,
          name: t.user.name,
          score: 0,
          matchReason: undefined,
        }));

      const requests = (meta?.requestIds ?? [])
        .map((id) => requestMap.get(id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({
          id: r.id,
          studentId: r.student_id,
          studentName: r.user.name,
          title: r.title,
          description: r.description.slice(0, 180),
          subjectSlug: r.subject_slug,
          level: r.level,
          budgetVnd: r.budget_vnd,
          modality: r.modality,
          urgency: r.urgency,
          createdAt: r.created_at.toISOString(),
          score: 0,
        }));

      const faqEntry = meta?.faqId ? (faqMap.get(meta.faqId) ?? null) : null;

      return {
        id: m.id,
        threadId: m.thread_id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
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

    return { messages: enriched };
  }

  async postMessage(user: AuthUser, threadId: string, message: string, res: Response) {
    const thread = await this.prisma.tutoring_concierge_thread.findFirst({
      where: { id: threadId, user_id: user.id },
    });
    if (!thread) throw new NotFoundException({ error: 'Not found' });

    await this.prisma.tutoring_concierge_message.create({
      data: {
        id: randomUUID(),
        thread_id: threadId,
        role: 'user',
        content: message,
      },
    });

    const allMessages = await this.prisma.tutoring_concierge_message.findMany({
      where: { thread_id: threadId },
      orderBy: { created_at: 'asc' },
    });

    const history: ConciergeHistory = allMessages.slice(-MAX_HISTORY_FOR_PLANNER).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    const isFirstUserMsg = allMessages.filter((m) => m.role === 'user').length === 1;
    if (isFirstUserMsg && !thread.title) {
      const title = message.slice(0, 60);
      await this.prisma.tutoring_concierge_thread.updateMany({
        where: { id: threadId },
        data: { title, last_message_at: new Date() },
      });
    } else {
      await this.prisma.tutoring_concierge_thread.updateMany({
        where: { id: threadId },
        data: { last_message_at: new Date() },
      });
    }

    const plan = (user.plan ?? 'FREE') as Plan;
    const userId = user.id;
    const cachedFilters = (thread.extracted_filters ?? undefined) as ConciergeFilters | undefined;
    const userMessage = message;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let actionToPersist: ConciergeAction = {
      type: 'clarify',
      question: 'Bạn muốn học môn gì?',
      chips: ['Toán', 'Tiếng Anh', 'Lập trình', 'Vật lý'],
      role: 'student',
    };
    let tutorResults: HybridSearchResult[] = [];
    let requestResults: RequestSearchResult[] = [];
    const relaxedNotes: string[] = [];
    let tutorDetailFound = false;
    let tutorDetailName: string | null = null;
    let tutorDetailAskAbout: 'reviews' | 'availability' | 'price' | 'profile' | 'other' | undefined;
    let faqEntry: FaqEntry | null = null;
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

    const lastShownTutorIds: string[] = (() => {
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const m = allMessages[i];
        if (!m || m.role !== 'assistant') continue;
        const meta = m.metadata as { tutorIds?: string[] } | null | undefined;
        if (meta?.tutorIds && meta.tutorIds.length > 0) {
          return meta.tutorIds;
        }
      }
      return [];
    })();

    try {
      let action: ConciergeAction;
      try {
        action = await this.agent.planConciergeStep({
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

      if (action.type === 'faq') {
        faqEntry = matchFaq(action.query, action.role);
        if (faqEntry) {
          sendEvent('faq', { entry: faqEntry });
        }
        actionToPersist = action;
      } else if (action.type === 'library_search') {
        const libResult = await this.librarySearch.hybridSearchLibraryDocs({
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
      } else if (action.type === 'tutor_detail') {
        tutorDetailAskAbout = action.askAbout;
        const detail = await this.detailResolver.resolveTutorDetail({
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
      } else if (action.type === 'search') {
        const role = action.role;
        const searchTarget = action.searchTarget;
        const { valid, cleaned } = validateFilters(action.filters);
        if (!valid) {
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
          const mergedFilters: ConciergeFilters = {
            ...cachedFilters,
            ...cleaned,
            keywords: [...(cachedFilters?.keywords ?? []), ...(cleaned.keywords ?? [])],
          };
          await this.prisma.tutoring_concierge_thread.updateMany({
            where: { id: threadId },
            data: { extracted_filters: mergedFilters as Prisma.InputJsonValue },
          });

          const searchQuery = [...(mergedFilters.keywords ?? []), userMessage].join(' ');

          const reqResults = await this.tutorSearch.hybridSearchRequests({
            query: searchQuery,
            filters: {
              subjectSlug: mergedFilters.subjectSlug,
              level: mergedFilters.level,
              modality: mergedFilters.modality,
              budgetMinVnd: mergedFilters.budgetMaxVnd,
            },
            limit: 5,
          });

          requestResults = reqResults;
          if (requestResults.length === 0 && mergedFilters.level) {
            requestResults = await this.tutorSearch.hybridSearchRequests({
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
          const mergedFilters: ConciergeFilters = {
            ...cachedFilters,
            ...cleaned,
            keywords: [...(cachedFilters?.keywords ?? []), ...(cleaned.keywords ?? [])],
          };

          await this.prisma.tutoring_concierge_thread.updateMany({
            where: { id: threadId },
            data: { extracted_filters: mergedFilters as Prisma.InputJsonValue },
          });

          const searchQuery = [...(mergedFilters.keywords ?? []), userMessage].join(' ');

          tutorResults = await this.tutorSearch.hybridSearchTutors({
            query: searchQuery,
            filters: {
              subjectSlug: mergedFilters.subjectSlug,
              level: mergedFilters.level,
              modality: mergedFilters.modality,
              budgetMaxVnd: mergedFilters.budgetMaxVnd,
            },
            limit: 5,
          });

          if (tutorResults.length === 0 && (mergedFilters.modality || mergedFilters.budgetMaxVnd)) {
            tutorResults = await this.tutorSearch.hybridSearchTutors({
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

          if (tutorResults.length === 0 && mergedFilters.level) {
            tutorResults = await this.tutorSearch.hybridSearchTutors({
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
            const reasons = new Map<string, string>();
            const semanticHits = tutorResults.filter((t) => t.score > 0);
            if (semanticHits.length > 0) {
              try {
                const llmReasons = await this.agent.generateMatchReasons({
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
            for (const t of tutorResults) {
              if (reasons.has(t.id)) continue;
              const subjPart = mergedFilters.subjectSlug
                ? (SUBJECT_BY_SLUG[mergedFilters.subjectSlug]?.name ?? '')
                : '';
              const rating = t.ratingAvg ? `${t.ratingAvg.toFixed(1)}★` : 'mới (chưa có review)';
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
            if (relaxedNotes.length > 0) {
              sendEvent('relaxed', { dropped: relaxedNotes });
            }
          }
        }
      }

      const resultCount =
        actionToPersist.type === 'search' && actionToPersist.searchTarget === 'request'
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

      const assistantMeta = JSON.parse(
        JSON.stringify({
          action: actionToPersist.type === 'clarify' ? 'clarify' : 'search',
          tutorIds: tutorResults.map((t) => t.id),
          filters:
            actionToPersist.type === 'search' || actionToPersist.type === 'no_match'
              ? (actionToPersist.filters as Record<string, unknown>)
              : undefined,
          total: resultCount,
          ...({
            role: actionToPersist.type !== 'clarify' ? actionToPersist.role : undefined,
            searchTarget:
              actionToPersist.type === 'search' || actionToPersist.type === 'no_match'
                ? actionToPersist.searchTarget
                : undefined,
            requestIds: requestResults.map((r) => r.id),
            tutorDetailRef:
              actionToPersist.type === 'tutor_detail' ? actionToPersist.tutorRef : undefined,
            tutorDetailFound:
              actionToPersist.type === 'tutor_detail' ? tutorDetailFound : undefined,
            faqId: faqEntry?.id,
          } as Record<string, unknown>),
        }),
      ) as Prisma.InputJsonValue;
      await this.prisma.tutoring_concierge_message.create({
        data: {
          id: randomUUID(),
          thread_id: threadId,
          role: 'assistant',
          content: fullText,
          metadata: assistantMeta,
        },
      });

      sendEvent('done', { ok: true });
    } catch (err) {
      console.error('[concierge.stream]', err);
      const fallbackText =
        err instanceof Error
          ? `⚠ Có lỗi khi xử lý: ${err.message}. Bạn thử gõ lại nhé.`
          : '⚠ Có lỗi, thử lại sau nhé.';
      sendEvent('text', fallbackText);
      sendEvent('error', {
        message: err instanceof Error ? err.message : 'Unknown',
      });
    } finally {
      res.end();
    }
  }
}
