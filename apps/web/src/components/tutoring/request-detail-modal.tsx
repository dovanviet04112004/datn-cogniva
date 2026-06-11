'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { LEVEL_NAMES, MODALITY_NAMES, SUBJECT_BY_SLUG, URGENCY_NAMES } from '@cogniva/db/taxonomy';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { AiMatches } from './ai-matches';
import { ApplicationsList } from './applications-list';
import { ApplyForm } from './apply-form';
import { CloseRequestButton } from './close-request-button';

type Req = {
  id: string;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetVnd: number | null;
  modality: string;
  urgency: string;
  status: string;
  studentName: string | null;
  studentImage: string | null;
};
type AppRow = {
  id: string;
  tutorId: string;
  message: string;
  proposedRateVnd: number;
  status: string;
  createdAt: string;
  tutorHeadline: string;
  tutorRating: string | null;
  tutorRatingCount: number;
  tutorSessionsCompleted: number;
  tutorAvatarUrl: string | null;
  tutorUserId: string;
};
type Resp =
  | { request: Req; isOwner: true; applications: AppRow[] }
  | {
      request: Req;
      isOwner: false;
      isTutor: boolean;
      myApplication: { id: string; status: string } | null;
    };

const URGENCY_COLORS: Record<string, string> = {
  ASAP: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
  THIS_WEEK: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 ring-orange-500/20',
  THIS_MONTH: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20',
  FLEXIBLE: 'bg-muted/60 text-muted-foreground ring-border',
};

export function RequestDetailModal({
  requestId,
  open,
  onOpenChange,
}: {
  requestId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.tutoringRequestDetail(requestId ?? ''),
    queryFn: () => apiGet<Resp>(`/api/tutoring/requests/${requestId}`),
    enabled: open && !!requestId,
  });

  const req = data?.request;
  const subj = req ? SUBJECT_BY_SLUG[req.subjectSlug] : undefined;
  const budgetK = req?.budgetVnd ? Math.round(req.budgetVnd / 1000) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-auto max-h-[88vh] w-[94vw] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogTitle className="sr-only">Chi tiết yêu cầu học</DialogTitle>

        <div className="border-divider flex shrink-0 items-center border-b px-5 py-3.5 pr-14">
          <h2 className="text-sm font-semibold tracking-tight">Chi tiết yêu cầu</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading && !req ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tải…
            </div>
          ) : !req || !data ? (
            <p className="text-muted-foreground py-20 text-center text-sm">
              Không tải được yêu cầu.
            </p>
          ) : (
            <div className="mx-auto max-w-xl space-y-5">
              <div className="flex items-start gap-3">
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarImage src={req.studentImage ?? undefined} />
                  <AvatarFallback>{(req.studentName ?? '?')[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tracking-tight">
                    {req.studentName ?? 'Ẩn danh'}
                  </p>
                  <h1 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight">
                    {req.title}
                  </h1>
                </div>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                    URGENCY_COLORS[req.urgency] ?? URGENCY_COLORS.FLEXIBLE,
                  )}
                >
                  {URGENCY_NAMES[req.urgency]}
                </span>
              </div>

              <p className="text-foreground/85 whitespace-pre-wrap text-[13px] leading-relaxed">
                {req.description}
              </p>

              <div className="bg-muted/30 grid grid-cols-2 gap-3 rounded-xl p-3.5 text-[13px] sm:grid-cols-4">
                <Meta label="Môn">
                  {subj?.emoji ?? '📚'} {subj?.name ?? req.subjectSlug}
                </Meta>
                <Meta label="Cấp">
                  {LEVEL_NAMES[req.level as keyof typeof LEVEL_NAMES] ?? req.level}
                </Meta>
                <Meta label="Hình thức">{MODALITY_NAMES[req.modality]}</Meta>
                <Meta label="Ngân sách">
                  {budgetK !== null ? (
                    <span className="font-mono tabular-nums">≤{budgetK}K</span>
                  ) : (
                    'Thoả thuận'
                  )}
                </Meta>
              </div>

              {req.status !== 'OPEN' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-muted/60 text-muted-foreground inline-flex items-center rounded-full px-3 py-1 text-xs">
                    Trạng thái: <span className="ml-1 font-semibold">{req.status}</span>
                  </span>
                </div>
              )}

              {data.isOwner ? (
                <div className="space-y-5">
                  {req.status !== 'CLOSED' && <CloseRequestButton requestId={req.id} />}
                  {req.status === 'OPEN' && <AiMatches requestId={req.id} />}
                  <ApplicationsList
                    applications={data.applications.map((a) => ({
                      ...a,
                      createdAt: new Date(a.createdAt),
                      tutorSessions: a.tutorSessionsCompleted,
                    }))}
                    onChanged={() => void refetch()}
                  />
                </div>
              ) : data.myApplication ? (
                <div className="border-primary/20 bg-primary/5 rounded-2xl border p-4 text-center">
                  <p className="text-sm font-semibold tracking-tight">Bạn đã ứng tuyển</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Trạng thái:{' '}
                    <span className="text-foreground/80 font-semibold">
                      {data.myApplication.status}
                    </span>{' '}
                    — đợi học viên phản hồi.
                  </p>
                </div>
              ) : data.isTutor && req.status === 'OPEN' ? (
                <ApplyForm requestId={req.id} suggestedRate={req.budgetVnd ?? 200000} />
              ) : req.status === 'OPEN' ? (
                <div className="border-divider bg-surface-secondary/40 rounded-2xl border border-dashed p-5 text-center">
                  <p className="text-sm font-semibold tracking-tight">Muốn nhận yêu cầu này?</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Trở thành gia sư để ứng tuyển.
                  </p>
                  <Button asChild className="mt-3">
                    <Link href="/tutors/become">Trở thành gia sư</Link>
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.12em]">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-medium">{children}</p>
    </div>
  );
}
