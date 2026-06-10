/**
 * ClassesTab — V4 T4 (2026-05-22).
 *
 * Browse group classes (status OPEN). Filter subject/level qua searchParams.
 * Render grid card class.
 *
 * Spec: docs/plans/tutoring-v4.md §3 T4.
 */
'use client';

import Link from 'next/link';
import { CalendarDays, Loader2, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SUBJECT_BY_SLUG, LEVEL_NAMES } from '@cogniva/db/taxonomy';
import type { SubjectLevel } from '@cogniva/db/taxonomy';

type ClassRow = {
  id: string;
  tutorId: string;
  title: string;
  description: string | null;
  subjectSlug: string;
  level: string;
  maxStudents: number;
  enrolledCount: number;
  ratePerStudentVnd: number;
  durationMin: number;
  totalSessions: number;
  scheduleType: 'ONE_OFF' | 'WEEKLY' | 'BIWEEKLY';
  scheduleSlots: string[];
  startDate: string;
  status: string;
  tutorHeadline: string;
  tutorAvatarUrl: string | null;
  tutorName: string | null;
};

const SCHEDULE_LABEL: Record<string, string> = {
  ONE_OFF: '1 buổi duy nhất',
  WEEKLY: 'Hàng tuần',
  BIWEEKLY: '2 tuần / lần',
};

type Sp = {
  subject?: string;
  level?: string;
};

export function ClassesTab({ sp = {} }: { sp?: Sp }) {
  const params = new URLSearchParams();
  if (sp.subject) params.set('subject', sp.subject);
  if (sp.level) params.set('level', sp.level);
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: qk.tutoringClasses(sp.subject, sp.level),
    queryFn: () =>
      apiGet<{ classes: ClassRow[] }>(
        `/api/tutoring/classes?${params.toString()}`,
      ).then((d) => d.classes ?? []),
  });

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải lớp nhóm…
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-discovery-500/10 text-discovery-500">
          <Users className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold">Chưa có lớp nhóm mở</p>
          <p className="mt-1 max-w-[320px] text-[12px] text-muted-foreground">
            Lớp nhóm 1 tutor → 2-30 student với giá / người thấp hơn 1-1.
            Quay lại sau hoặc browse gia sư riêng.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => {
        const subjectDef = SUBJECT_BY_SLUG[c.subjectSlug];
        const slotsPreview = c.scheduleSlots.slice(0, 3).join(', ');
        const seatsLeft = c.maxStudents - c.enrolledCount;
        return (
          <Link
            key={c.id}
            href={`/tutoring/classes/${c.id}`}
            className="group/c flex flex-col gap-3 overflow-hidden rounded-2xl border border-divider bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-discovery-500/30 hover:shadow-elevated"
          >
            <div className="flex items-start gap-2">
              <span className="rounded-md bg-discovery-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-discovery-700 dark:text-discovery-300">
                Lớp nhóm
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {SCHEDULE_LABEL[c.scheduleType] ?? c.scheduleType}
              </span>
              <span
                className={cn(
                  'ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold',
                  seatsLeft <= 2
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                )}
              >
                Còn {seatsLeft}/{c.maxStudents}
              </span>
            </div>

            <h3 className="line-clamp-2 text-[14px] font-semibold tracking-tight">
              {c.title}
            </h3>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {subjectDef?.emoji} {subjectDef?.name ?? c.subjectSlug}
              </span>
              <span>·</span>
              <span>{LEVEL_NAMES[c.level as SubjectLevel] ?? c.level}</span>
              <span>·</span>
              <span>
                {c.totalSessions} buổi × {c.durationMin}p
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              <span>Bắt đầu {new Date(c.startDate).toLocaleDateString('vi-VN')}</span>
              <span className="opacity-50">·</span>
              <span className="truncate">{slotsPreview}</span>
            </div>

            <div className="mt-auto flex items-end justify-between border-t border-divider pt-3">
              <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={c.tutorAvatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {(c.tutorName ?? 'T')[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] font-medium">
                    {c.tutorName}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {(c.ratePerStudentVnd / 1000).toLocaleString('vi-VN')}k
                </p>
                <p className="text-[11px] text-muted-foreground">/người</p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
