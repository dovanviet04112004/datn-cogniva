import { Users } from 'lucide-react';

import { LEVEL_NAMES, MODALITY_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

import { apiServer } from '@/lib/api-server';
import { EmptyState } from '@/components/layout/empty-state';
import { ListToolbar, type ActiveFilterChip } from '@/components/tutoring/list-toolbar';
import { Pagination } from '@/components/tutoring/pagination';
import { TutorCard, type TutorCardData } from '@/components/tutoring/tutor-card';
import { TutorFilters } from '@/components/tutoring/tutor-filters';

type BrowseTutor = {
  id: string;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  ratingAvg: string | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  instantBookEnabled: boolean;
  trialSessionEnabled: boolean | null;
  avgResponseMinutes: number | null;
  userId: string;
  userName: string | null;
  userImage: string | null;
  subjects: Array<{ slug: string; level: string; verifiedAt: string | null }>;
};

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
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = parsePageSize(sp.per);
  const sort = sp.sort ?? 'top';

  const qs = new URLSearchParams();
  if (sp.subject) qs.set('subject', sp.subject);
  if (sp.level) qs.set('level', sp.level);
  if (sp.modality) qs.set('modality', sp.modality);
  if (sp.minRate) qs.set('minRate', sp.minRate);
  if (sp.maxRate) qs.set('maxRate', sp.maxRate);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.page) qs.set('page', sp.page);
  if (sp.per) qs.set('per', sp.per);
  const query = qs.toString();

  const { totalCount, tutors: rows } = await apiServer<{
    totalCount: number;
    tutors: BrowseTutor[];
  }>(`/api/tutors${query ? `?${query}` : ''}`);

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
