/**
 * GoalWizard — Pillar #1 UI V1.
 *
 * 2 step:
 *   1. User gõ goal text → API parse + plan
 *   2. Render weekly plan với doc cards mini + CTA "Tạo workspace ôn thi này"
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronRight, Loader2, Sparkles, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n/context';

const QUICK_GOALS = [
  'Ôn thi tốt nghiệp Toán THPT 2025 trong 4 tuần',
  'Học IELTS 6.5 trong 3 tháng',
  'Ôn chuyên Vật lý lớp 11 nâng cao trong 6 tuần',
  'Củng cố Hoá lớp 12 — đạo hàm + tích phân trong 2 tuần',
  'Học lập trình Python từ con số 0 trong 8 tuần',
];

type DocMini = {
  id: string;
  title: string;
  docType: string;
  pageCount: number | null;
  ratingAvg: number | null;
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
  goal: {
    subjectSlug: string;
    level: string;
    grade?: number;
    deadlineWeeks: number;
    currentScore?: number;
    targetScore?: number;
    goalType: string;
  };
  summary: string;
  weeks: WeeklyPlan[];
};

const DOC_TYPE_LABEL: Record<string, string> = {
  lecture_notes: 'Bài giảng',
  summary: 'Đề cương',
  exam: 'Đề thi',
  exercise: 'Bài tập',
  solution: 'Lời giải',
  reference_book: 'Tham khảo',
};

export function GoalWizard() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [plan, setPlan] = React.useState<StudyPlan | null>(null);
  const [creating, setCreating] = React.useState(false);

  const submit = async (msg?: string) => {
    const userMessage = (msg ?? input).trim();
    if (userMessage.length < 5) {
      toast.error(t('library.goal.describe_clearer'));
      return;
    }
    setLoading(true);
    setPlan(null);
    try {
      const data = await apiSend<StudyPlan>('/api/library/goal', 'POST', {
        userMessage,
      });
      setPlan(data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const createWorkspace = async () => {
    if (!plan) return;
    setCreating(true);
    try {
      const ws = await apiSend<{ workspace: { id: string } }>(
        '/api/workspaces',
        'POST',
        {
          name: plan.summary.slice(0, 80),
          description: t('library.goal.ws_auto_desc').replace(
            '{count}',
            String(plan.weeks.length),
          ),
        },
      );
      const workspaceId = ws.workspace.id;
      void qc.invalidateQueries({ queryKey: qk.workspaces() });

      // Import tất cả docs liên quan (theory + exercise + exam) parallel
      const allDocIds = new Set<string>();
      for (const w of plan.weeks) {
        w.recommendedDocs.theory.forEach((d) => allDocIds.add(d.id));
        w.recommendedDocs.exercise.forEach((d) => allDocIds.add(d.id));
        w.recommendedDocs.exam.forEach((d) => allDocIds.add(d.id));
      }
      await Promise.all(
        Array.from(allDocIds).map((docId) =>
          apiSend(`/api/library/docs/${docId}/import`, 'POST', {
            workspaceId,
          }).catch(() => null),
        ),
      );

      toast.success(
        t('library.goal.ws_created').replace('{count}', String(allDocIds.size)),
      );
      router.push(`/workspaces/${workspaceId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Goal input */}
      {!plan && (
        <section className="space-y-3 rounded-2xl border border-discovery-500/30 bg-discovery-500/5 p-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-discovery-600" />
            <p className="text-[13px] font-semibold">{t('library.goal.describe_title')}</p>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Vd: "Ôn thi tốt nghiệp Toán THPT 2025 trong 4 tuần, hiện 7.5đ mục tiêu 9đ"'
            rows={3}
            maxLength={500}
            className="resize-none bg-card"
          />
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {t('library.goal.quick_hint')}
            </span>
            {QUICK_GOALS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setInput(g);
                  void submit(g);
                }}
                disabled={loading}
                className="rounded-full border border-divider bg-card px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:border-discovery-500/40 hover:bg-discovery-500/5"
              >
                {g}
              </button>
            ))}
          </div>
          <Button onClick={() => submit()} disabled={loading || input.length < 5}>
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {t('library.goal.build_btn')}
          </Button>
        </section>
      )}

      {/* Plan result */}
      {plan && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-discovery-500/30 bg-discovery-500/5 p-4">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-discovery-600">
              {t('library.goal.your_plan')}
            </p>
            <h2 className="text-lg font-bold tracking-tight">{plan.summary}</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('library.goal.weeks_avg')
                .replace('{weeks}', String(plan.weeks.length))
                .replace('{hours}', String(plan.weeks[0]?.estimatedHours ?? 10))}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={createWorkspace} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                )}
                {t('library.goal.create_ws')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPlan(null);
                  setInput('');
                }}
              >
                {t('library.goal.other_goal')}
              </Button>
            </div>
          </div>

          {/* Weekly plan */}
          <div className="space-y-3">
            {plan.weeks.map((w) => (
              <WeekCard key={w.weekNum} week={w} />
            ))}
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
    <article className="rounded-2xl border border-divider bg-card p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-discovery-500/15 font-mono text-[12px] font-bold text-discovery-700 dark:text-discovery-300">
            {week.weekNum}
          </span>
          <div>
            <p className="text-[14px] font-semibold">
              {t('library.goal.week')
                .replace('{num}', String(week.weekNum))
                .replace('{title}', week.title)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              <Calendar className="mr-0.5 inline h-2.5 w-2.5" />
              {t('library.goal.week_meta')
                .replace('{hours}', String(week.estimatedHours))
                .replace('{docs}', String(totalDocs))}
            </p>
          </div>
        </div>
      </header>

      {/* Topics */}
      {week.topics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {week.topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Doc clusters */}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {[
          { label: t('library.goal.cluster_theory'), docs: week.recommendedDocs.theory, color: 'sky' },
          { label: t('library.goal.cluster_exercise'), docs: week.recommendedDocs.exercise, color: 'emerald' },
          { label: t('library.goal.cluster_exam'), docs: week.recommendedDocs.exam, color: 'rose' },
        ].map((cluster) => (
          <div key={cluster.label} className="space-y-1.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {cluster.label}
            </p>
            {cluster.docs.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground/60">{t('library.goal.cluster_empty')}</p>
            ) : (
              <ul className="space-y-1">
                {cluster.docs.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/library/${d.id}`}
                      className="group flex items-start gap-1.5 rounded-lg border border-divider bg-muted/30 px-2 py-1.5 text-[11.5px] transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-medium leading-tight">{d.title}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {d.pageCount ? `${d.pageCount}p` : ''}
                          {d.ratingAvg ? ` · ★ ${d.ratingAvg.toFixed(1)}` : ''}
                        </p>
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
