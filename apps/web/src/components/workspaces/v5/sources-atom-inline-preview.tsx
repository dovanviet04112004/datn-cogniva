'use client';

import * as React from 'react';
import { BrainCircuit, ListChecks, Loader2, Sparkles, Target, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { getMasteryLevel, MASTERY_LEVEL_LABEL, MASTERY_LEVEL_STYLE } from '@/lib/mastery-ui';
import { useAtomPreview } from './atom-preview-context';
import { useNotebook } from './notebook-context';

type AtomData = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  examples: string[];
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  mastery: {
    score: number;
    attempts: number;
    correct: number;
    lastSeenAt: string | null;
    lastQuizAt: string | null;
    lastFlashcardAt: string | null;
    lastExamAt: string | null;
  } | null;
  counts: {
    flashcards: number;
    quizQuestions: number;
    examQuestions: number;
  };
};

export function SourcesAtomInlinePreview() {
  const ctx = useAtomPreview();
  const { setMainView } = useNotebook();

  const atomId = ctx?.atomId ?? null;

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.atomDetail(atomId ?? ''),
    queryFn: () => apiGet<{ atom: AtomData }>(`/api/atoms/${atomId}`).then((d) => d.atom),
    enabled: !!atomId,
  });

  if (!ctx?.atomId) return null;

  const mastery = data?.mastery;
  const score = mastery?.score ?? null;
  const level = getMasteryLevel(score);
  const dot = MASTERY_LEVEL_STYLE[level].dot;

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-r">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Sparkles className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p
              className="line-clamp-2 text-[13px] font-semibold tracking-tight"
              title={data?.name ?? ''}
            >
              {data?.name ?? (loading ? 'Đang tải…' : 'Atom')}
            </p>
            {data && (
              <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    MASTERY_LEVEL_STYLE[level].chip,
                  )}
                  title={score === null ? 'Chưa học' : `Mastery ${(score * 100).toFixed(0)}%`}
                >
                  {MASTERY_LEVEL_LABEL[level]}
                </span>
                <span>{data.domain}</span>
                {data.difficulty !== null && (
                  <>
                    <span>·</span>
                    <span>Độ khó {data.difficulty}/5</span>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại danh sách"
            title="Đóng"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : !data ? (
          <p className="text-muted-foreground text-center text-[11px]">Atom không tải được.</p>
        ) : (
          <div className="space-y-3 text-[12px]">
            {data.description && (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
                  Mô tả
                </h3>
                <p className="text-foreground/90 leading-relaxed">{data.description}</p>
              </section>
            )}

            {data.examples.length > 0 && (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
                  Ví dụ
                </h3>
                <ul className="text-foreground/90 list-disc space-y-0.5 pl-4">
                  {data.examples.slice(0, 3).map((ex, i) => (
                    <li key={i} className="leading-snug">
                      {ex}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.previewQuestion && (
              <section className="bg-muted/30 rounded-md border p-2">
                <h3 className="text-primary text-[11px] font-semibold uppercase tracking-wider">
                  Câu hỏi gợi ý
                </h3>
                <p className="text-foreground/90 mt-1">{data.previewQuestion}</p>
                {data.previewAnswer && (
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    <span className="font-medium">Đáp án: </span>
                    {data.previewAnswer}
                  </p>
                )}
              </section>
            )}

            {mastery && (
              <section className="bg-primary/5 rounded-md border p-2">
                <h3 className="text-primary text-[11px] font-semibold uppercase tracking-wider">
                  Mastery
                </h3>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-primary text-[16px] font-semibold">
                    {(mastery.score * 100).toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {mastery.correct}/{mastery.attempts} đúng
                  </span>
                </div>
                <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className={cn('h-full rounded-full', dot)}
                    style={{ width: `${(mastery.score * 100).toFixed(0)}%` }}
                  />
                </div>
              </section>
            )}

            <section className="grid grid-cols-3 gap-1.5">
              <CountChip icon={BrainCircuit} label="FC" count={data.counts.flashcards} />
              <CountChip icon={ListChecks} label="Quiz" count={data.counts.quizQuestions} />
              <CountChip icon={Target} label="Exam" count={data.counts.examQuestions} />
            </section>
          </div>
        )}
      </div>

      <footer className="bg-muted/20 shrink-0 space-y-1.5 border-t px-2 py-2">
        <button
          type="button"
          onClick={() => setMainView('flashcard')}
          disabled={!data || data.counts.flashcards === 0}
          title={
            data && data.counts.flashcards === 0
              ? 'Atom này chưa có flashcard'
              : 'Ôn FC đến hạn của workspace (không lọc riêng atom này)'
          }
          className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 block w-full rounded-md border px-2 py-1.5 text-center text-[11px] font-medium transition-colors disabled:opacity-50"
        >
          Ôn FC workspace
        </button>
        <button
          type="button"
          onClick={() => setMainView('quiz')}
          disabled={!data}
          title="5 câu random từ docs đã check trong Sources"
          className="text-muted-foreground hover:bg-muted hover:text-foreground block w-full rounded-md border px-2 py-1.5 text-center text-[11px] font-medium transition-colors disabled:opacity-50"
        >
          Quick quiz workspace
        </button>
      </footer>
    </aside>
  );
}

function CountChip({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="bg-card rounded-md border px-1.5 py-1.5 text-center">
      <Icon className="text-muted-foreground mx-auto h-3 w-3" />
      <p className="mt-0.5 text-[14px] font-semibold tabular-nums">{count}</p>
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
    </div>
  );
}
