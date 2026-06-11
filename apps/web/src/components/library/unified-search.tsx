'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Camera,
  ChevronRight,
  Loader2,
  Sparkles,
  Target,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Mode = 'free' | 'goal' | 'reverse';
const MAX_IMG_BYTES = 5 * 1024 * 1024;

const QUICK_GOALS = [
  'Ôn thi tốt nghiệp Toán THPT 2025 trong 4 tuần',
  'IELTS 6.5 trong 3 tháng',
  'Ôn chuyên Vật lý lớp 11 nâng cao 6 tuần',
  'Python từ con số 0 trong 8 tuần',
];

const FREE_SUGGESTIONS = [
  'đạo hàm hàm hợp',
  'định lý Vi-et',
  'IELTS speaking part 2 sample',
  'phản ứng oxi hoá khử',
];

type DocMini = {
  id: string;
  title: string;
  docType?: string;
  pageCount?: number | null;
  ratingAvg?: number | null;
};

type WeeklyPlan = {
  weekNum: number;
  title: string;
  topics: string[];
  estimatedHours: number;
  recommendedDocs: {
    theory: DocMini[];
    exercise: DocMini[];
    exam: DocMini[];
  };
};

type StudyPlan = {
  summary: string;
  weeks: WeeklyPlan[];
};

type CrossDocHit = {
  chunkId: string;
  docId: string;
  docTitle: string;
  pageNum: number;
  excerptHtml: string;
};

type ReverseResult = {
  detectedQuestion: string;
  analysis: {
    subjectSlug: string;
    level: string;
    topic: string;
    atomKeywords: string[];
    difficulty: 'easy' | 'medium' | 'hard';
  };
  theory: CrossDocHit[];
  exercise: CrossDocHit[];
  exam: CrossDocHit[];
};

const MODE_DEFS: Array<{
  value: Mode;
  icon: typeof Sparkles;
  labelKey: string;
  descriptionKey: string;
  activeClass: string;
}> = [
  {
    value: 'free',
    icon: Sparkles,
    labelKey: 'library.search.mode.free',
    descriptionKey: 'library.search.mode.free_desc',
    activeClass:
      'border-discovery-500/50 bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 font-semibold',
  },
  {
    value: 'goal',
    icon: Target,
    labelKey: 'library.search.mode.goal',
    descriptionKey: 'library.search.mode.goal_desc',
    activeClass: 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-semibold',
  },
  {
    value: 'reverse',
    icon: Camera,
    labelKey: 'library.search.mode.reverse',
    descriptionKey: 'library.search.mode.reverse_desc',
    activeClass: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold',
  },
];

export function UnifiedSearch() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<Mode>('free');
  const [text, setText] = React.useState('');
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [studyPlan, setStudyPlan] = React.useState<StudyPlan | null>(null);
  const [reverseResult, setReverseResult] = React.useState<ReverseResult | null>(null);
  const [creating, setCreating] = React.useState(false);

  const clearResults = () => {
    setStudyPlan(null);
    setReverseResult(null);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearResults();
  };

  const handleImage = (f: File | null) => {
    if (!f) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      toast.error(t('library.search.img_too_large'));
      return;
    }
    if (!f.type.startsWith('image/')) {
      toast.error(t('library.search.img_only'));
      return;
    }
    setImageFile(f);
    setImagePreviewUrl(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (mode === 'free') {
      const q = text.trim();
      if (!q) {
        toast.error(t('library.search.type_keyword'));
        return;
      }
      router.push(`/library?q=${encodeURIComponent(q)}`);
      return;
    }

    if (mode === 'goal') {
      const userMessage = text.trim();
      if (userMessage.length < 5) {
        toast.error(t('library.search.goal_clearer'));
        return;
      }
      setLoading(true);
      clearResults();
      try {
        const data = await apiSend<StudyPlan>('/api/library/goal', 'POST', {
          userMessage,
        });
        setStudyPlan(data);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'reverse') {
      if (!imageFile && text.trim().length < 10) {
        toast.error(t('library.search.reverse_need_input'));
        return;
      }
      setLoading(true);
      clearResults();
      try {
        let body: Record<string, unknown> = {};
        if (imageFile) {
          const buf = await imageFile.arrayBuffer();
          const base64 = btoa(
            Array.from(new Uint8Array(buf))
              .map((b) => String.fromCharCode(b))
              .join(''),
          );
          body = {
            problemImageBase64: base64,
            problemImageMimeType: imageFile.type,
          };
        } else {
          body = { problemText: text.trim() };
        }
        const data = await apiSend<ReverseResult>('/api/library/search/reverse', 'POST', body);
        setReverseResult(data);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
  };

  const createWorkspace = async () => {
    if (!studyPlan) return;
    setCreating(true);
    try {
      const ws = await apiSend<{ workspace: { id: string } }>('/api/workspaces', 'POST', {
        name: studyPlan.summary.slice(0, 80),
        description: t('library.search.ws_auto_desc').replace(
          '{count}',
          String(studyPlan.weeks.length),
        ),
      });
      const workspaceId = ws.workspace.id;
      void qc.invalidateQueries({ queryKey: qk.workspaces() });

      const allIds = new Set<string>();
      for (const w of studyPlan.weeks) {
        w.recommendedDocs.theory.forEach((d) => allIds.add(d.id));
        w.recommendedDocs.exercise.forEach((d) => allIds.add(d.id));
        w.recommendedDocs.exam.forEach((d) => allIds.add(d.id));
      }
      await Promise.all(
        Array.from(allIds).map((id) =>
          apiSend(`/api/library/docs/${id}/import`, 'POST', { workspaceId }).catch(() => null),
        ),
      );
      toast.success(t('library.search.ws_created').replace('{count}', String(allIds.size)));
      router.push(`/workspaces/${workspaceId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const modeDef = MODE_DEFS.find((m) => m.value === mode)!;
  const ModeIcon = modeDef.icon;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {MODE_DEFS.map((m) => {
          const Icon = m.icon;
          const active = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => switchMode(m.value)}
              className={cn(
                'group/m flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] transition-all',
                active
                  ? m.activeClass
                  : 'border-divider bg-card text-muted-foreground hover:border-foreground/30 hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t(m.labelKey)}</span>
              {active && (
                <span className="hidden text-[11px] font-normal opacity-75 sm:inline">
                  · {t(m.descriptionKey)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          'bg-card rounded-2xl border-2 p-4 transition-colors focus-within:ring-4',
          mode === 'free' &&
            'border-discovery-500/30 focus-within:border-discovery-500/50 focus-within:ring-discovery-500/10',
          mode === 'goal' &&
            'border-sky-500/30 focus-within:border-sky-500/50 focus-within:ring-sky-500/10',
          mode === 'reverse' &&
            'border-rose-500/30 focus-within:border-rose-500/50 focus-within:ring-rose-500/10',
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <ModeIcon
            className={cn(
              'h-4 w-4',
              mode === 'free' && 'text-discovery-600',
              mode === 'goal' && 'text-sky-600',
              mode === 'reverse' && 'text-rose-600',
            )}
          />
          <p className="text-[12px] font-semibold">{t(modeDef.descriptionKey)}</p>
        </div>

        {mode === 'free' && (
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={t('library.search.free_placeholder')}
            className="placeholder:text-muted-foreground w-full border-0 bg-transparent text-[14px] outline-none"
          />
        )}

        {mode === 'goal' && (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('library.search.goal_placeholder')}
            rows={3}
            maxLength={500}
            className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        )}

        {mode === 'reverse' && (
          <div className="space-y-2">
            {imagePreviewUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviewUrl}
                  alt={t('library.search.img_alt')}
                  className="max-h-48 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => handleImage(null)}
                  className="absolute -right-2 -top-2 rounded-full bg-rose-500 p-1 text-white shadow"
                  aria-label={t('library.search.remove_img_aria')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <label className="border-divider bg-muted/30 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[12px] transition-colors hover:border-rose-500/30 hover:bg-rose-500/5">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImage(e.target.files?.[0] ?? null)}
                />
                <UploadIcon className="text-muted-foreground h-3.5 w-3.5" />
                <span className="text-muted-foreground">{t('library.search.upload_problem')}</span>
              </label>
            )}
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('library.search.reverse_placeholder')}
              rows={3}
              maxLength={3000}
              className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {mode === 'free' &&
              FREE_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setText(s);
                    router.push(`/library?q=${encodeURIComponent(s)}`);
                  }}
                  className="border-divider text-muted-foreground hover:border-discovery-500/40 hover:text-discovery-600 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                >
                  {s}
                </button>
              ))}
            {mode === 'goal' &&
              QUICK_GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setText(g)}
                  className="border-divider text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:border-sky-500/40 hover:text-sky-600"
                >
                  {g}
                </button>
              ))}
          </div>
          <Button
            onClick={submit}
            disabled={loading}
            className={cn(
              mode === 'free' && 'bg-discovery-600 hover:bg-discovery-700',
              mode === 'goal' && 'bg-sky-600 hover:bg-sky-700',
              mode === 'reverse' && 'bg-rose-600 hover:bg-rose-700',
            )}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ModeIcon className="mr-1 h-3.5 w-3.5" />
            )}
            {mode === 'free' && t('library.search.btn_free')}
            {mode === 'goal' && t('library.search.btn_goal')}
            {mode === 'reverse' && t('library.search.btn_reverse')}
          </Button>
        </div>
      </div>

      {studyPlan && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sky-600">
              {t('library.search.your_plan')}
            </p>
            <h2 className="text-lg font-bold tracking-tight">{studyPlan.summary}</h2>
            <p className="text-muted-foreground mt-1 text-[12px]">
              {t('library.search.weeks_avg')
                .replace('{weeks}', String(studyPlan.weeks.length))
                .replace('{hours}', String(studyPlan.weeks[0]?.estimatedHours ?? 10))}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={createWorkspace} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                )}
                {t('library.search.create_ws_plan')}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {studyPlan.weeks.map((w) => (
              <WeekCard key={w.weekNum} week={w} />
            ))}
          </div>
        </section>
      )}

      {reverseResult && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-rose-600">
              {t('library.search.ai_analysis')}
            </p>
            <p className="text-[13px] font-semibold">
              {t('library.search.topic')}{' '}
              <span className="text-rose-700 dark:text-rose-300">
                {reverseResult.analysis.topic}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 text-[12px]">
              {t('library.search.subject')} {reverseResult.analysis.subjectSlug} ·{' '}
              {t('library.search.level')} {reverseResult.analysis.level} ·{' '}
              {t('library.search.difficulty')}{' '}
              <span
                className={cn(
                  'font-semibold',
                  reverseResult.analysis.difficulty === 'hard' && 'text-rose-600',
                  reverseResult.analysis.difficulty === 'medium' && 'text-amber-600',
                  reverseResult.analysis.difficulty === 'easy' && 'text-emerald-600',
                )}
              >
                {reverseResult.analysis.difficulty === 'hard'
                  ? t('library.search.diff.hard')
                  : reverseResult.analysis.difficulty === 'medium'
                    ? t('library.search.diff.medium')
                    : t('library.search.diff.easy')}
              </span>
            </p>
            {reverseResult.analysis.atomKeywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {reverseResult.analysis.atomKeywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <ReverseCluster
              title={t('library.search.cluster.theory')}
              hits={reverseResult.theory}
            />
            <ReverseCluster
              title={t('library.search.cluster.exercise_similar')}
              hits={reverseResult.exercise}
            />
            <ReverseCluster
              title={t('library.search.cluster.exam_similar')}
              hits={reverseResult.exam}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function WeekCard({ week }: { week: WeeklyPlan }) {
  const t = useT();
  const totalDocs =
    week.recommendedDocs.theory.length +
    week.recommendedDocs.exercise.length +
    week.recommendedDocs.exam.length;

  return (
    <article className="border-divider bg-card rounded-2xl border p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 font-mono text-[12px] font-bold text-sky-700 dark:text-sky-300">
            {week.weekNum}
          </span>
          <div>
            <p className="text-[14px] font-semibold">
              {t('library.search.week')
                .replace('{num}', String(week.weekNum))
                .replace('{title}', week.title)}
            </p>
            <p className="text-muted-foreground text-[11px]">
              {t('library.search.week_meta')
                .replace('{hours}', String(week.estimatedHours))
                .replace('{docs}', String(totalDocs))}
            </p>
          </div>
        </div>
      </header>

      {week.topics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {week.topics.map((t) => (
            <span
              key={t}
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {[
          { label: t('library.search.cluster.theory_short'), docs: week.recommendedDocs.theory },
          { label: t('library.search.cluster.exercise'), docs: week.recommendedDocs.exercise },
          { label: t('library.search.cluster.exam'), docs: week.recommendedDocs.exam },
        ].map((cluster) => (
          <div key={cluster.label} className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              {cluster.label}
            </p>
            {cluster.docs.length === 0 ? (
              <p className="text-muted-foreground/60 text-[11px] italic">
                {t('library.search.cluster_empty')}
              </p>
            ) : (
              <ul className="space-y-1">
                {cluster.docs.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/library/${d.id}`}
                      className="border-divider bg-muted/30 hover:border-primary/30 hover:bg-primary/5 group flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-[11.5px] transition-colors"
                    >
                      <ChevronRight className="text-muted-foreground/60 mt-0.5 h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-medium leading-tight">{d.title}</p>
                        {(d.pageCount || d.ratingAvg) && (
                          <p className="text-muted-foreground mt-0.5 text-[10px]">
                            {d.pageCount ? `${d.pageCount}p` : ''}
                            {d.ratingAvg ? ` · ★ ${d.ratingAvg.toFixed(1)}` : ''}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function ReverseCluster({ title, hits }: { title: string; hits: CrossDocHit[] }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        {title}{' '}
        <span className="text-muted-foreground/60 font-mono text-[10px]">({hits.length})</span>
      </p>
      {hits.length === 0 ? (
        <p className="border-divider text-muted-foreground/60 rounded-lg border border-dashed px-3 py-4 text-center text-[11px] italic">
          {t('library.search.cluster_empty')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {hits.map((d) => (
            <li key={d.chunkId}>
              <Link
                href={`/library/${d.docId}`}
                className="border-divider bg-card hover:border-primary/30 hover:bg-primary/5 group block rounded-lg border p-2.5 transition-colors"
              >
                <div className="flex items-start gap-1.5">
                  <ChevronRight className="text-muted-foreground/60 mt-0.5 h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12px] font-semibold leading-tight">
                      {d.docTitle}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {t('library.search.page')} {d.pageNum}
                    </p>
                  </div>
                </div>
                <p
                  className="text-muted-foreground [&_mark]:text-foreground mt-1.5 line-clamp-3 text-[11px] leading-snug [&_mark]:rounded [&_mark]:bg-amber-500/30 [&_mark]:px-0.5"
                  dangerouslySetInnerHTML={{ __html: d.excerptHtml }}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
