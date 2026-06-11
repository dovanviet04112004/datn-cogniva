'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import {
  LEVEL_NAMES,
  MODALITY_NAMES,
  SUBJECT_BY_SLUG,
  SUBJECT_CATEGORIES,
  URGENCY_NAMES,
} from '@cogniva/db/taxonomy';
import type { SubjectLevel } from '@cogniva/db/taxonomy';

import { Button } from '@/components/ui/button';
import { ComboSelect } from '@/components/ui/combo-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NeuralPattern } from '@/components/ui/neural-pattern';
import { PageShell } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const MODALITIES = ['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID'] as const;
const URGENCIES = ['ASAP', 'THIS_WEEK', 'THIS_MONTH', 'FLEXIBLE'] as const;

export function NewRequestForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [subjectSlug, setSubjectSlug] = React.useState('');
  const [level, setLevel] = React.useState<SubjectLevel | ''>('');
  const [budget, setBudget] = React.useState('');
  const [modality, setModality] = React.useState<(typeof MODALITIES)[number]>('ONLINE');
  const [urgency, setUrgency] = React.useState<(typeof URGENCIES)[number]>('FLEXIBLE');

  const activeSubject = subjectSlug ? SUBJECT_BY_SLUG[subjectSlug] : undefined;
  const levelOptions = activeSubject?.levels ?? [];

  const canSubmit =
    title.trim().length >= 10 && description.trim().length >= 50 && !!subjectSlug && !!level;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tutoring/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          subjectSlug,
          level,
          budgetVnd: budget ? parseInt(budget, 10) : null,
          modality,
          urgency,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Tạo yêu cầu thất bại');
      }
      const data = (await res.json()) as { request: { id: string } };
      toast.success('Đã đăng yêu cầu — gia sư sẽ apply sớm');
      router.push(`/tutoring/requests/${data.request.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <PageShell size="default" padded className="space-y-8">
      <Link
        href="/tutoring?tab=requests"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại
      </Link>

      <header className="from-card via-card to-surface-secondary shadow-soft relative overflow-hidden rounded-2xl bg-gradient-to-br px-8 py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 [mask-image:radial-gradient(ellipse_at_right,_black_25%,_transparent_75%)]"
        >
          <NeuralPattern className="text-primary opacity-[0.18]" />
        </div>
        <div className="relative space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-3.5 w-3.5" />
            <span className="text-primary text-[11px] font-semibold uppercase tracking-[0.18em]">
              Tutoring Marketplace
            </span>
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            Đăng yêu cầu tìm gia sư
          </h1>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            Mô tả rõ nhu cầu — gia sư apply ngược cho bạn, không cần search thủ công.
          </p>
        </div>
      </header>

      <div className="bg-card shadow-soft space-y-5 rounded-2xl p-6">
        <div className="space-y-1.5">
          <Label htmlFor="title">Tiêu đề *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="VD: Cần gia sư Toán 12 luyện thi đại học"
            maxLength={160}
          />
          <p className="text-text-muted text-[11px]">10-160 ký tự · {title.length}/160</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desc">Mô tả chi tiết *</Label>
          <textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Học lực hiện tại, mục tiêu, thời gian rảnh, yêu cầu cụ thể về gia sư..."
            className="border-input bg-surface shadow-soft duration-base focus-visible:border-primary/40 focus-visible:ring-primary/15 block w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-4"
          />
          <p className="text-text-muted text-[11px]">{description.length}/2000 (tối thiểu 50)</p>
        </div>

        <div className="space-y-1.5">
          <Label>Môn học *</Label>
          <ComboSelect
            value={subjectSlug}
            onChange={(v) => {
              setSubjectSlug(v);
              const sub = SUBJECT_BY_SLUG[v];
              if (level && sub && !sub.levels.includes(level)) setLevel('');
            }}
            placeholder="Gõ tên môn, vd: Toán, IELTS, Lập trình…"
            options={SUBJECT_CATEGORIES.flatMap((cat) =>
              cat.subjects.map((s) => ({
                value: s.slug,
                label: `${s.emoji} ${s.name}`,
                hint: cat.name,
              })),
            )}
          />
        </div>

        {activeSubject && (
          <div className="space-y-1.5">
            <Label>Cấp học *</Label>
            <div className="flex flex-wrap gap-1.5">
              {levelOptions.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                    level === l
                      ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                      : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                  )}
                >
                  {LEVEL_NAMES[l]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="budget">Ngân sách / giờ (VND)</Label>
            <Input
              id="budget"
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Để trống = thoả thuận"
              min={10000}
              step={10000}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Hình thức</Label>
            <div className="flex flex-wrap gap-1.5">
              {MODALITIES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModality(m)}
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all',
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

        <div className="space-y-1.5">
          <Label>Mức độ gấp</Label>
          <div className="flex flex-wrap gap-1.5">
            {URGENCIES.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUrgency(u)}
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                  urgency === u
                    ? 'bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                )}
              >
                {URGENCY_NAMES[u]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={!canSubmit || submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Đang đăng...
            </>
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" />
              Đăng yêu cầu
            </>
          )}
        </Button>
      </div>
    </PageShell>
  );
}
