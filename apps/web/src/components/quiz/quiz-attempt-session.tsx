/**
 * QuizAttemptSession — player làm bài quiz tuần tự câu này → câu kia.
 *
 * Flow:
 *   1. Hiển thị 1 câu mỗi lần (better focus + ít rendering).
 *   2. User input: radio (MCQ), 2 button (T/F), textarea (SHORT).
 *   3. Bấm "Câu tiếp" → lưu answer local state, tăng index.
 *   4. Câu cuối → bấm "Nộp bài" → POST /attempt → switch sang ResultsView.
 *
 * KHÔNG submit từng câu (anti-cheat đơn giản: user xem hết bài rồi nộp).
 *
 * ResultsView: render tất cả câu kèm correctAnswer + explanation + feedback +
 * mastery delta.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
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
};

type Props = {
  quiz: Quiz;
  questions: Question[];
};

export function QuizAttemptSession({ quiz, questions }: Props) {
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, number | boolean | string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [response, setResponse] = React.useState<AttemptResponse | null>(null);

  // Đã có response → render ResultsView
  if (response) {
    return <ResultsView quiz={quiz} questions={questions} response={response} />;
  }

  if (questions.length === 0) {
    return (
      <Card className="mx-auto mt-12 max-w-2xl space-y-4 p-6 text-center">
        <p>Quiz này không có câu hỏi.</p>
        <Link href="/quiz">
          <Button variant="outline">← Về danh sách</Button>
        </Link>
      </Card>
    );
  }

  const q = questions[index];
  if (!q) return null;
  const setAnswer = (val: number | boolean | string) =>
    setAnswers((a) => ({ ...a, [q.id]: val }));
  const current = answers[q.id];

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        answers: questions.map((qq) => ({
          questionId: qq.id,
          userAnswer:
            answers[qq.id] ??
            (qq.type === 'SHORT' ? '' : qq.type === 'MCQ' ? -1 : false),
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
    } catch (err) {
      toast.error('Nộp bài thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/quiz">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Thoát
          </Button>
        </Link>
        <p className="text-sm text-muted-foreground">
          Câu {index + 1} / {questions.length}
        </p>
      </div>

      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-2">
          <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
            {q.type}
          </span>
          <span className="text-xs text-muted-foreground">
            Độ khó {(q.difficulty * 100).toFixed(0)}%
          </span>
        </div>

        <p className="whitespace-pre-wrap text-base font-medium">{q.prompt}</p>

        {q.type === 'MCQ' && q.options && (
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <label
                key={i}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:bg-muted/50 ${
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
            className="w-full rounded-md border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
  const qById = new Map(questions.map((q) => [q.id, q]));
  const { summary, results } = response;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/quiz">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Về danh sách
          </Button>
        </Link>
      </div>

      <Card className="space-y-2 p-6">
        <h2 className="text-xl font-semibold">{quiz.title}</h2>
        <p className="text-sm text-muted-foreground">
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
                <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                  Câu {i + 1} · {r.type}
                </span>
                {passed ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {(r.score * 100).toFixed(0)}%
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" />
                    {(r.score * 100).toFixed(0)}%
                  </span>
                )}
                {r.masteryAfter != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Mastery: {(r.masteryAfter * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              <p className="text-sm font-medium whitespace-pre-wrap">{q.prompt}</p>

              {q.type === 'MCQ' && q.options && (
                <p className="text-xs text-muted-foreground">
                  Đáp án đúng:{' '}
                  <strong>{q.options[r.correctAnswer as number] ?? '?'}</strong>
                </p>
              )}
              {q.type === 'TRUE_FALSE' && (
                <p className="text-xs text-muted-foreground">
                  Đáp án đúng: <strong>{r.correctAnswer ? 'Đúng' : 'Sai'}</strong>
                </p>
              )}
              {q.type === 'SHORT' && (
                <p className="text-xs text-muted-foreground">
                  Đáp án mẫu: <em>{String(r.correctAnswer)}</em>
                </p>
              )}

              {r.feedback && (
                <p className="rounded bg-muted/50 p-2 text-xs">{r.feedback}</p>
              )}
              {r.explanation && (
                <p className="text-xs text-muted-foreground">
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
