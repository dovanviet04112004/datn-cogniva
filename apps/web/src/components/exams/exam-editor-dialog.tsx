'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AddQuestionDialog } from '@/components/exams/add-question-dialog';
import { AiGenerateDialog } from '@/components/exams/ai-generate-dialog';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';

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

type ExamData = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  mode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'ENDED';
  durationSeconds: number | null;
  maxScore: number;
  maxAttempts: number;
};

type QuestionRow = {
  id: string;
  type: string;
  prompt: string;
  points: number;
  orderIndex: number;
};

type Props = {
  examId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged?: () => void;
};

export function ExamEditorDialog({ examId, open, onOpenChange, onChanged }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [publishing, setPublishing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.exam(examId ?? ''),
    queryFn: () =>
      apiGet<{ exam: ExamData; questions: QuestionRow[]; isOwner: boolean }>(
        `/api/exams/${examId}`,
      ),
    enabled: open && !!examId,
  });
  const exam = data?.exam ?? null;
  const questions = data?.questions ?? [];
  const isOwner = data?.isOwner ?? false;

  const reload = () => qc.invalidateQueries({ queryKey: qk.exam(examId ?? '') });

  const publishExam = async () => {
    if (!exam || publishing) return;
    if (questions.length === 0) {
      toast.error('Thêm ít nhất 1 câu hỏi trước khi publish');
      return;
    }
    setPublishing(true);
    try {
      await apiSend(`/api/exams/${exam.id}/publish`, 'POST');
      toast.success('Đã publish exam');
      void reload();
      onChanged?.();
    } catch (err) {
      toast.error('Publish lỗi: ' + (err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const deleteExam = async () => {
    if (!exam || deleting) return;
    const ok = await confirm({
      title: `Xoá exam "${exam.title}"?`,
      description: 'Không khôi phục được.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await apiSend(`/api/exams/${exam.id}`, 'DELETE');
      toast.success('Đã xoá exam');
      onOpenChange(false);
      onChanged?.();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteQuestion = async (qId: string) => {
    if (!exam) return;
    const ok = await confirm({
      title: 'Xoá câu hỏi này?',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/exams/${exam.id}/questions/${qId}`, 'DELETE');
      void reload();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    }
  };

  const startAttempt = async () => {
    if (!exam) return;
    try {
      const out = await apiSend<{ attempt: { id: string }; resumed: boolean }>(
        `/api/exams/${exam.id}/attempts`,
        'POST',
      );
      if (out.resumed) toast.info('Tiếp tục attempt đang dở');
      router.push(`/exams/${exam.id}/take/${out.attempt.id}`);
      onOpenChange(false);
    } catch (err) {
      toast.error('Bắt đầu lỗi: ' + (err as Error).message);
    }
  };

  const isDraft = exam?.status === 'DRAFT';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[800px] w-[90vw] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {loading && !exam ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : !exam ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-sm">Exam không tải được.</p>
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12 text-left">
              <DialogTitle className="text-base">{exam.title}</DialogTitle>
              <DialogDescription className="sr-only">Quản lý exam + câu hỏi.</DialogDescription>
              {exam.description && (
                <p className="text-muted-foreground mt-0.5 text-xs">{exam.description}</p>
              )}
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-semibold',
                    isDraft ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
                  )}
                >
                  {exam.status}
                </span>
                <span className="bg-muted rounded px-1.5 py-0.5">{exam.mode}</span>
                <span>{questions.length} câu</span>
                <span>{exam.maxScore} điểm tối đa</span>
                {exam.mode === 'TIMED' && exam.durationSeconds && (
                  <span>{Math.round(exam.durationSeconds / 60)} phút</span>
                )}
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Câu hỏi</h2>
                  {isOwner && isDraft && (
                    <div className="flex flex-wrap gap-2">
                      <AddQuestionDialog examId={exam.id} onDone={reload} />
                      <AiGenerateDialog examId={exam.id} onDone={reload} />
                    </div>
                  )}
                </div>

                {questions.length === 0 ? (
                  <p className="text-muted-foreground text-center text-xs">
                    Chưa có câu hỏi. Bấm &quot;Thêm câu hỏi&quot; hoặc &quot;AI gen&quot; để tạo.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {questions.map((q, i) => (
                      <li
                        key={q.id}
                        className="bg-card flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs"
                      >
                        <span className="bg-muted text-muted-foreground mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px]">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 leading-snug">{q.prompt}</p>
                          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
                            <span className="bg-muted rounded px-1 py-0.5">
                              {TYPE_LABEL[q.type] ?? q.type}
                            </span>
                            <span>{q.points} điểm</span>
                          </div>
                        </div>
                        {isOwner && isDraft && (
                          <button
                            type="button"
                            onClick={() => deleteQuestion(q.id)}
                            aria-label="Xoá câu hỏi"
                            title="Xoá câu hỏi"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <footer className="bg-muted/20 shrink-0 border-t px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {isOwner && isDraft && questions.length > 0 && (
                    <Button onClick={publishExam} size="sm" disabled={publishing}>
                      {publishing ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-1 h-3.5 w-3.5" />
                      )}
                      Publish
                    </Button>
                  )}
                  {exam.status === 'PUBLISHED' && (
                    <Button onClick={startAttempt} size="sm" variant="outline">
                      Làm thử
                    </Button>
                  )}
                  {isOwner && exam.status === 'PUBLISHED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        router.push(`/exams/${exam.id}/proctor`);
                        onOpenChange(false);
                      }}
                    >
                      <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                      Proctor
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      onClick={deleteExam}
                      size="sm"
                      variant="outline"
                      disabled={deleting}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deleting ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                      )}
                      Xoá
                    </Button>
                  )}
                </div>
              </div>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
