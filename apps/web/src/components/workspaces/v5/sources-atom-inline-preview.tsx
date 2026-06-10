/**
 * SourcesAtomInlinePreview — V8.10 (2026-05-20).
 *
 * Render khi `useAtomPreview().atomId != null` — sidebar Sources tạm thời
 * thay đổi content thành preview của atom đang xem.
 *
 * Layout (fit 320px sidebar width):
 *   - Header: atom name + close button
 *   - Domain badge + mastery dot
 *   - Description (truncated)
 *   - Preview Q/A (nếu có)
 *   - Mastery stats compact (score, attempts, last seen)
 *   - Actions: "Ôn flashcard", "Quiz check", "Mind map highlight"
 *   - Counts: "X FC · Y quiz · Z exam"
 *
 * KHÔNG render full flashcards/quiz/exam list (giữ ở trang /atoms/[id] hiện
 * có nếu user cần full).
 *
 * Fetch /api/atoms/[id] (AtomView). Loading state có skeleton.
 */
'use client';

import * as React from 'react';
import { BrainCircuit, ListChecks, Loader2, Sparkles, Target, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import {
  getMasteryLevel,
  MASTERY_LEVEL_LABEL,
  MASTERY_LEVEL_STYLE,
} from '@/lib/mastery-ui';
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
    queryFn: () =>
      apiGet<{ atom: AtomData }>(`/api/atoms/${atomId}`).then((d) => d.atom),
    enabled: !!atomId,
  });

  if (!ctx?.atomId) return null;

  const mastery = data?.mastery;
  const score = mastery?.score ?? null;
  // Ngưỡng/level gom ở @cogniva/shared/domain (không hardcode 0.85/0.3 nữa).
  const level = getMasteryLevel(score);
  const dot = MASTERY_LEVEL_STYLE[level].dot;

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r bg-card">
      {/* Header */}
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p
              className="line-clamp-2 text-[13px] font-semibold tracking-tight"
              title={data?.name ?? ''}
            >
              {data?.name ?? (loading ? 'Đang tải…' : 'Atom')}
            </p>
            {data && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-center text-[11px] text-muted-foreground">
            Atom không tải được.
          </p>
        ) : (
          <div className="space-y-3 text-[12px]">
            {/* Description */}
            {data.description && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Mô tả
                </h3>
                <p className="leading-relaxed text-foreground/90">
                  {data.description}
                </p>
              </section>
            )}

            {/* Examples */}
            {data.examples.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ví dụ
                </h3>
                <ul className="list-disc space-y-0.5 pl-4 text-foreground/90">
                  {data.examples.slice(0, 3).map((ex, i) => (
                    <li key={i} className="leading-snug">
                      {ex}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Preview Q/A */}
            {data.previewQuestion && (
              <section className="rounded-md border bg-muted/30 p-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Câu hỏi gợi ý
                </h3>
                <p className="mt-1 text-foreground/90">{data.previewQuestion}</p>
                {data.previewAnswer && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="font-medium">Đáp án: </span>
                    {data.previewAnswer}
                  </p>
                )}
              </section>
            )}

            {/* Mastery card */}
            {mastery && (
              <section className="rounded-md border bg-primary/5 p-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Mastery
                </h3>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[16px] font-semibold text-primary">
                    {(mastery.score * 100).toFixed(0)}%
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {mastery.correct}/{mastery.attempts} đúng
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', dot)}
                    style={{ width: `${(mastery.score * 100).toFixed(0)}%` }}
                  />
                </div>
              </section>
            )}

            {/* Counts */}
            <section className="grid grid-cols-3 gap-1.5">
              <CountChip
                icon={BrainCircuit}
                label="FC"
                count={data.counts.flashcards}
              />
              <CountChip
                icon={ListChecks}
                label="Quiz"
                count={data.counts.quizQuestions}
              />
              <CountChip
                icon={Target}
                label="Exam"
                count={data.counts.examQuestions}
              />
            </section>
          </div>
        )}
      </div>

      {/* Footer actions.
          V8.11: rõ ràng workspace-scope (không phải atom-scope) — backend
          chưa support filter FC/quiz theo atom đơn lẻ. Disable nếu atom
          không có FC nào (counts.flashcards = 0). */}
      <footer className="shrink-0 space-y-1.5 border-t bg-muted/20 px-2 py-2">
        <button
          type="button"
          onClick={() => setMainView('flashcard')}
          disabled={!data || data.counts.flashcards === 0}
          title={
            data && data.counts.flashcards === 0
              ? 'Atom này chưa có flashcard'
              : 'Ôn FC đến hạn của workspace (không lọc riêng atom này)'
          }
          className="block w-full rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-center text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          Ôn FC workspace
        </button>
        <button
          type="button"
          onClick={() => setMainView('quiz')}
          disabled={!data}
          title="5 câu random từ docs đã check trong Sources"
          className="block w-full rounded-md border px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
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
    <div className="rounded-md border bg-card px-1.5 py-1.5 text-center">
      <Icon className="mx-auto h-3 w-3 text-muted-foreground" />
      <p className="mt-0.5 text-[14px] font-semibold tabular-nums">{count}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
