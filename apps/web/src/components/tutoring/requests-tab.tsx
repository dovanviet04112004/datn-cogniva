import { ChevronRight, Users } from 'lucide-react';

import { LEVEL_NAMES, MODALITY_NAMES, SUBJECT_BY_SLUG, URGENCY_NAMES } from '@cogniva/db/taxonomy';

import { apiServer } from '@/lib/api-server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { ListToolbar, type ActiveFilterChip } from '@/components/tutoring/list-toolbar';
import { Pagination } from '@/components/tutoring/pagination';
import { RequestAutoOpen } from '@/components/tutoring/request-auto-open';
import { RequestCardOpener } from '@/components/tutoring/request-card-opener';
import { RelativeTime } from '@/components/ui/relative-time';
import { cn } from '@/lib/utils';

const REQUEST_SORT_OPTIONS = [
  { value: 'urgency', label: 'Khẩn cấp trước' },
  { value: 'newest', label: 'Mới nhất' },
  { value: 'budget-high', label: 'Budget cao' },
  { value: 'budget-low', label: 'Budget thấp' },
];

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

const URGENCY_COLORS: Record<string, string> = {
  ASAP: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
  THIS_WEEK: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 ring-orange-500/20',
  THIS_MONTH: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20',
  FLEXIBLE: 'bg-muted/60 text-muted-foreground ring-border',
};

type BrowseRequest = {
  id: string;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetVnd: number | null;
  modality: string;
  urgency: string;
  createdAt: string;
  studentId: string;
  studentName: string | null;
  studentImage: string | null;
};

export async function RequestsTab({
  sp,
  currentUserId,
}: {
  sp: {
    subject?: string;
    level?: string;
    modality?: string;
    urgency?: string;
    sort?: string;
    page?: string;
    per?: string;
    tab?: string;
  };
  currentUserId: string;
}) {
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = parsePageSize(sp.per);
  const sort = sp.sort ?? 'urgency';

  const qs = new URLSearchParams();
  if (sp.subject) qs.set('subject', sp.subject);
  if (sp.level) qs.set('level', sp.level);
  if (sp.modality) qs.set('modality', sp.modality);
  if (sp.urgency) qs.set('urgency', sp.urgency);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.page) qs.set('page', sp.page);
  if (sp.per) qs.set('per', sp.per);
  const query = qs.toString();

  const { totalCount, requests: rows } = await apiServer<{
    totalCount: number;
    requests: BrowseRequest[];
  }>(`/api/tutoring/requests${query ? `?${query}` : ''}`);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const activeFilters: ActiveFilterChip[] = [];
  if (sp.subject) {
    const s = SUBJECT_BY_SLUG[sp.subject];
    activeFilters.push({ key: 'subject', label: s ? `${s.emoji} ${s.name}` : sp.subject });
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
  if (sp.urgency) {
    activeFilters.push({ key: 'urgency', label: URGENCY_NAMES[sp.urgency] ?? sp.urgency });
  }

  const preservedParams: Record<string, string> = {};
  if (sp.tab) preservedParams.tab = sp.tab;
  if (sp.subject) preservedParams.subject = sp.subject;
  if (sp.level) preservedParams.level = sp.level;
  if (sp.modality) preservedParams.modality = sp.modality;
  if (sp.urgency) preservedParams.urgency = sp.urgency;
  if (sp.sort) preservedParams.sort = sp.sort;

  return (
    <section className="space-y-4">
      <RequestAutoOpen />

      <ListToolbar
        title="Yêu cầu đang mở"
        total={totalCount}
        activeFilters={activeFilters}
        sortOptions={REQUEST_SORT_OPTIONS}
        currentSort={sort}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Chưa có yêu cầu nào"
          description="Hãy là người đầu tiên — đăng yêu cầu học, gia sư sẽ apply ngay."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((r) => {
            const subjectDef = SUBJECT_BY_SLUG[r.subjectSlug];
            const isOwn = r.studentId === currentUserId;
            const budgetK = r.budgetVnd ? Math.round(r.budgetVnd / 1000) : null;
            return (
              <li key={r.id}>
                <RequestCardOpener
                  requestId={r.id}
                  className="group/r border-divider bg-card shadow-soft duration-base ease-expo-out hover:border-primary/30 hover:shadow-elevated relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5"
                >
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 w-1 transition-all',
                      r.urgency === 'ASAP' && 'bg-red-500',
                      r.urgency === 'THIS_WEEK' && 'bg-orange-500',
                      r.urgency === 'THIS_MONTH' && 'bg-blue-500',
                      r.urgency === 'FLEXIBLE' && 'bg-muted',
                    )}
                  />

                  <div className="flex items-start gap-3">
                    <Avatar className="ring-primary/10 h-10 w-10 shrink-0 ring-2">
                      <AvatarImage src={r.studentImage ?? undefined} />
                      <AvatarFallback className="text-sm">
                        {(r.studentName ?? '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold tracking-tight">
                        {r.studentName ?? 'Anonymous'}
                        {isOwn && (
                          <span className="text-text-muted ml-1.5 text-[11px] font-normal">
                            (bạn)
                          </span>
                        )}
                      </p>
                      <p className="text-text-muted mt-0.5 font-mono text-[11px] tabular-nums">
                        <RelativeTime date={r.createdAt} />
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                        URGENCY_COLORS[r.urgency] ?? URGENCY_COLORS.FLEXIBLE,
                      )}
                    >
                      {r.urgency === 'ASAP' && '🔥 '}
                      {URGENCY_NAMES[r.urgency]}
                    </span>
                  </div>

                  <div>
                    <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight">
                      {r.title}
                    </h3>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-[13px] leading-relaxed">
                      {r.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="bg-primary/8 text-primary ring-primary/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset">
                      <span>{subjectDef?.emoji ?? '📚'}</span>
                      {subjectDef?.name ?? r.subjectSlug}
                      <span className="opacity-70">
                        · {LEVEL_NAMES[r.level as keyof typeof LEVEL_NAMES]}
                      </span>
                    </span>
                    <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5">
                      {MODALITY_NAMES[r.modality]}
                    </span>
                  </div>

                  <div className="border-divider mt-auto flex items-center justify-between gap-2 border-t pt-3">
                    <div>
                      {budgetK !== null ? (
                        <>
                          <p className="font-mono text-base font-semibold tabular-nums tracking-tight">
                            ≤{budgetK}K
                            <span className="text-muted-foreground ml-0.5 text-[11px] font-normal">
                              /giờ
                            </span>
                          </p>
                          <p className="text-muted-foreground text-[10px]">Budget tối đa</p>
                        </>
                      ) : (
                        <>
                          <p className="text-muted-foreground text-sm font-semibold italic">
                            Thoả thuận
                          </p>
                          <p className="text-muted-foreground text-[10px]">Mở mức giá</p>
                        </>
                      )}
                    </div>
                    <span className="bg-primary/10 text-primary group-hover/r:bg-primary group-hover/r:text-primary-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors">
                      {isOwn ? 'Xem chi tiết' : 'Ứng tuyển'}
                      <ChevronRight className="h-3 w-3 transition-transform group-hover/r:translate-x-0.5" />
                    </span>
                  </div>
                </RequestCardOpener>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={pageSize}
          defaultPageSize={DEFAULT_PAGE_SIZE}
          basePath="/tutoring"
          preservedParams={preservedParams}
        />
      )}
    </section>
  );
}
