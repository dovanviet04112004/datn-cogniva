'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  ClipboardList,
  Copy,
  ExternalLink,
  Loader2,
  Maximize2,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';
import { useExamPreview } from './exam-preview-context';

type ExamData = {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'ENDED';
  durationSeconds: number | null;
  maxScore: number;
  maxAttempts: number;
  liveCode: string | null;
};

type QuestionRow = { id: string };

type AttemptRow = {
  id: string;
  status: string;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  startedAt: string;
  submittedAt: string | null;
};

export function StudioExamInlinePreview() {
  const ctx = useExamPreview();
  const confirm = useConfirm();
  const router = useRouter();
  const [publishing, setPublishing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  const examId = ctx?.examId ?? null;
  const examsVersion = ctx?.examsVersion ?? 0;

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.workspaceExamPreview(examId ?? '', examsVersion),
    queryFn: async () => {
      const [detail, attemptData] = await Promise.all([
        apiGet<{
          exam: ExamData;
          questions: QuestionRow[];
          questionCount: number;
          isOwner: boolean;
        }>(`/api/exams/${examId}`),
        apiGet<{ attempts: AttemptRow[] }>(`/api/exams/${examId}/attempts`).catch(() => ({
          attempts: [] as AttemptRow[],
        })),
      ]);
      return {
        exam: detail.exam,
        questionCount: detail.questionCount ?? detail.questions?.length ?? 0,
        isOwner: detail.isOwner,
        attempts: attemptData.attempts ?? [],
      };
    },
    enabled: !!examId,
  });
  const exam = data?.exam ?? null;
  const questionCount = data?.questionCount ?? 0;
  const isOwner = data?.isOwner ?? false;
  const attempts = data?.attempts ?? [];

  if (!ctx?.examId) return null;

  const isDraft = exam?.status === 'DRAFT';
  const isPublished = exam?.status === 'PUBLISHED';
  const ongoingAttempt = attempts.find((a) => a.status === 'IN_PROGRESS');

  const copyCode = () => {
    if (!exam?.liveCode) return;
    navigator.clipboard.writeText(exam.liveCode);
    toast.success('Đã copy code');
  };

  const copyShareLink = () => {
    if (!exam?.liveCode) return;
    const origin = window.location.origin;
    const url = `${origin}/join?code=${exam.liveCode}`;
    navigator.clipboard.writeText(url);
    toast.success('Đã copy link chia sẻ');
  };

  const publish = async () => {
    if (!exam || publishing) return;
    if (questionCount === 0) {
      toast.error('Thêm câu hỏi trước khi publish');
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(`/api/exams/${exam.id}/publish`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã publish');
      ctx.bumpExamsVersion();
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
      const res = await fetch(`/api/exams/${exam.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã xoá');
      ctx.bumpExamsVersion();
      ctx.close();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const startAttempt = async () => {
    if (!exam || starting) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/exams/${exam.id}/attempts`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as {
        attempt: { id: string };
        resumed: boolean;
      };
      if (out.resumed) toast.info('Tiếp tục attempt đang dở');
      router.push(`/exams/${exam.id}/take/${out.attempt.id}`);
    } catch (err) {
      toast.error('Bắt đầu lỗi: ' + (err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-l">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <ClipboardList className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p
            className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight"
            title={exam?.title ?? ''}
          >
            {exam?.title || (loading ? 'Đang tải…' : 'Exam')}
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={() => ctx.setMode('modal')}
              aria-label="Mở rộng modal"
              title="Mở editor đầy đủ"
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại Studio"
            title="Đóng"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {exam && (
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                'rounded px-1 py-0.5 font-semibold',
                isDraft ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
              )}
            >
              {exam.status}
            </span>
            <span className="bg-muted rounded px-1 py-0.5">{exam.mode}</span>
            <span>{questionCount} câu</span>
            <span>{exam.maxScore} điểm</span>
            {exam.mode === 'TIMED' && exam.durationSeconds && (
              <span>{Math.round(exam.durationSeconds / 60)}p</span>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && !exam ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : !exam ? (
          <p className="text-muted-foreground text-center text-[11px]">Exam không tải được.</p>
        ) : (
          <div className="space-y-3 text-[12px]">
            {exam.description && (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
                  Mô tả
                </h3>
                <p className="text-foreground/90 leading-relaxed">{exam.description}</p>
              </section>
            )}

            {isOwner && isPublished && exam.liveCode && (
              <section className="border-primary/30 bg-primary/5 rounded-md border p-2.5">
                <h3 className="text-primary mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
                  Mã chia sẻ
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 font-mono text-lg font-bold tracking-widest">
                    {exam.liveCode}
                  </span>
                  <button
                    type="button"
                    onClick={copyCode}
                    title="Copy code"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={copyShareLink}
                    title="Copy link chia sẻ"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-muted-foreground mt-1.5 text-[11px]">
                  Học sinh nhập code ở tab &quot;Nhập code&quot; hoặc click link chia sẻ.
                </p>
              </section>
            )}

            {isOwner && isDraft && (
              <section className="bg-muted/30 rounded-md border p-2.5">
                <h3 className="text-primary text-[11px] font-semibold uppercase tracking-wider">
                  Các bước tiếp theo
                </h3>
                <ol className="text-foreground/90 mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Mở editor (⤢) thêm câu hỏi tay hoặc AI gen từ tài liệu</li>
                  <li>Publish khi đủ câu — không edit được sau publish</li>
                  <li>Share code 6 ký tự cho học sinh / làm thử trước</li>
                </ol>
              </section>
            )}

            {isPublished && (
              <button
                type="button"
                onClick={startAttempt}
                disabled={starting}
                className="border-success/30 bg-success/5 text-success hover:bg-success/10 block w-full rounded-md border px-2.5 py-2.5 text-center text-[13px] font-medium transition-colors disabled:opacity-50"
              >
                {starting ? (
                  <Loader2 className="-mt-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                )}
                {ongoingAttempt
                  ? 'Tiếp tục attempt đang dở'
                  : isOwner
                    ? 'Làm thử (preview UX)'
                    : 'Bắt đầu làm bài'}
              </button>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={() => ctx.setMode('modal')}
                className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 block w-full rounded-md border px-2.5 py-2 text-center text-[12px] font-medium transition-colors"
              >
                <Maximize2 className="-mt-0.5 mr-1 inline h-3 w-3" />
                {questionCount === 0
                  ? 'Mở editor để thêm câu hỏi'
                  : `Mở editor (${questionCount} câu)`}
              </button>
            )}

            {attempts.length > 0 && (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
                  Lịch sử ({attempts.length})
                </h3>
                <ul className="space-y-1">
                  {attempts.slice(0, 10).map((a) => (
                    <li key={a.id}>
                      <AttemptRowItem
                        attempt={a}
                        examId={exam.id}
                        onOpen={() => {
                          if (a.status === 'IN_PROGRESS') {
                            router.push(`/exams/${exam.id}/take/${a.id}`);
                          } else {
                            router.push(`/exams/${exam.id}/results/${a.id}`);
                          }
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!isOwner && isDraft && (
              <p className="bg-muted/30 text-muted-foreground rounded-md border px-2.5 py-2 text-[11px]">
                Exam chưa publish. Đợi giáo viên publish rồi quay lại.
              </p>
            )}
          </div>
        )}
      </div>

      {isOwner && (
        <footer className="bg-muted/20 shrink-0 space-y-1.5 border-t px-2 py-2">
          {isDraft && questionCount > 0 && (
            <button
              type="button"
              onClick={publish}
              disabled={publishing}
              className="border-success/30 bg-success/5 text-success hover:bg-success/10 block w-full rounded-md border px-2 py-1.5 text-center text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {publishing ? (
                <Loader2 className="-mt-0.5 mr-1 inline h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="-mt-0.5 mr-1 inline h-3 w-3" />
              )}
              {publishing ? 'Đang publish…' : 'Publish exam'}
            </button>
          )}
          <button
            type="button"
            onClick={deleteExam}
            disabled={deleting}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 block w-full rounded-md border px-2 py-1.5 text-center text-[11px] font-medium transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="-mt-0.5 mr-1 inline h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="-mt-0.5 mr-1 inline h-3 w-3" />
            )}
            {deleting ? 'Đang xoá…' : 'Xoá exam'}
          </button>
        </footer>
      )}
    </aside>
  );
}

function AttemptRowItem({
  attempt,
  onOpen,
}: {
  attempt: AttemptRow;
  examId: string;
  onOpen: () => void;
}) {
  const isOngoing = attempt.status === 'IN_PROGRESS';
  const score = attempt.score ?? 0;
  const max = attempt.maxScore ?? 0;
  const pct = attempt.percentage != null ? Math.round(attempt.percentage * 100) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-divider bg-card hover:border-primary/30 hover:bg-primary/5 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors"
    >
      <span
        className={cn(
          'inline-block rounded px-1 py-0.5 font-semibold',
          isOngoing ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
        )}
      >
        {isOngoing ? 'Đang làm' : attempt.status}
      </span>
      <div className="min-w-0 flex-1">
        {!isOngoing && max > 0 ? (
          <span className="font-mono tabular-nums">
            {score.toFixed(1)}/{max}
            {pct !== null && <span className="text-muted-foreground ml-1">({pct}%)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {new Date(attempt.startedAt).toLocaleString('vi-VN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
      <ExternalLink className="text-muted-foreground h-3 w-3 shrink-0" />
    </button>
  );
}
