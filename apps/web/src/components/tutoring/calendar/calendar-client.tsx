'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type CalendarItem = {
  id: string;
  kind: 'booking' | 'class' | 'blocked';
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  tutorId: string;
  studentId: string | null;
  isTrial: boolean;
  subjectSlug: string | null;
};

const HOUR_START = 8;
const HOUR_END = 22;
const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function CalendarClient() {
  const router = useRouter();
  const [weekStart, setWeekStart] = React.useState<Date>(() => startOfWeek(new Date()));
  const weekEnd = React.useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  const days = React.useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekStart]);

  const fromISO = weekStart.toISOString();
  const toISO = weekEnd.toISOString();
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: qk.tutoringCalendar(fromISO, toISO),
    queryFn: () =>
      apiGet<{ items: CalendarItem[] }>(
        `/api/tutoring/calendar/me?from=${fromISO}&to=${toISO}`,
      ).then((d) => d.items ?? []),
  });

  const goPrev = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const goNext = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };
  const goToday = () => setWeekStart(startOfWeek(new Date()));

  const buckets = React.useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const start = new Date(item.startAt);
      const dayDiff = Math.floor((start.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
      if (dayDiff < 0 || dayDiff > 6) continue;
      const hour = start.getHours();
      const key = `${dayDiff}:${hour}`;
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items, weekStart]);

  const fmtMonth = (d: Date) => d.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  const hours: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-divider flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="sm" onClick={goPrev} className="h-7 w-7 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={goNext} className="h-7 w-7 p-0">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday} className="h-7">
          Hôm nay
        </Button>
        <span className="ml-2 text-sm font-semibold capitalize">{fmtMonth(weekStart)}</span>
        {loading && <Loader2 className="text-muted-foreground ml-auto h-3.5 w-3.5 animate-spin" />}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[800px] grid-cols-[60px_repeat(7,1fr)]">
          <div className="border-divider bg-muted/20 border-b border-r py-2" />
          {days.map((d, i) => {
            const isToday = new Date().toDateString() === d.toDateString();
            return (
              <div
                key={i}
                className={cn(
                  'border-divider bg-muted/20 border-b px-2 py-2 text-center',
                  isToday && 'bg-primary/5',
                )}
              >
                <p className="text-muted-foreground text-[11px] uppercase tracking-wider">
                  {DAY_NAMES[d.getDay()]}
                </p>
                <p
                  className={cn(
                    'mt-0.5 font-mono text-sm font-semibold tabular-nums',
                    isToday && 'text-primary',
                  )}
                >
                  {d.getDate()}
                </p>
              </div>
            );
          })}

          {hours.map((h) => (
            <React.Fragment key={h}>
              <div className="border-divider text-muted-foreground border-b border-r px-2 py-1 text-right font-mono text-[11px]">
                {String(h).padStart(2, '0')}:00
              </div>
              {days.map((_, dayIdx) => {
                const cellItems = buckets.get(`${dayIdx}:${h}`) ?? [];
                return (
                  <div
                    key={`${h}:${dayIdx}`}
                    className={cn(
                      'border-divider min-h-[44px] border-b border-l p-0.5 transition-colors',
                      cellItems.length === 0 && 'hover:bg-muted/20',
                    )}
                  >
                    {cellItems.map((item) => (
                      <CalendarBlock
                        key={item.id}
                        item={item}
                        onClick={() => {
                          if (item.kind === 'booking') {
                            router.push(`/tutoring/bookings/${item.id}`);
                          } else if (item.kind === 'class') {
                            router.push(`/tutoring/classes/${item.id}`);
                          }
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="border-divider bg-muted/10 text-muted-foreground border-t px-4 py-2 text-[11px]">
        <span className="mr-3 inline-flex items-center gap-1.5">
          <span className="bg-primary h-2 w-2 rounded-full" /> Buổi 1-1
        </span>
        <span className="mr-3 inline-flex items-center gap-1.5">
          <span className="bg-discovery-500 h-2 w-2 rounded-full" /> Lớp nhóm
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> Đã block
        </span>
      </div>
    </Card>
  );
}

function CalendarBlock({ item, onClick }: { item: CalendarItem; onClick: () => void }) {
  const start = new Date(item.startAt);
  const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full rounded-md px-1.5 py-1 text-left text-[11px] transition-all hover:scale-[1.02]',
        item.kind === 'booking' && 'border-primary/30 bg-primary/10 text-primary border',
        item.kind === 'class' &&
          'border-discovery-500/30 bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 border',
        item.kind === 'blocked' &&
          'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      )}
      title={item.title}
    >
      <p className="font-mono font-semibold tabular-nums">{startStr}</p>
      <p className="truncate leading-tight">{item.title}</p>
      {item.isTrial && (
        <span className="bg-discovery-500/15 mt-0.5 inline-block rounded px-1 text-[10px] font-semibold">
          TRIAL
        </span>
      )}
    </button>
  );
}
