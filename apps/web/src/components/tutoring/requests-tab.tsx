/**
 * RequestsTab — list student request OPEN cho tutor browse + apply.
 *
 * Server component. Filter qua searchParams (subject/level/modality/urgency).
 */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { ChevronRight, Users } from 'lucide-react';

import {
  db,
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_BY_SLUG,
  tutorRequest,
  URGENCY_NAMES,
  user as userTable,
} from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState } from '@/components/layout/empty-state';
import {
  ListToolbar,
  type ActiveFilterChip,
} from '@/components/tutoring/list-toolbar';
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
  const offset = (page - 1) * pageSize;

  const conds = [eq(tutorRequest.status, 'OPEN')];
  if (sp.subject) conds.push(eq(tutorRequest.subjectSlug, sp.subject));
  if (sp.level) conds.push(eq(tutorRequest.level, sp.level));
  if (sp.modality) conds.push(eq(tutorRequest.modality, sp.modality));
  if (sp.urgency) conds.push(eq(tutorRequest.urgency, sp.urgency));

  const sort = sp.sort ?? 'urgency';
  const orderClause = (() => {
    switch (sort) {
      case 'newest':
        return [desc(tutorRequest.createdAt)];
      case 'budget-high':
        return [desc(tutorRequest.budgetVnd), desc(tutorRequest.createdAt)];
      case 'budget-low':
        return [asc(tutorRequest.budgetVnd), desc(tutorRequest.createdAt)];
      case 'urgency':
      default:
        return [
          desc(sql`CASE ${tutorRequest.urgency}
                    WHEN 'ASAP' THEN 3
                    WHEN 'THIS_WEEK' THEN 2
                    WHEN 'THIS_MONTH' THEN 1
                    ELSE 0
                  END`),
          desc(tutorRequest.createdAt),
        ];
    }
  })();

  const [countRow, rows] = await Promise.all([
    db
      .select({ n: count() })
      .from(tutorRequest)
      .where(and(...conds))
      .then((r) => r[0]),
    db
      .select({
        id: tutorRequest.id,
        title: tutorRequest.title,
        description: tutorRequest.description,
        subjectSlug: tutorRequest.subjectSlug,
        level: tutorRequest.level,
        budgetVnd: tutorRequest.budgetVnd,
        modality: tutorRequest.modality,
        urgency: tutorRequest.urgency,
        createdAt: tutorRequest.createdAt,
        studentId: tutorRequest.studentId,
        studentName: userTable.name,
        studentImage: userTable.image,
      })
      .from(tutorRequest)
      .innerJoin(userTable, eq(userTable.id, tutorRequest.studentId))
      .where(and(...conds))
      .orderBy(...orderClause)
      .limit(pageSize)
      .offset(offset),
  ]);

  const totalCount = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Active filter chips
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
      {/* Deep-link ?request=<id> → mở modal chi tiết */}
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
                  className="group/r relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-divider bg-card p-5 text-left shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated"
                >
                  {/* Urgency strip on left */}
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 w-1 transition-all',
                      r.urgency === 'ASAP' && 'bg-red-500',
                      r.urgency === 'THIS_WEEK' && 'bg-orange-500',
                      r.urgency === 'THIS_MONTH' && 'bg-blue-500',
                      r.urgency === 'FLEXIBLE' && 'bg-muted',
                    )}
                  />

                  {/* Header: student + time + urgency */}
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10 shrink-0 ring-2 ring-primary/10">
                      <AvatarImage src={r.studentImage ?? undefined} />
                      <AvatarFallback className="text-sm">
                        {(r.studentName ?? '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold tracking-tight">
                        {r.studentName ?? 'Anonymous'}
                        {isOwn && (
                          <span className="ml-1.5 text-[11px] font-normal text-text-muted">
                            (bạn)
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-text-muted">
                        <RelativeTime date={r.createdAt.toISOString()} />
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

                  {/* Title + description */}
                  <div>
                    <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight">
                      {r.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                      {r.description}
                    </p>
                  </div>

                  {/* Subject + modality chips */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 font-medium text-primary ring-1 ring-inset ring-primary/15">
                      <span>{subjectDef?.emoji ?? '📚'}</span>
                      {subjectDef?.name ?? r.subjectSlug}
                      <span className="opacity-70">
                        · {LEVEL_NAMES[r.level as keyof typeof LEVEL_NAMES]}
                      </span>
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {MODALITY_NAMES[r.modality]}
                    </span>
                  </div>

                  {/* Footer: budget prominent + CTA */}
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-divider pt-3">
                    <div>
                      {budgetK !== null ? (
                        <>
                          <p className="font-mono text-base font-semibold tabular-nums tracking-tight">
                            ≤{budgetK}K
                            <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
                              /giờ
                            </span>
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Budget tối đa
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold italic text-muted-foreground">
                            Thoả thuận
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Mở mức giá
                          </p>
                        </>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary transition-colors group-hover/r:bg-primary group-hover/r:text-primary-foreground">
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
