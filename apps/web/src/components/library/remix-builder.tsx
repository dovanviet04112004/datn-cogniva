/**
 * RemixBuilder — Bonus #12 Doc Remix UI client (Phase 3, 2026-05-27).
 *
 * 2-pane:
 *   Left: list user's docs (imports + own uploads) với checkbox chọn 2-5
 *   Right: form metadata (title/desc/subject/level) + submit
 *
 * Sau submit → redirect /library/[newDocId] xem kết quả.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Package, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { ComboSelect } from '@/components/ui/combo-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { ALL_SUBJECTS, LEVEL_NAMES } from '@cogniva/db/taxonomy';

const LEVELS = Object.entries(LEVEL_NAMES).map(([value, label]) => ({
  value: value as 'PRIMARY' | 'SECONDARY' | 'HIGH_SCHOOL' | 'UNIVERSITY' | 'ADULT',
  label,
}));

type AvailableDoc = {
  id: string;
  title: string;
  subjectSlug: string;
  docType: string;
  pageCount: number | null;
  qualityScore: number | null;
};

export function RemixBuilder({
  availableDocs,
}: {
  availableDocs: AvailableDoc[];
}) {
  const t = useT();
  const router = useRouter();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [subjectSlug, setSubjectSlug] = React.useState('math');
  const [level, setLevel] = React.useState<'PRIMARY' | 'SECONDARY' | 'HIGH_SCHOOL' | 'UNIVERSITY' | 'ADULT'>('HIGH_SCHOOL');
  const [grade, setGrade] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 5) {
          toast.error(t('library.remix.max_docs'));
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  // Auto-suggest subject từ doc đầu tiên được chọn
  React.useEffect(() => {
    if (selectedIds.size > 0) {
      const first = availableDocs.find((d) => selectedIds.has(d.id));
      if (first) setSubjectSlug(first.subjectSlug);
    }
  }, [selectedIds, availableDocs]);

  // Auto-suggest title từ selected docs
  React.useEffect(() => {
    if (selectedIds.size > 0 && !title) {
      const selected = availableDocs.filter((d) => selectedIds.has(d.id));
      const subj = ALL_SUBJECTS.find((s) => s.slug === selected[0]?.subjectSlug);
      setTitle(
        t('library.remix.title_suggest')
          .replace('{subject}', subj?.name ?? t('library.remix.title_suggest_fallback'))
          .replace('{count}', String(selected.length)),
      );
    }
  }, [selectedIds, availableDocs, title]);

  const submit = async () => {
    if (selectedIds.size < 2) {
      toast.error(t('library.remix.min_docs'));
      return;
    }
    if (title.trim().length < 5) {
      toast.error(t('library.remix.title_min'));
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiSend<{ docId: string }>('/api/library/remix', 'POST', {
        title: title.trim(),
        description: description.trim() || undefined,
        subjectSlug,
        level,
        grade,
        sourceDocIds: Array.from(selectedIds),
      });
      toast.success(t('library.remix.created'));
      router.push(`/library/${data.docId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (availableDocs.length === 0) {
    return (
      <div className="rounded-xl border border-divider bg-card p-8 text-center">
        <p className="text-[13px] text-muted-foreground">
          {t('library.remix.empty_prefix')}{' '}
          <Link href="/library" className="text-primary hover:underline">
            {t('library.remix.empty_link')}
          </Link>{' '}
          {t('library.remix.empty_suffix')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Left: doc picker */}
      <section>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('library.remix.pick_source').replace('{count}', String(selectedIds.size))}
          {selectedIds.size >= 2 && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              {t('library.remix.ready')}
            </span>
          )}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {availableDocs.map((d) => {
            const selected = selectedIds.has(d.id);
            const subj = ALL_SUBJECTS.find((s) => s.slug === d.subjectSlug);
            return (
              <li key={d.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-all',
                    selected
                      ? 'border-discovery-500 bg-discovery-500/5'
                      : 'border-divider bg-card hover:border-discovery-500/30',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(d.id)}
                    className="mt-1 h-3.5 w-3.5 accent-discovery-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug">
                      {d.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                      <span>
                        {subj?.emoji} {subj?.name}
                      </span>
                      <span>·</span>
                      <span className="rounded bg-muted px-1 py-0">
                        {t(`library.doctype.${d.docType}`)}
                      </span>
                      <span>·</span>
                      <span>{t('library.remix.pages').replace('{count}', String(d.pageCount ?? '–'))}</span>
                      {d.qualityScore != null && d.qualityScore > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            Q{Number(d.qualityScore).toFixed(0)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Right: form */}
      <aside className="sticky top-20 flex flex-col gap-3 self-start rounded-xl border border-divider bg-card p-4">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3 w-3" />
          {t('library.remix.metadata')}
        </p>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold">{t('library.remix.title_label')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={t('library.remix.title_placeholder')}
            className="w-full rounded-md border border-divider bg-background px-2 py-1.5 text-[12.5px]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold">{t('library.remix.desc_label')}</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t('library.remix.desc_placeholder')}
            className="resize-none text-[12px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{t('library.remix.subject_label')}</label>
            {/* Thay <select> native bằng ComboSelect (gõ-để-lọc môn taxonomy) */}
            <ComboSelect
              value={subjectSlug}
              onChange={(v) => setSubjectSlug(v)}
              options={ALL_SUBJECTS.map((s) => ({ value: s.slug, label: `${s.emoji} ${s.name}` }))}
              placeholder={t('library.remix.subject_label')}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{t('library.remix.level_label')}</label>
            {/* Thay <select> native bằng ComboSelect (enum cấp học) */}
            <ComboSelect
              value={level}
              onChange={(v) => setLevel(v as typeof level)}
              options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
              placeholder={t('library.remix.level_label')}
            />
          </div>
        </div>

        {level === 'PRIMARY' || level === 'SECONDARY' || level === 'HIGH_SCHOOL' ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{t('library.remix.grade_label')}</label>
            <input
              type="number"
              min={1}
              max={12}
              value={grade ?? ''}
              onChange={(e) =>
                setGrade(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full rounded-md border border-divider bg-background px-2 py-1.5 text-[12px]"
            />
          </div>
        ) : null}

        {/* Selected sources preview */}
        {selectedIds.size > 0 && (
          <div className="rounded-lg border border-divider/60 bg-muted/30 p-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('library.remix.sources').replace('{count}', String(selectedIds.size))}
            </p>
            <ul className="space-y-0.5">
              {availableDocs
                .filter((d) => selectedIds.has(d.id))
                .map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-1 text-[11px]"
                  >
                    <span className="truncate">{d.title}</span>
                    <button
                      type="button"
                      onClick={() => toggleSelect(d.id)}
                      className="ml-auto shrink-0 rounded p-0.5 hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <Button
          onClick={submit}
          disabled={submitting || selectedIds.size < 2}
          className="mt-1 w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              {t('library.remix.submitting')}
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t('library.remix.submit').replace('{count}', String(selectedIds.size))}
            </>
          )}
        </Button>
      </aside>
    </div>
  );
}
