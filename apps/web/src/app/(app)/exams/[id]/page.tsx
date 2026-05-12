/**
 * /exams/[id] — builder cho owner DRAFT, start page cho student PUBLISHED.
 *
 * Logic phân nhánh theo (isOwner, status):
 *   - owner + DRAFT: builder UI (add question manual + AI gen + publish)
 *   - owner + PUBLISHED/ENDED: view exam + nút "Làm thử"
 *   - student + PUBLISHED: nút "Bắt đầu làm bài" (start attempt)
 *   - student + DRAFT: 403 (API đã chặn)
 *   - student + ENDED: chỉ xem lại result attempt trước
 */
'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus, Sparkles, Play, CheckCircle, ArrowLeft, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { AddQuestionDialog } from '@/components/exams/add-question-dialog';
import { AiGenerateDialog } from '@/components/exams/ai-generate-dialog';

interface ExamData {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  mode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'ENDED';
  durationSeconds: number | null;
  maxScore: number;
  passingScore: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResults: string;
  liveCode: string | null;
}

interface QuestionRow {
  id: string;
  type: string;
  prompt: string;
  options: unknown;
  correctAnswer: unknown;
  acceptableAnswers: string[] | null;
  rubric: unknown;
  points: number;
  partialCredit: boolean;
  explanation: string | null;
  orderIndex: number;
}

const TYPE_LABEL: Record<string, string> = {
  MCQ_SINGLE: 'Trắc nghiệm 1 đáp án',
  MCQ_MULTI: 'Trắc nghiệm nhiều đáp án',
  TRUE_FALSE: 'Đúng/Sai',
  SHORT: 'Trả lời ngắn',
  ESSAY: 'Tự luận',
  FILL_BLANK: 'Điền chỗ trống',
  MATCHING: 'Nối',
  ORDERING: 'Sắp xếp',
  CODE: 'Code',
  MATH: 'Công thức',
  DRAWING: 'Vẽ',
};

export default function ExamDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = React.useState<{
    exam: ExamData;
    questions: QuestionRow[];
    isOwner: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    fetch(`/api/exams/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((err) => toast.error('Load exam fail: ' + err.message))
      .finally(() => setLoading(false));
  }, [id, refresh]);

  const publishExam = async () => {
    if (!data?.exam) return;
    if (data.questions.length === 0) {
      toast.error('Thêm ít nhất 1 câu hỏi trước khi publish');
      return;
    }
    try {
      const res = await fetch(`/api/exams/${id}/publish`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã publish exam');
      setRefresh((r) => r + 1);
    } catch (err) {
      toast.error('Publish fail: ' + (err as Error).message);
    }
  };

  const deleteQuestion = async (qId: string) => {
    if (!confirm('Xoá câu hỏi này?')) return;
    try {
      const res = await fetch(`/api/exams/${id}/questions/${qId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRefresh((r) => r + 1);
    } catch (err) {
      toast.error('Xoá fail: ' + (err as Error).message);
    }
  };

  const startAttempt = async () => {
    try {
      const res = await fetch(`/api/exams/${id}/attempts`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as { attempt: { id: string }; resumed: boolean };
      if (out.resumed) toast.info('Tiếp tục attempt đang dở');
      router.push(`/exams/${id}/take/${out.attempt.id}`);
    } catch (err) {
      toast.error('Bắt đầu fail: ' + (err as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-muted-foreground">Exam không tìm thấy.</p>
      </div>
    );
  }

  const { exam, questions, isOwner } = data;
  const isDraft = exam.status === 'DRAFT';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div>
        <Link href="/exams" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Tất cả exams
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{exam.title}</h1>
            {exam.description && (
              <p className="mt-1 text-sm text-muted-foreground">{exam.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5">{exam.mode}</span>
              <span className="rounded bg-muted px-2 py-0.5">{exam.status}</span>
              <span>{questions.length} câu</span>
              <span>{exam.maxScore} điểm tối đa</span>
              {exam.durationSeconds && (
                <span>{Math.round(exam.durationSeconds / 60)} phút</span>
              )}
              <span>Max {exam.maxAttempts} lần</span>
            </div>
          </div>
          <div className="flex gap-2">
            {isOwner && isDraft && questions.length > 0 && (
              <Button onClick={publishExam}>
                <CheckCircle className="mr-1 h-4 w-4" /> Publish
              </Button>
            )}
            {(!isOwner || !isDraft) && exam.status === 'PUBLISHED' && (
              <Button onClick={startAttempt}>
                <Play className="mr-1 h-4 w-4" /> Bắt đầu
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Owner builder controls */}
      {isOwner && isDraft && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Câu hỏi</h2>
            <div className="flex gap-2">
              <AddQuestionDialog examId={exam.id} onDone={() => setRefresh((r) => r + 1)} />
              <AiGenerateDialog examId={exam.id} onDone={() => setRefresh((r) => r + 1)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Thêm câu hỏi tay hoặc dùng AI sinh từ tài liệu. Publish khi xong — sau
            publish KHÔNG edit được nữa (tránh exam đã làm bị thay đổi).
          </p>
        </Card>
      )}

      {/* Question list */}
      <div className="space-y-3">
        {questions.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            {isOwner ? 'Chưa có câu hỏi. Thêm câu đầu tiên.' : 'Exam chưa có câu hỏi.'}
          </Card>
        )}
        {questions.map((q, idx) => (
          <Card key={q.id} className="p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                  Câu {idx + 1}
                </span>
                <span>{TYPE_LABEL[q.type] ?? q.type}</span>
                <span>· {q.points} điểm</span>
              </div>
              {isOwner && isDraft && (
                <div className="flex gap-1">
                  <button
                    onClick={() => deleteQuestion(q.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm">{q.prompt}</p>

            {/* Show options for MCQ if owner — preview */}
            {isOwner && Array.isArray(q.options) && (
              <ul className="mt-3 space-y-1 text-sm">
                {(q.options as string[]).map((opt, i) => {
                  const isCorrect = isCorrectOption(q, i);
                  return (
                    <li
                      key={i}
                      className={`flex gap-2 rounded px-2 py-1 ${
                        isCorrect ? 'bg-green-50 text-green-900' : ''
                      }`}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      <span>{opt}</span>
                      {isCorrect && <CheckCircle className="ml-auto h-3.5 w-3.5 text-green-600" />}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Show True/False answer */}
            {isOwner && q.type === 'TRUE_FALSE' && (
              <p className="mt-2 text-xs text-muted-foreground">
                Đáp án: <span className="font-semibold">{q.correctAnswer ? 'Đúng' : 'Sai'}</span>
              </p>
            )}

            {isOwner && q.explanation && (
              <p className="mt-2 rounded bg-muted/50 p-2 text-xs">
                <strong>Giải thích:</strong> {q.explanation}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function isCorrectOption(q: QuestionRow, idx: number): boolean {
  if (q.type === 'MCQ_SINGLE') {
    return typeof q.correctAnswer === 'number' && q.correctAnswer === idx;
  }
  if (q.type === 'MCQ_MULTI' && Array.isArray(q.correctAnswer)) {
    return (q.correctAnswer as number[]).includes(idx);
  }
  return false;
}
