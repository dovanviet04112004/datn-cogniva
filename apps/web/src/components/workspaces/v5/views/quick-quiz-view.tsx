/**
 * QuickQuizView — V5 recipe "Quiz check" 5 câu random.
 *
 * Phase V5.2 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.
 *
 * Flow:
 *   1. Fetch /api/workspaces/[id]/quick-quiz → 5 question (no answer)
 *   2. Show 1 câu/lần, user chọn option
 *   3. POST /api/questions/[id]/grade với answer → server check + applyAttempt
 *   4. Reveal correct + explanation + nút "Next"
 *   5. Hết 5 câu → summary (correct count + atoms touched)
 *
 * Ephemeral: KHÔNG persist attempt row. Mỗi câu standalone grade.
 */
'use client';

import * as React from 'react';
import {
  CheckCircle2,
  ListChecks,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useQueryClient } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotebook } from '../notebook-context';

type Question = {
  id: string;
  prompt: string;
  type: string;
  options: string[] | null;
  conceptId: string | null;
  difficulty: number;
};

type GradeResult = {
  correct: boolean;
  correctAnswer: unknown;
  explanation: string;
};

export function QuickQuizView({ workspaceId }: { workspaceId: string }) {
  const { setMainView, selectedDocs } = useNotebook();
  const queryClient = useQueryClient();
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [hint, setHint] = React.useState<string | null>(null);
  const [idx, setIdx] = React.useState(0);
  const [selectedAnswer, setSelectedAnswer] = React.useState<number | string | null>(
    null,
  );
  const [result, setResult] = React.useState<GradeResult | null>(null);
  const [stats, setStats] = React.useState({ correct: 0, total: 0 });
  const [submitting, setSubmitting] = React.useState(false);
  /** V8.20: state khi đang gen quiz từ empty state CTA. */
  const [generating, setGenerating] = React.useState(false);

  const loadQuestions = React.useCallback(() => {
    setLoading(true);
    setHint(null);
    setIdx(0);
    setStats({ correct: 0, total: 0 });
    setSelectedAnswer(null);
    setResult(null);
    fetch(`/api/workspaces/${workspaceId}/quick-quiz`)
      .then((r) => r.json())
      .then((d: { questions: Question[]; hint?: string }) => {
        setQuestions(d.questions);
        if (d.hint) setHint(d.hint);
      })
      .catch(() => toast.error('Load quiz lỗi'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  React.useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  /**
   * V8.20: gen quiz từ Sources docs đã check → seed `question` table với
   * conceptId của workspace, sau đó quick-quiz endpoint pick được 5 câu.
   * Strategy: gen từ doc đầu tiên đã check (5 câu). User có thể click lại
   * để gen thêm từ doc khác.
   */
  const generateQuiz = React.useCallback(async () => {
    if (generating) return;
    const docIds = Array.from(selectedDocs);
    if (docIds.length === 0) {
      toast.error('Chọn ít nhất 1 doc trong Sources để gen quiz');
      return;
    }
    setGenerating(true);
    try {
      await apiSend('/api/quiz/generate', 'POST', {
        documentId: docIds[0],
        count: 5,
        types: ['MCQ', 'TRUE_FALSE'],
        title: `Quick quiz seed — ${new Date().toLocaleString('vi-VN')}`,
      });
      toast.success('Đã gen 5 câu — load lại quiz');
      loadQuestions();
    } catch (err) {
      toast.error('Gen quiz lỗi: ' + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [generating, selectedDocs, loadQuestions]);

  const current = questions[idx];
  const isLast = idx === questions.length - 1;
  const finished = stats.total === questions.length && questions.length > 0;

  const submit = async () => {
    if (!current || selectedAnswer === null || submitting) return;
    setSubmitting(true);
    try {
      const data = await apiSend<GradeResult>(
        `/api/questions/${current.id}/grade`,
        'POST',
        { answer: selectedAnswer },
      );
      setResult(data);
      // Mastery vừa đổi (applyAttempt) → bust list atom để status refetch.
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'sources'] });
      // Câu vừa làm → "đã làm" ở trang quản trị cập nhật.
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'manage'] });
      setStats((s) => ({
        correct: s.correct + (data.correct ? 1 : 0),
        total: s.total + 1,
      }));
    } catch {
      toast.error('Grade lỗi');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (isLast) return; // stays on last, finished view handles
    setIdx(idx + 1);
    setSelectedAnswer(null);
    setResult(null);
  };

  if (loading) {
    return (
      <Wrapper>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Wrapper>
    );
  }

  if (hint === 'no-atoms' || hint === 'no-questions' || questions.length === 0) {
    const isNoAtoms = hint === 'no-atoms';
    return (
      <Wrapper>
        <div className="mx-auto max-w-md py-12 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Chưa có quiz</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isNoAtoms
              ? 'Workspace chưa có atom — upload PDF + đợi AI extract (~30-60s).'
              : 'Sẵn sàng tạo 5 câu quiz từ doc đã check trong Sources.'}
          </p>
          {/* V8.20: CTA trực tiếp gen — không còn dead-end "Vào Practice tab". */}
          {!isNoAtoms && (
            <Button
              type="button"
              size="sm"
              onClick={generateQuiz}
              disabled={generating}
              className="mt-4"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? 'Đang gen…' : 'Tạo 5 câu quiz'}
            </Button>
          )}
        </div>
      </Wrapper>
    );
  }

  if (finished) {
    const pct = Math.round((stats.correct / stats.total) * 100);
    return (
      <Wrapper onBack={() => setMainView('chat')}>
        <div className="mx-auto max-w-md space-y-4 py-8 text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Hết quiz!</h2>
          {/* Điểm tổng kết: số to dùng sans Geist (bỏ font-mono), giữ tabular-nums. */}
          <p className="text-3xl font-bold tabular-nums">
            {stats.correct} / {stats.total}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({pct}%)
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Mastery của các atom đã update. Quay lại chat hỏi tiếp hoặc làm round mới.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={loadQuestions}>
              Round mới
            </Button>
            <Button size="sm" onClick={() => setMainView('chat')}>
              Quay lại chat
            </Button>
          </div>
        </div>
      </Wrapper>
    );
  }

  // MCQ với options array
  const isMcq =
    current!.type === 'MCQ' && Array.isArray(current!.options) && current!.options.length > 0;

  return (
    <Wrapper onBack={() => setMainView('chat')}>
      <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-4 py-6">
        {/* Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              Câu {idx + 1} / {questions.length}
            </span>
            <span>
              ✓ <span className="font-mono">{stats.correct}</span> đúng
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(idx / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Question prompt */}
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm font-medium leading-relaxed">{current!.prompt}</p>
        </div>

        {/* Options */}
        {isMcq && (
          <div className="space-y-2">
            {(current!.options as string[]).map((opt, i) => {
              const isSelected = selectedAnswer === i;
              const isCorrect = result && result.correctAnswer === i;
              const isWrong = result && isSelected && !result.correct;
              return (
                <button
                  key={i}
                  onClick={() => !result && setSelectedAnswer(i)}
                  disabled={!!result}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
                    !result && isSelected && 'border-primary bg-primary/5',
                    !result &&
                      !isSelected &&
                      'border-divider hover:border-primary/30 hover:bg-muted',
                    result &&
                      isCorrect &&
                      'border-success/40 bg-success/10 text-success',
                    result && isWrong && 'border-destructive/40 bg-destructive/10 text-destructive',
                    result && !isSelected && !isCorrect && 'opacity-60',
                  )}
                >
                  <span className="font-mono text-[11px] uppercase">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {result && isCorrect && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {result && isWrong && <X className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Non-MCQ fallback */}
        {!isMcq && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
            Loại câu hỏi {current!.type} chưa support trong Quick Quiz V5.2. Vào
            quiz fullscreen để làm.
          </div>
        )}

        {/* Explanation */}
        {result && (
          <div className="rounded-lg border border-divider bg-muted/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {result.correct ? 'Đúng ✓' : 'Sai ✗'}
            </p>
            <p className="mt-1 text-sm leading-relaxed">{result.explanation}</p>
          </div>
        )}

        {/* Action button */}
        <div className="mt-auto flex justify-end gap-2">
          {!result ? (
            <Button
              size="sm"
              onClick={submit}
              disabled={selectedAnswer === null || submitting || !isMcq}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kiểm tra'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={next}
              disabled={isLast && stats.total < questions.length}
            >
              {isLast ? 'Xem kết quả' : 'Câu tiếp'}
            </Button>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

function Wrapper({
  children,
}: {
  children: React.ReactNode;
  /** V8.25: prop giữ lại signature backward-compat — modal có X riêng. */
  onBack?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2 pr-14">
        <div className="flex items-center justify-end">
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ListChecks className="h-3 w-3 text-primary" />
            Quick Quiz · 5 câu
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
