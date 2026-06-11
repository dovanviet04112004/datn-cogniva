'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, Loader2, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';
import type { SubjectLevel } from '@cogniva/db/taxonomy';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type AvailabilitySlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type TutorSubjectMini = {
  id: string;
  subjectSlug: string;
  level: string;
};

const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const DURATIONS = [30, 60, 90, 120] as const;

function parseHM(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((p) => parseInt(p, 10));
  return { h: h!, m: m! };
}

function formatHM(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutes(start: string, minutes: number): string {
  const { h, m } = parseHM(start);
  const total = h * 60 + m + minutes;
  return formatHM(Math.floor(total / 60), total % 60);
}

function compareTime(a: string, b: string): number {
  return a.localeCompare(b);
}

function buildLocalDate(date: Date, hm: string): Date {
  const { h, m } = parseHM(hm);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function next7Days(): Date[] {
  const days: Date[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function validStarts(slots: AvailabilitySlot[], dayOfWeek: number, durationMin: number): string[] {
  const daySlots = slots.filter((s) => s.dayOfWeek === dayOfWeek);
  const starts: string[] = [];
  for (const s of daySlots) {
    let cur = s.startTime;
    while (true) {
      const end = addMinutes(cur, durationMin);
      if (compareTime(end, s.endTime) > 0) break;
      starts.push(cur);
      cur = addMinutes(cur, 30);
    }
  }
  return Array.from(new Set(starts)).sort();
}

export function BookingDialog({
  tutorId,
  tutorName,
  hourlyRateVnd,
  subjects,
  availability,
  instantBookEnabled = false,
  trialEligible = false,
  open,
  onOpenChange,
}: {
  tutorId: string;
  tutorName: string;
  hourlyRateVnd: number;
  subjects: TutorSubjectMini[];
  availability: AvailabilitySlot[];
  instantBookEnabled?: boolean;
  trialEligible?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [subjectId, setSubjectId] = React.useState(subjects.length === 1 ? subjects[0]!.id : '');
  const days = React.useMemo(next7Days, []);
  const [dayIdx, setDayIdx] = React.useState(0);
  const [isTrial, setIsTrial] = React.useState(false);
  const [durationMin, setDurationMin] = React.useState<(typeof DURATIONS)[number]>(60);

  React.useEffect(() => {
    if (isTrial) setDurationMin(30);
    else if (durationMin === 30) setDurationMin(60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTrial]);

  const [startTime, setStartTime] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');

  const selectedDay = days[dayIdx]!;
  const starts = React.useMemo(
    () => validStarts(availability, selectedDay.getDay(), durationMin),
    [availability, selectedDay, durationMin],
  );

  React.useEffect(() => {
    setStartTime(null);
  }, [dayIdx, durationMin]);

  const subject = subjects.find((s) => s.id === subjectId);
  const subjectDef = subject ? SUBJECT_BY_SLUG[subject.subjectSlug] : null;
  const baseTotal = Math.round(hourlyRateVnd * (durationMin / 60));
  const totalVnd = isTrial ? Math.round(baseTotal / 2) : baseTotal;

  const canSubmit = !!subjectId && !!startTime && !submitting;

  const submit = async () => {
    if (!canSubmit || !subject || !startTime) return;
    setSubmitting(true);
    try {
      const startAt = buildLocalDate(selectedDay, startTime);
      const endAt = new Date(startAt.getTime() + durationMin * 60_000);
      const res = await fetch('/api/tutoring/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tutorId,
          subjectSlug: subject.subjectSlug,
          level: subject.level,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          studentMessage: message.trim() || undefined,
          isTrial: isTrial,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Booking thất bại');
      }
      const data = (await res.json()) as {
        booking: { id: string };
        instantBooked?: boolean;
      };
      toast.success(
        data.instantBooked
          ? '⚡ Đã xác nhận buổi học ngay'
          : 'Đã gửi booking — gia sư sẽ confirm trong 24h',
      );
      onOpenChange(false);
      router.push(`/tutoring/bookings/${data.booking.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Calendar className="text-primary h-4 w-4" />
            Đặt buổi học với {tutorName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {(instantBookEnabled || trialEligible) && (
            <div className="border-discovery-500/20 bg-discovery-500/5 text-discovery-700 dark:text-discovery-300 flex flex-wrap gap-2 rounded-xl border px-3 py-2 text-[11.5px]">
              {instantBookEnabled && (
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span className="font-semibold">Đặt ngay</span>
                  <span className="opacity-80">— xác nhận tức thì</span>
                </span>
              )}
              {trialEligible && instantBookEnabled && <span className="opacity-30">·</span>}
              {trialEligible && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  <span className="font-semibold">Trial 30p -50%</span>
                  <span className="opacity-80">— lần đầu</span>
                </span>
              )}
            </div>
          )}

          {trialEligible && (
            <label className="border-divider bg-card hover:border-discovery-500/40 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors">
              <input
                type="checkbox"
                checked={isTrial}
                onChange={(e) => setIsTrial(e.target.checked)}
                className="accent-discovery-500 h-4 w-4"
              />
              <div className="flex-1">
                <p className="text-[13px] font-medium">Đặt trial 30 phút (-50%)</p>
                <p className="text-muted-foreground text-[10.5px]">
                  Trải nghiệm lần đầu — sau đó đặt buổi học chính thức nếu phù hợp.
                </p>
              </div>
            </label>
          )}

          <div>
            <p className="text-text-muted mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Môn học
            </p>
            <div className="flex flex-wrap gap-1.5">
              {subjects.map((s) => {
                const def = SUBJECT_BY_SLUG[s.subjectSlug];
                const lvl = LEVEL_NAMES[s.level as SubjectLevel] ?? s.level;
                const active = subjectId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubjectId(s.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <span>{def?.emoji ?? '📚'}</span>
                    {def?.name ?? s.subjectSlug}
                    <span className="opacity-70">· {lvl}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-text-muted mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Ngày
            </p>
            <div className="flex flex-wrap gap-1.5">
              {days.map((d, i) => {
                const dayN = d.getDay();
                const hasSlot = availability.some((s) => s.dayOfWeek === dayN);
                const active = dayIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!hasSlot}
                    onClick={() => setDayIdx(i)}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-all',
                      active
                        ? 'bg-primary text-primary-foreground shadow-soft'
                        : hasSlot
                          ? 'bg-muted/40 text-muted-foreground hover:bg-muted'
                          : 'bg-muted/20 text-muted-foreground/40 cursor-not-allowed',
                    )}
                  >
                    <span className="opacity-80">{DAY_NAMES[dayN]?.slice(0, 4)}</span>
                    <span className="font-mono text-sm tabular-nums">
                      {d.getDate()}/{d.getMonth() + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-text-muted mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Độ dài
            </p>
            <div className="flex gap-1.5">
              {DURATIONS.map((dur) => {
                const active = durationMin === dur;
                const disabled = isTrial && dur !== 30;
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => !disabled && setDurationMin(dur)}
                    disabled={disabled}
                    className={cn(
                      'flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                        : disabled
                          ? 'bg-muted/20 text-muted-foreground/40 cursor-not-allowed'
                          : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {dur} phút
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-text-muted mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Giờ bắt đầu
            </p>
            {starts.length === 0 ? (
              <p className="border-divider bg-card/40 text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-xs">
                Không có slot {durationMin} phút trong ngày này — đổi ngày hoặc rút ngắn buổi.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {starts.map((t) => {
                  const active = startTime === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setStartTime(t)}
                      className={cn(
                        'rounded-lg px-2 py-1.5 font-mono text-xs tabular-nums transition-all',
                        active
                          ? 'bg-primary text-primary-foreground shadow-soft'
                          : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-text-muted mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Lời nhắn cho gia sư (tuỳ chọn)
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="VD: Em đang yếu phần Tích phân, mong cô luyện đề trắc nghiệm."
              className="border-input bg-surface shadow-soft focus-visible:border-primary/40 focus-visible:ring-primary/15 block w-full rounded-xl border px-3 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-4"
            />
            <p className="text-text-muted mt-0.5 text-[10.5px]">{message.length}/500</p>
          </div>

          {startTime && subjectDef && (
            <div className="bg-primary/5 ring-primary/15 rounded-xl p-3 text-sm ring-1">
              <p className="font-semibold">
                {subjectDef.emoji} {subjectDef.name}
                {isTrial && (
                  <span className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    TRIAL -50%
                  </span>
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                <Clock className="mr-1 inline h-3 w-3" />
                {DAY_NAMES[selectedDay.getDay()]} {selectedDay.getDate()}/
                {selectedDay.getMonth() + 1} ·{' '}
                <span className="font-mono">
                  {startTime} - {addMinutes(startTime, durationMin)}
                </span>
              </p>
              <p className="mt-1 text-xs">
                Tổng:{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {totalVnd.toLocaleString('vi-VN')}đ
                </span>
                {isTrial && (
                  <span className="text-muted-foreground ml-2 line-through">
                    {baseTotal.toLocaleString('vi-VN')}đ
                  </span>
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-[10.5px]">
                {instantBookEnabled
                  ? '⚡ Đặt ngay — gia sư xác nhận tức thì'
                  : 'Gia sư sẽ confirm trong vòng 24 giờ'}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="button" onClick={submit} disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Đang gửi...
                </>
              ) : instantBookEnabled ? (
                <>
                  <Zap className="mr-1 h-4 w-4" />
                  Đặt ngay {startTime ? `${(totalVnd / 1000).toFixed(0)}k` : ''}
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-4 w-4" />
                  Gửi yêu cầu đặt
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
