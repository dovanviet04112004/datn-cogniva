/**
 * TutorsTab — browse grid của tutor PUBLISHED.
 *
 * Server component fetch trực tiếp Drizzle. Filter qua searchParams:
 * subject / level / modality / minRate / maxRate.
 *
 * Cache: kết quả browse là DATA CÔNG KHAI (giống mọi visitor cùng filter), đổi chậm
 * (profile gia sư/rating cập nhật thưa) → cache-aside Redis TTL-only 600s theo
 * `filterHash` (chuẩn hoá subject/level/modality/rate/sort/page). Không invalidator:
 * lệch ≤ 10 phút chấp nhận được cho browse list. dbReplica (read thuần).
 */
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Users } from 'lucide-react';

import {
  dbReplica,
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_BY_SLUG,
  tutorProfile,
  tutorSubject,
  user as userTable,
} from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { EmptyState } from '@/components/layout/empty-state';
import { ListToolbar, type ActiveFilterChip } from '@/components/tutoring/list-toolbar';
import { Pagination } from '@/components/tutoring/pagination';
import { TutorCard, type TutorCardData } from '@/components/tutoring/tutor-card';
import { TutorFilters } from '@/components/tutoring/tutor-filters';

const TUTOR_SORT_OPTIONS = [
  { value: 'top', label: 'Đề xuất' },
  { value: 'rating', label: 'Rating cao' },
  { value: 'price-low', label: 'Giá thấp' },
  { value: 'price-high', label: 'Giá cao' },
  { value: 'newest', label: 'Mới nhất' },
  { value: 'sessions', label: 'Nhiều buổi nhất' },
];

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export async function TutorsTab({
  sp,
}: {
  sp: {
    subject?: string;
    level?: string;
    modality?: string;
    minRate?: string;
    maxRate?: string;
    sort?: string;
    page?: string;
    per?: string;
    tab?: string;
  };
}) {
  // Parse page (1-indexed) + per (page size)
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = parsePageSize(sp.per);
  const offset = (page - 1) * pageSize;
  const conds = [eq(tutorProfile.status, 'PUBLISHED')];
  if (sp.modality) conds.push(eq(tutorProfile.modality, sp.modality));
  if (sp.minRate) {
    const v = parseInt(sp.minRate, 10);
    if (!isNaN(v)) conds.push(gte(tutorProfile.hourlyRateVnd, v));
  }
  if (sp.maxRate) {
    const v = parseInt(sp.maxRate, 10);
    if (!isNaN(v)) conds.push(lte(tutorProfile.hourlyRateVnd, v));
  }
  if (sp.subject) {
    conds.push(
      sql`EXISTS (
        SELECT 1 FROM ${tutorSubject}
        WHERE ${tutorSubject.tutorId} = ${tutorProfile.id}
          AND ${tutorSubject.subjectSlug} = ${sp.subject}
          ${sp.level ? sql`AND ${tutorSubject.level} = ${sp.level}` : sql``}
      )`,
    );
  }

  const sort = sp.sort ?? 'top';
  const orderClause = (() => {
    switch (sort) {
      case 'rating':
        return [
          desc(sql`COALESCE(${tutorProfile.ratingAvg}, 0)`),
          desc(tutorProfile.ratingCount),
        ];
      case 'price-low':
        return [asc(tutorProfile.hourlyRateVnd)];
      case 'price-high':
        return [desc(tutorProfile.hourlyRateVnd)];
      case 'newest':
        return [desc(tutorProfile.createdAt)];
      case 'sessions':
        return [desc(tutorProfile.sessionsCompleted)];
      case 'top':
      default:
        // Default: weighted score — rating + sessions + verified bonus
        return [
          desc(
            sql`COALESCE(${tutorProfile.ratingAvg}, 0) * 100
              + LEAST(${tutorProfile.sessionsCompleted}, 200)
              + CASE WHEN ${tutorProfile.verificationStatus} = 'KYC_VERIFIED' THEN 50 ELSE 0 END
              + CASE WHEN ${tutorProfile.instantBookEnabled} THEN 30 ELSE 0 END`,
          ),
        ];
    }
  })();

  // filterHash — chuẩn hoá MỌI biến ảnh hưởng kết quả query (subject/level/modality/
  // rate/sort + page/pageSize) thành 1 chuỗi ổn định làm key cache. Cùng filter →
  // cùng key → chia sẻ cache giữa các visitor. Thiếu = 'all' để 2 trạng thái khác
  // nhau (không lọc vs lọc giá trị "all") không đụng key.
  const filterHash = [
    `s=${sp.subject ?? 'all'}`,
    `l=${sp.level ?? 'all'}`,
    `m=${sp.modality ?? 'all'}`,
    `min=${sp.minRate ?? ''}`,
    `max=${sp.maxRate ?? ''}`,
    `sort=${sort}`,
    `p=${page}`,
    `per=${pageSize}`,
  ].join('|');

  // Run count + paginated rows trong parallel — giảm latency. Bọc trong cache-aside
  // (TTL 600s): rows + countRow đều JSON-serializable (subjects = json_agg, KHÔNG
  // select cột Date nào) → không cần re-hydrate Date sau cache.
  const { countRow, rows } = await cached(ck.tutorsBrowse(filterHash), 600, async () => {
    const [countRow, rows] = await Promise.all([
    dbReplica
      .select({ n: count() })
      .from(tutorProfile)
      .where(and(...conds))
      .then((r) => r[0]),
    dbReplica
      .select({
        id: tutorProfile.id,
        headline: tutorProfile.headline,
        hourlyRateVnd: tutorProfile.hourlyRateVnd,
        modality: tutorProfile.modality,
        avatarUrl: tutorProfile.avatarUrl,
        ratingAvg: tutorProfile.ratingAvg,
        ratingCount: tutorProfile.ratingCount,
        sessionsCompleted: tutorProfile.sessionsCompleted,
        verificationStatus: tutorProfile.verificationStatus,
        instantBookEnabled: tutorProfile.instantBookEnabled,
        trialSessionEnabled: tutorProfile.trialSessionEnabled,
        avgResponseMinutes: tutorProfile.avgResponseMinutes,
        userId: tutorProfile.userId,
        userName: userTable.name,
        userImage: userTable.image,
        subjects: sql<
          Array<{ slug: string; level: string; verifiedAt: string | null }>
        >`COALESCE(
          (SELECT json_agg(json_build_object(
            'slug', ${tutorSubject.subjectSlug},
            'level', ${tutorSubject.level},
            'verifiedAt', ${tutorSubject.verifiedAt}
          ))
          FROM ${tutorSubject}
          WHERE ${tutorSubject.tutorId} = ${tutorProfile.id}),
          '[]'::json
        )`,
      })
      .from(tutorProfile)
      .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
      .where(and(...conds))
      .orderBy(...orderClause)
      .limit(pageSize)
      .offset(offset),
    ]);
    return { countRow, rows };
  });

  const totalCount = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const tutors: TutorCardData[] = rows.map((r) => ({
    id: r.id,
    headline: r.headline,
    hourlyRateVnd: r.hourlyRateVnd,
    modality: r.modality,
    avatarUrl: r.avatarUrl ?? r.userImage,
    name: r.userName,
    ratingAvg: r.ratingAvg ? Number(r.ratingAvg) : null,
    ratingCount: r.ratingCount,
    sessionsCompleted: r.sessionsCompleted,
    verificationStatus: r.verificationStatus,
    instantBookEnabled: r.instantBookEnabled,
    trialSessionEnabled: r.trialSessionEnabled ?? undefined,
    avgResponseMinutes: r.avgResponseMinutes,
    subjects: r.subjects.slice(0, 3).map((s) => ({
      slug: s.slug,
      level: s.level,
      verified: s.verifiedAt !== null,
      name: SUBJECT_BY_SLUG[s.slug]?.name ?? s.slug,
      emoji: SUBJECT_BY_SLUG[s.slug]?.emoji ?? '📚',
    })),
  }));

  // Build active filter chips từ searchParams
  const activeFilters: ActiveFilterChip[] = [];
  if (sp.subject) {
    const s = SUBJECT_BY_SLUG[sp.subject];
    activeFilters.push({
      key: 'subject',
      label: s ? `${s.emoji} ${s.name}` : sp.subject,
    });
  }
  if (sp.level) {
    activeFilters.push({
      key: 'level',
      label: LEVEL_NAMES[sp.level as keyof typeof LEVEL_NAMES] ?? sp.level,
    });
  }
  if (sp.modality) {
    activeFilters.push({
      key: 'modality',
      label: MODALITY_NAMES[sp.modality] ?? sp.modality,
    });
  }
  if (sp.minRate) {
    activeFilters.push({ key: 'minRate', label: `≥${Math.round(+sp.minRate / 1000)}K` });
  }
  if (sp.maxRate) {
    activeFilters.push({ key: 'maxRate', label: `≤${Math.round(+sp.maxRate / 1000)}K` });
  }

  // preservedParams = mọi searchParam hiện tại trừ page/per (Pagination tự
  // append page/per khi cần). Plain object → serializable qua RSC boundary.
  const preservedParams: Record<string, string> = {};
  if (sp.tab) preservedParams.tab = sp.tab;
  if (sp.subject) preservedParams.subject = sp.subject;
  if (sp.level) preservedParams.level = sp.level;
  if (sp.modality) preservedParams.modality = sp.modality;
  if (sp.minRate) preservedParams.minRate = sp.minRate;
  if (sp.maxRate) preservedParams.maxRate = sp.maxRate;
  if (sp.sort) preservedParams.sort = sp.sort;

  return (
    <div className="space-y-6">
      <TutorFilters initial={sp} />

      <section className="space-y-4">
        <ListToolbar
          title="Gia sư"
          total={totalCount}
          activeFilters={activeFilters}
          sortOptions={TUTOR_SORT_OPTIONS}
          currentSort={sort}
        />
        {tutors.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Chưa có gia sư phù hợp"
            description="Thử bỏ filter hoặc đăng yêu cầu — gia sư sẽ đề xuất ngược cho bạn."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tutors.map((t) => (
                <TutorCard key={t.id} tutor={t} />
              ))}
            </div>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalCount}
              pageSize={pageSize}
              defaultPageSize={DEFAULT_PAGE_SIZE}
              basePath="/tutoring"
              preservedParams={preservedParams}
            />
          </>
        )}
      </section>
    </div>
  );
}
