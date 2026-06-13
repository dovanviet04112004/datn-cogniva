'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  ALL_SUBJECTS,
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_CATEGORIES,
} from '@cogniva/db/taxonomy';
import type { SubjectLevel } from '@cogniva/db/taxonomy';

import { Button } from '@/components/ui/button';
import { ComboSelect } from '@/components/ui/combo-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';

type PickedSubject = { subjectSlug: string; level: SubjectLevel };
type AvailSlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MODALITIES = ['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID'] as const;

export function BecomeTutorWizard() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  const [headline, setHeadline] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [rate, setRate] = React.useState('150000');
  const [modality, setModality] = React.useState<(typeof MODALITIES)[number]>('ONLINE');
  const [subjects, setSubjects] = React.useState<PickedSubject[]>([]);
  const [pickerSubject, setPickerSubject] = React.useState('');
  const [slots, setSlots] = React.useState<AvailSlot[]>([]);

  const canStep0 =
    headline.trim().length >= 10 && bio.trim().length >= 200 && parseInt(rate, 10) >= 10000;
  const canStep1 = subjects.length > 0;
  const canStep2 = slots.length > 0;

  const submit = async () => {
    setSubmitting(true);
    try {
      const createRes = await fetch('/api/tutors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline.trim(),
          bio: bio.trim(),
          hourlyRateVnd: parseInt(rate, 10),
          modality,
        }),
      });
      if (!createRes.ok) {
        const e = (await createRes.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Tạo profile thất bại');
      }
      const { tutor } = (await createRes.json()) as { tutor: { id: string } };
      const tutorId = tutor.id;

      for (const s of subjects) {
        const r = await fetch(`/api/tutors/${tutorId}/subjects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        });
        if (!r.ok && r.status !== 409) {
          const e = (await r.json().catch(() => null)) as { error?: unknown } | null;
          throw new Error(
            `Thêm môn ${s.subjectSlug} fail: ${typeof e?.error === 'string' ? e.error : r.status}`,
          );
        }
      }

      const availRes = await fetch(`/api/tutors/${tutorId}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      });
      if (!availRes.ok) {
        const e = (await availRes.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          `Lưu lịch fail: ${typeof e?.error === 'string' ? e.error : availRes.status}`,
        );
      }

      const pubRes = await fetch(`/api/tutors/${tutorId}/publish`, {
        method: 'POST',
      });
      if (!pubRes.ok) {
        const e = (await pubRes.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Publish fail');
      }

      toast.success('Đã publish — gia sư đã online!');
      router.push(`/tutors/${tutorId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      size="default"
      padded
      className="space-y-8"
      eyebrowIcon={Sparkles}
      title="Trở thành gia sư"
      description="Setup hồ sơ trong 3 bước — học sinh sẽ tìm thấy bạn qua filter môn, cấp, giá."
    >
      <div className="flex items-center justify-between gap-2">
        {['Hồ sơ', 'Môn dạy', 'Khung giờ'].map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <div
              key={label}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5',
                active && 'bg-primary/10 ring-primary/20 ring-1 ring-inset',
                done && 'opacity-70',
              )}
            >
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums',
                  active && 'bg-primary text-primary-foreground',
                  done && 'bg-emerald-500 text-white',
                  !active && !done && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'truncate text-xs font-medium tracking-tight',
                  active && 'text-foreground',
                  !active && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="bg-card shadow-soft rounded-2xl p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="headline">Tiêu đề ngắn *</Label>
              <Input
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="VD: Gia sư Toán THPT 5 năm kinh nghiệm"
                maxLength={160}
              />
              <p className="text-text-muted text-[11px]">10-160 ký tự · {headline.length}/160</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bio">Giới thiệu chi tiết *</Label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={6}
                maxLength={2000}
                placeholder="Học vấn, kinh nghiệm dạy, phong cách giảng, ưu điểm... Tối thiểu 200 ký tự."
                className="border-input bg-surface shadow-soft duration-base focus-visible:border-primary/40 focus-visible:ring-primary/15 block w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-4"
              />
              <p className="text-text-muted text-[11px]">{bio.length}/2000 (tối thiểu 200)</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rate">Giá VND / giờ *</Label>
                <Input
                  id="rate"
                  type="number"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  min={10000}
                  step={10000}
                />
                <p className="text-text-muted text-[11px]">
                  {parseInt(rate, 10).toLocaleString('vi-VN')} VND
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Hình thức dạy *</Label>
                <div className="flex flex-wrap gap-1.5">
                  {MODALITIES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModality(m)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        modality === m
                          ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                          : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {MODALITY_NAMES[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Gõ tên môn → chọn cấp học để thêm. Có thể thêm nhiều môn/cấp.
            </p>

            {subjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {subjects.map((p) => {
                  const def = ALL_SUBJECTS.find((s) => s.slug === p.subjectSlug);
                  return (
                    <span
                      key={p.subjectSlug + p.level}
                      className="bg-primary/10 text-primary ring-primary/30 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ring-1 ring-inset"
                    >
                      <span>{def?.emoji}</span>
                      {def?.name ?? p.subjectSlug}
                      <span className="text-[10px] opacity-70">· {LEVEL_NAMES[p.level]}</span>
                      <button
                        type="button"
                        aria-label="Bỏ"
                        onClick={() =>
                          setSubjects((prev) =>
                            prev.filter(
                              (x) => !(x.subjectSlug === p.subjectSlug && x.level === p.level),
                            ),
                          )
                        }
                        className="hover:bg-primary/20 -mr-1 rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="border-divider bg-muted/20 space-y-2.5 rounded-xl border p-3">
              <ComboSelect
                value={pickerSubject}
                onChange={setPickerSubject}
                placeholder="Gõ tên môn, vd: Toán, IELTS, Lập trình…"
                options={SUBJECT_CATEGORIES.flatMap((cat) =>
                  cat.subjects.map((s) => ({
                    value: s.slug,
                    label: `${s.emoji} ${s.name}`,
                    hint: cat.name,
                  })),
                )}
              />
              {(() => {
                const def = ALL_SUBJECTS.find((s) => s.slug === pickerSubject);
                if (!def) return null;
                return (
                  <div className="space-y-1.5">
                    <p className="text-text-muted text-[11px]">
                      Bấm cấp học để thêm <b>{def.name}</b>:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {def.levels.map((lvl) => {
                        const added = subjects.some(
                          (p) => p.subjectSlug === def.slug && p.level === lvl,
                        );
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() =>
                              setSubjects((prev) =>
                                added
                                  ? prev.filter(
                                      (x) => !(x.subjectSlug === def.slug && x.level === lvl),
                                    )
                                  : [...prev, { subjectSlug: def.slug, level: lvl }],
                              )
                            }
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all',
                              added
                                ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                            {LEVEL_NAMES[lvl]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <p className="text-text-muted text-xs">
              Đã chọn:{' '}
              <span className="text-foreground/70 font-mono font-semibold tabular-nums">
                {subjects.length}
              </span>
            </p>
          </div>
        )}

        {step === 2 && <AvailabilityEditor slots={slots} setSlots={setSlots} />}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Quay lại
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={(step === 0 && !canStep0) || (step === 1 && !canStep1)}
          >
            Tiếp
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={!canStep2 || submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Đang publish...
              </>
            ) : (
              <>
                Publish profile
                <ChevronRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </PageShell>
  );
}

function AvailabilityEditor({
  slots,
  setSlots,
}: {
  slots: AvailSlot[];
  setSlots: React.Dispatch<React.SetStateAction<AvailSlot[]>>;
}) {
  const addSlot = (dayOfWeek: number) => {
    setSlots((prev) => [...prev, { dayOfWeek, startTime: '19:00', endTime: '21:00' }]);
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Đánh dấu các khung giờ rảnh trong tuần (lặp lại mỗi tuần). Có thể thêm nhiều khung trong 1
        ngày.
      </p>
      {DAY_NAMES.map((day, dayIdx) => {
        const daySlots = slots
          .map((s, i) => ({ ...s, _idx: i }))
          .filter((s) => s.dayOfWeek === dayIdx);
        return (
          <div
            key={day}
            className="border-divider bg-surface-secondary/40 flex items-start gap-3 rounded-xl border p-3"
          >
            <div className="w-10 shrink-0">
              <p className="text-text-muted text-center font-mono text-xs font-semibold uppercase tracking-[0.1em]">
                {day}
              </p>
            </div>
            <div className="flex-1 space-y-2">
              {daySlots.length === 0 ? (
                <p className="text-text-muted/60 text-xs italic">Không rảnh</p>
              ) : (
                daySlots.map((s) => (
                  <div key={s._idx} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={s.startTime}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((x, i) =>
                            i === s._idx ? { ...x, startTime: e.target.value } : x,
                          ),
                        )
                      }
                      className="border-divider bg-surface rounded-md border px-2 py-1 font-mono text-xs"
                    />
                    <span className="text-text-muted text-xs">→</span>
                    <input
                      type="time"
                      value={s.endTime}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((x, i) =>
                            i === s._idx ? { ...x, endTime: e.target.value } : x,
                          ),
                        )
                      }
                      className="border-divider bg-surface rounded-md border px-2 py-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setSlots((prev) => prev.filter((_, i) => i !== s._idx))}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => addSlot(dayIdx)}
              className="text-primary hover:bg-primary/10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              title="Thêm khung"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <span className="hidden">
        <X className="h-3 w-3" />
      </span>
    </div>
  );
}
