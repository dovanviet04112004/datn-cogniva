'use client';

import * as React from 'react';
import { CheckCircle2, ListChecks, Loader2, Sparkles, X } from 'lucide-react';
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
  const [selectedAnswer, setSelectedAnswer] = React.useState<number | string | null>(null);
  const [result, setResult] = React.useState<GradeResult | null>(null);
  const [stats, setStats] = React.useState({ correct: 0, total: 0 });
  const [submitting, setSubmitting] = React.useState(false);
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
      const data = await apiSend<GradeResult>(`/api/questions/${current.id}/grade`, 'POST', {
        answer: selectedAnswer,
      });
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'sources'] });
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
    if (isLast) return;
    setIdx(idx + 1);
    setSelectedAnswer(null);
    setResult(null);
  };

  if (loading) {
    return (
      <Wrapper>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      </Wrapper>
    );
  }

  if (hint === 'no-atoms' || hint === 'no-questions' || questions.length === 0) {
    const isNoAtoms = hint === 'no-atoms';
    return (
      <Wrapper>
        <div className="mx-auto max-w-md py-12 text-center">
          <div className="bg-primary/10 text-primary mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl">
            <ListChecks className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Chưa có quiz</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {isNoAtoms
              ? 'Workspace chưa có atom — upload PDF + đợi AI extract (~30-60s).'
              : 'Sẵn sàng tạo 5 câu quiz từ doc đã check trong Sources.'}
          </p>
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
          <div className="bg-primary/10 text-primary mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Hết quiz!</h2>
          <p className="text-3xl font-bold tabular-nums">
            {stats.correct} / {stats.total}
            <span className="text-muted-foreground ml-2 text-sm font-normal">({pct}%)</span>
          </p>
          <p className="text-muted-foreground text-xs">
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

  const isMcq =
    current!.type === 'MCQ' && Array.isArray(current!.options) && current!.options.length > 0;

  return (
    <Wrapper onBack={() => setMainView('chat')}>
      <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-4 py-6">
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="font-mono tabular-nums">
              Câu {idx + 1} / {questions.length}
            </span>
            <span>
              ✓ <span className="font-mono">{stats.correct}</span> đúng
            </span>
          </div>
          <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${(idx / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="bg-card rounded-xl border p-4">
          <p className="text-sm font-medium leading-relaxed">{current!.prompt}</p>
        </div>

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
                    result && isCorrect && 'border-success/40 bg-success/10 text-success',
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

        {!isMcq && (
          <div className="border-warning/30 bg-warning/5 text-warning rounded-lg border p-3 text-xs">
            Loại câu hỏi {current!.type} chưa support trong Quick Quiz V5.2. Vào quiz fullscreen để
            làm.
          </div>
        )}

        {result && (
          <div className="border-divider bg-muted/30 rounded-lg border p-3">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              {result.correct ? 'Đúng ✓' : 'Sai ✗'}
            </p>
            <p className="mt-1 text-sm leading-relaxed">{result.explanation}</p>
          </div>
        )}

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
            <Button size="sm" onClick={next} disabled={isLast && stats.total < questions.length}>
              {isLast ? 'Xem kết quả' : 'Câu tiếp'}
            </Button>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="bg-muted/20 shrink-0 border-b px-4 py-2 pr-14">
        <div className="flex items-center justify-end">
          <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <ListChecks className="text-primary h-3 w-3" />
            Quick Quiz · 5 câu
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
