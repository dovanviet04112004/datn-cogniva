/**
 * /exams/[id]/results/[attemptId] — kết quả sau khi nộp bài.
 *
 * Hiển thị:
 *   - Điểm tổng (X/maxScore) + % + pass/fail
 *   - Thời gian làm bài
 *   - Breakdown từng câu: đúng/sai + điểm + (đáp án đúng + giải thích nếu reveal)
 *
 * Reveal logic (từ API):
 *   - exam.showResults = IMMEDIATE/AFTER_SUBMIT → reveal correctAnswer + explanation
 *   - exam.showResults = AFTER_ALL_DONE → KHÔNG reveal cho student (chỉ owner)
 */
'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, XCircle, ArrowLeft, Clock, Trophy, AlertTriangle } from 'lucide-react';
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

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Đang tải...</div>;
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Không tìm thấy kết quả.</div>;

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
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Về exam
      </Link>

      {/* Summary */}
      <Card className="space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{exam.title}</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-muted/50 p-4">
            <div className="text-xs uppercase text-muted-foreground">Điểm</div>
            <div className="mt-1 text-2xl font-semibold">
              {totalPoints.toFixed(1)}<span className="text-base text-muted-foreground">/{maxPoints}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{pct}%</div>
          </div>
          <div className="rounded-md bg-muted/50 p-4">
            <div className="text-xs uppercase text-muted-foreground">Đúng/Tổng</div>
            <div className="mt-1 text-2xl font-semibold">
              {correctCount}<span className="text-base text-muted-foreground">/{questions.length}</span>
            </div>
          </div>
          <div className="rounded-md bg-muted/50 p-4">
            <div className="text-xs uppercase text-muted-foreground">Thời gian</div>
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
              attempt.passed ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'
            }`}
          >
            {attempt.passed ? (
              <>
                <Trophy className="h-4 w-4" /> Bạn đã đạt yêu cầu (≥{Math.round((exam.passingScore ?? 0) * 100)}%)
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" /> Chưa đạt yêu cầu (cần ≥{Math.round((exam.passingScore ?? 0) * 100)}%)
              </>
            )}
          </div>
        )}
      </Card>

      {/* Per-question breakdown */}
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                    Câu {idx + 1}
                  </span>
                  <span>{q.points} điểm</span>
                </div>
                <div className="flex items-center gap-2">
                  {r?.isCorrect === true && (
                    <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                      <CheckCircle className="h-3 w-3" /> Đúng
                    </span>
                  )}
                  {r?.isCorrect === false && (
                    <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
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

              {/* User answer + correct answer */}
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground">Bạn trả lời: </span>
                  <span>{formatAnswer(q, r?.answer)}</span>
                </div>
                {reveal && q.correctAnswer !== null && q.correctAnswer !== undefined && (
                  <div>
                    <span className="text-xs font-semibold text-green-700">Đáp án đúng: </span>
                    <span>{formatAnswer(q, q.correctAnswer, true)}</span>
                  </div>
                )}
              </div>

              {/* Explanation */}
              {reveal && q.explanation && (
                <div className="rounded bg-muted/50 p-3 text-xs">
                  <strong>Giải thích:</strong> {q.explanation}
                </div>
              )}

              {/* AI feedback */}
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
          <Button variant="outline">Về exam</Button>
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
