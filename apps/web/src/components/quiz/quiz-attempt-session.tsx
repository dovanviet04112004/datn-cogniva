'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Question = {
  id: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
  prompt: string;
  options: string[] | null;
  difficulty: number;
};

type Quiz = {
  id: string;
  title: string;
};

type AttemptResult = {
  questionId: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
  score: number;
  feedback: string;
  correctAnswer: unknown;
  explanation: string;
  masteryAfter: number | null;
};

type AttemptResponse = {
  results: AttemptResult[];
  summary: { totalScore: number; maxScore: number; percentage: number };
  verifyResult?: { passed: boolean; subjectId: string } | null;
};

type Props = {
  quiz: Quiz;
  questions: Question[];
};

export function QuizAttemptSession({ quiz, questions }: Props) {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, number | boolean | string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [response, setResponse] = React.useState<AttemptResponse | null>(null);

  if (response) {
    return <ResultsView quiz={quiz} questions={questions} response={response} />;
  }

  if (questions.length === 0) {
    return (
      <Card className="mx-auto mt-12 max-w-2xl space-y-4 p-6 text-center">
        <p>Quiz này không có câu hỏi.</p>
        <Button variant="outline" onClick={() => router.back()}>
          ← Quay lại
        </Button>
      </Card>
    );
  }

  const q = questions[index];
  if (!q) return null;
  const setAnswer = (val: number | boolean | string) => setAnswers((a) => ({ ...a, [q.id]: val }));
  const current = answers[q.id];

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        answers: questions.map((qq) => ({
          questionId: qq.id,
          userAnswer: answers[qq.id] ?? (qq.type === 'SHORT' ? '' : qq.type === 'MCQ' ? -1 : false),
        })),
      };
      const res = await fetch(`/api/quiz/${quiz.id}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as AttemptResponse;
      setResponse(data);

      if (data.verifyResult) {
        if (data.verifyResult.passed) {
          toast.success(`Đã verify môn dạy này! Score ${data.summary.percentage}%`);
        } else {
          toast.error(
            `Chưa đạt ngưỡng verify (${data.summary.percentage}%) — generate quiz mới để thử lại.`,
          );
        }
      }
    } catch (err) {
      toast.error('Nộp bài thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Thoát
        </Button>
        <p className="text-muted-foreground text-sm">
          Câu {index + 1} / {questions.length}
        </p>
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-2">
          <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs uppercase tracking-wider">
            {q.type}
          </span>
          <span className="text-muted-foreground text-xs">
            Độ khó {(q.difficulty * 100).toFixed(0)}%
          </span>
        </div>

        <p className="whitespace-pre-wrap text-base font-medium">{q.prompt}</p>

        {q.type === 'MCQ' && q.options && (
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <label
                key={i}
                className={`hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  current === i ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={current === i}
                  onChange={() => setAnswer(i)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )}

        {q.type === 'TRUE_FALSE' && (
          <div className="flex gap-2">
            <Button
              variant={current === true ? 'default' : 'outline'}
              onClick={() => setAnswer(true)}
              className="flex-1"
            >
              Đúng
            </Button>
            <Button
              variant={current === false ? 'default' : 'outline'}
              onClick={() => setAnswer(false)}
              className="flex-1"
            >
              Sai
            </Button>
          </div>
        )}

        {q.type === 'SHORT' && (
          <textarea
            value={typeof current === 'string' ? current : ''}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Nhập câu trả lời của bạn..."
            rows={5}
            className="bg-background focus:ring-primary w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-2"
          />
        )}
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Câu trước
        </Button>
        {index < questions.length - 1 ? (
          <Button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
            Câu tiếp
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            Nộp bài
          </Button>
        )}
      </div>
    </div>
  );
}

function ResultsView({
  quiz,
  questions,
  response,
}: {
  quiz: Quiz;
  questions: Question[];
  response: AttemptResponse;
}) {
  const router = useRouter();
  const qById = new Map(questions.map((q) => [q.id, q]));
  const { summary, results } = response;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Quay lại
        </Button>
      </div>

      <Card className="space-y-2 p-6">
        <h2 className="text-xl font-semibold">{quiz.title}</h2>
        <p className="text-muted-foreground text-sm">
          Kết quả: <strong>{summary.totalScore.toFixed(2)}</strong> /{' '}
          <strong>{summary.maxScore}</strong> ({summary.percentage}%)
        </p>
      </Card>

      <div className="space-y-3">
        {results.map((r, i) => {
          const q = qById.get(r.questionId);
          if (!q) return null;
          const passed = r.score >= 0.5;
          return (
            <Card key={r.questionId} className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs uppercase tracking-wider">
                  Câu {i + 1} · {r.type}
                </span>
                {passed ? (
                  <span className="text-success flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    {(r.score * 100).toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-destructive flex items-center gap-1">
                    <XCircle className="h-4 w-4" />
                    {(r.score * 100).toFixed(0)}%
                  </span>
                )}
                {r.masteryAfter != null && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    Mastery: {(r.masteryAfter * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              <p className="whitespace-pre-wrap text-sm font-medium">{q.prompt}</p>

              {q.type === 'MCQ' && q.options && (
                <p className="text-muted-foreground text-xs">
                  Đáp án đúng: <strong>{q.options[r.correctAnswer as number] ?? '?'}</strong>
                </p>
              )}
              {q.type === 'TRUE_FALSE' && (
                <p className="text-muted-foreground text-xs">
                  Đáp án đúng: <strong>{r.correctAnswer ? 'Đúng' : 'Sai'}</strong>
                </p>
              )}
              {q.type === 'SHORT' && (
                <p className="text-muted-foreground text-xs">
                  Đáp án mẫu: <em>{String(r.correctAnswer)}</em>
                </p>
              )}

              {r.feedback && <p className="bg-muted/50 rounded p-2 text-xs">{r.feedback}</p>}
              {r.explanation && (
                <p className="text-muted-foreground text-xs">
                  <strong>Giải thích:</strong> {r.explanation}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
