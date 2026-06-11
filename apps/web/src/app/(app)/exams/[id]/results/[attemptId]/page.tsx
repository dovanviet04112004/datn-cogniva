'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, XCircle, ArrowLeft, Trophy, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ExamData {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  maxScore: number;
  passingScore: number | null;
  showResults: string;
}

interface AttemptData {
  id: string;
  status: string;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  timeSpentSeconds: number | null;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
}

interface QuestionData {
  id: string;
  type: string;
  prompt: string;
  options: string[] | null;
  correctAnswer: unknown;
  acceptableAnswers: string[] | null;
  explanation: string | null;
  points: number;
  orderIndex: number;
}

interface ResponseData {
  questionId: string;
  answer: unknown;
  isCorrect: boolean | null;
  pointsEarned: number;
  aiGrading: { feedback?: string; breakdown?: Record<string, number> } | null;
  needsReview: boolean;
}

export default function ResultsPage() {
  const { id: examId, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [data, setData] = React.useState<{
    exam: ExamData;
    attempt: AttemptData;
    questions: QuestionData[];
    responses: ResponseData[];
    reveal: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/attempts/${attemptId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((err) => toast.error('Load fail: ' + err.message))
      .finally(() => setLoading(false));
  }, [attemptId]);

  if (loading) return <div className="text-muted-foreground p-6 text-sm">Đang tải...</div>;
  if (!data)
    return <div className="text-muted-foreground p-6 text-sm">Không tìm thấy kết quả.</div>;

  const { exam, attempt, questions, responses, reveal } = data;
  const respMap = new Map(responses.map((r) => [r.questionId, r]));
  const totalPoints = attempt.score ?? 0;
  const maxPoints = attempt.maxScore ?? exam.maxScore;
  const pct = attempt.percentage ? Math.round(attempt.percentage * 100) : 0;
  const correctCount = responses.filter((r) => r.isCorrect === true).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link
        href={`/exams/${examId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Về workspace
      </Link>

      <Card className="space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{exam.title}</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-muted/50 rounded-md p-4">
            <div className="text-muted-foreground text-xs uppercase">Điểm</div>
            <div className="mt-1 text-2xl font-semibold">
              {totalPoints.toFixed(1)}
              <span className="text-muted-foreground text-base">/{maxPoints}</span>
            </div>
            <div className="text-muted-foreground mt-1 text-xs">{pct}%</div>
          </div>
          <div className="bg-muted/50 rounded-md p-4">
            <div className="text-muted-foreground text-xs uppercase">Đúng/Tổng</div>
            <div className="mt-1 text-2xl font-semibold">
              {correctCount}
              <span className="text-muted-foreground text-base">/{questions.length}</span>
            </div>
          </div>
          <div className="bg-muted/50 rounded-md p-4">
            <div className="text-muted-foreground text-xs uppercase">Thời gian</div>
            <div className="mt-1 text-2xl font-semibold">
              {attempt.timeSpentSeconds
                ? `${Math.floor(attempt.timeSpentSeconds / 60)}p ${attempt.timeSpentSeconds % 60}s`
                : '—'}
            </div>
          </div>
        </div>

        {attempt.passed != null && (
          <div
            className={`flex items-center gap-2 rounded-md p-3 text-sm font-medium ${
              attempt.passed ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            }`}
          >
            {attempt.passed ? (
              <>
                <Trophy className="h-4 w-4" /> Bạn đã đạt yêu cầu (≥
                {Math.round((exam.passingScore ?? 0) * 100)}%)
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" /> Chưa đạt yêu cầu (cần ≥
                {Math.round((exam.passingScore ?? 0) * 100)}%)
              </>
            )}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Chi tiết từng câu</h2>
        {!reveal && (
          <Card className="bg-yellow-50 p-3 text-sm text-yellow-900">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Giáo viên chưa cho phép xem đáp án — chỉ hiện điểm số.
          </Card>
        )}
        {questions.map((q, idx) => {
          const r = respMap.get(q.id);
          return (
            <Card key={q.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-semibold">
                    Câu {idx + 1}
                  </span>
                  <span>{q.points} điểm</span>
                </div>
                <div className="flex items-center gap-2">
                  {r?.isCorrect === true && (
                    <span className="bg-success/10 text-success flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold">
                      <CheckCircle className="h-3 w-3" /> Đúng
                    </span>
                  )}
                  {r?.isCorrect === false && (
                    <span className="bg-destructive/10 text-destructive flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold">
                      <XCircle className="h-3 w-3" /> Sai
                    </span>
                  )}
                  {r?.needsReview && (
                    <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                      Cần review
                    </span>
                  )}
                  <span className="text-sm font-semibold">
                    {(r?.pointsEarned ?? 0).toFixed(1)}/{q.points}
                  </span>
                </div>
              </div>

              <p className="whitespace-pre-wrap text-sm">{q.prompt}</p>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs font-semibold">Bạn trả lời: </span>
                  <span>{formatAnswer(q, r?.answer)}</span>
                </div>
                {reveal && q.correctAnswer !== null && q.correctAnswer !== undefined && (
                  <div>
                    <span className="text-success text-xs font-semibold">Đáp án đúng: </span>
                    <span>{formatAnswer(q, q.correctAnswer, true)}</span>
                  </div>
                )}
              </div>

              {reveal && q.explanation && (
                <div className="bg-muted/50 rounded p-3 text-xs">
                  <strong>Giải thích:</strong> {q.explanation}
                </div>
              )}

              {r?.aiGrading?.feedback && (
                <div className="rounded bg-blue-50 p-3 text-xs text-blue-900">
                  <strong>AI feedback:</strong> {r.aiGrading.feedback}
                  {r.aiGrading.breakdown && (
                    <div className="mt-1">
                      {Object.entries(r.aiGrading.breakdown).map(([k, v]) => (
                        <div key={k}>
                          • {k}: {(v * 100).toFixed(0)}%
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex justify-center pt-4">
        <Link href={`/exams/${examId}`}>
          <Button variant="outline">Về workspace</Button>
        </Link>
      </div>
    </div>
  );
}

function formatAnswer(q: QuestionData, answer: unknown, isCorrectAnswer = false): string {
  if (answer === null || answer === undefined || answer === '') return '(không trả lời)';
  if (q.type === 'MCQ_SINGLE' && typeof answer === 'number' && q.options) {
    return `${String.fromCharCode(65 + answer)}. ${q.options[answer] ?? '?'}`;
  }
  if (q.type === 'MCQ_MULTI' && Array.isArray(answer) && q.options) {
    return (answer as number[])
      .map((i) => `${String.fromCharCode(65 + i)}. ${q.options![i] ?? '?'}`)
      .join(', ');
  }
  if (q.type === 'TRUE_FALSE' && typeof answer === 'boolean') {
    return answer ? 'Đúng' : 'Sai';
  }
  if (typeof answer === 'string') return answer;
  if (Array.isArray(answer)) return (answer as string[]).join(', ');
  return JSON.stringify(answer);
}
