/**
 * StudioExamInlinePreview — V8.24 (2026-05-20).
 *
 * Render trong Studio panel (right sidebar) khi `useExamPreview().examId` set
 * + mode='inline'. Replace Studio recipes UI với compact exam preview.
 *
 * Khác V8.22:
 *   - Detect owner vs student qua API (`isOwner` từ /api/exams/[id])
 *   - Owner PUBLISHED: hiện share code prominent + Copy
 *   - Student/Owner PUBLISHED: nút "Bắt đầu làm" tạo attempt + navigate /take
 *   - List past attempts của user (resume / view results)
 *   - Empty student-DRAFT case: chỉ báo "chưa publish" (API đã chặn)
 *
 * Lý do TAKE vẫn navigate full-page: anti-cheat fullscreen + proctor camera
 * cần lock browser, không embed trong sidebar được. RESULTS cũng navigate
 * (full breakdown breakdown nhiều câu, nội dung dài) — sau khi xong user
 * có thể quay lại workspace qua breadcrumb.
 */
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

  // Fetch exam detail + attempts; key kèm examsVersion → publish/xoá bump là refetch.
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
        // Attempts user hiện tại — 404/403 (chưa publish) → rỗng, KHÔNG throw.
        apiGet<{ attempts: AttemptRow[] }>(`/api/exams/${examId}/attempts`).catch(
          () => ({ attempts: [] as AttemptRow[] }),
        ),
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

  /**
   * Bắt đầu làm bài — POST /api/exams/[id]/attempts để tạo/resume attempt
   * rồi navigate sang /take/[attemptId]. TAKE phải full-page (fullscreen
   * lock + proctor camera) — không embed sidebar được.
   */
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
    <aside className="flex h-full flex-col overflow-hidden border-l bg-card">
      {/* Header */}
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p
            className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight"
            title={exam?.title ?? ''}
          >
            {exam?.title || (loading ? 'Đang tải…' : 'Exam')}
          </p>
          {/* Owner-only: zoom mở editor đầy đủ */}
          {isOwner && (
            <button
              type="button"
              onClick={() => ctx.setMode('modal')}
              aria-label="Mở rộng modal"
              title="Mở editor đầy đủ"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => ctx.close()}
            aria-label="Đóng — quay lại Studio"
            title="Đóng"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {exam && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'rounded px-1 py-0.5 font-semibold',
                isDraft
                  ? 'bg-warning/10 text-warning'
                  : 'bg-success/10 text-success',
              )}
            >
              {exam.status}
            </span>
            <span className="rounded bg-muted px-1 py-0.5">{exam.mode}</span>
            <span>{questionCount} câu</span>
            <span>{exam.maxScore} điểm</span>
            {exam.mode === 'TIMED' && exam.durationSeconds && (
              <span>{Math.round(exam.durationSeconds / 60)}p</span>
            )}
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && !exam ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !exam ? (
          <p className="text-center text-[11px] text-muted-foreground">
            Exam không tải được.
          </p>
        ) : (
          <div className="space-y-3 text-[12px]">
            {exam.description && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Mô tả
                </h3>
                <p className="leading-relaxed text-foreground/90">
                  {exam.description}
                </p>
              </section>
            )}

            {/* Share code panel — owner PUBLISHED có liveCode */}
            {isOwner && isPublished && exam.liveCode && (
              <section className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
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
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={copyShareLink}
                    title="Copy link chia sẻ"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Học sinh nhập code ở tab &quot;Nhập code&quot; hoặc click link chia sẻ.
                </p>
              </section>
            )}

            {/* DRAFT hint — owner cần điều gì */}
            {isOwner && isDraft && (
              <section className="rounded-md border bg-muted/30 p-2.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Các bước tiếp theo
                </h3>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-foreground/90">
                  <li>
                    Mở editor (⤢) thêm câu hỏi tay hoặc AI gen từ tài liệu
                  </li>
                  <li>Publish khi đủ câu — không edit được sau publish</li>
                  <li>Share code 6 ký tự cho học sinh / làm thử trước</li>
                </ol>
              </section>
            )}

            {/* Bắt đầu / Tiếp tục — student PUBLISHED hoặc owner PUBLISHED "làm thử" */}
            {isPublished && (
              <button
                type="button"
                onClick={startAttempt}
                disabled={starting}
                className="block w-full rounded-md border border-success/30 bg-success/5 px-2.5 py-2.5 text-center text-[13px] font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-50"
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

            {/* CTA Mở editor — owner only */}
            {isOwner && (
              <button
                type="button"
                onClick={() => ctx.setMode('modal')}
                className="block w-full rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-center text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Maximize2 className="-mt-0.5 mr-1 inline h-3 w-3" />
                {questionCount === 0
                  ? 'Mở editor để thêm câu hỏi'
                  : `Mở editor (${questionCount} câu)`}
              </button>
            )}

            {/* Past attempts list — user (cả owner và student) làm rồi */}
            {attempts.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                            router.push(
                              `/exams/${exam.id}/results/${a.id}`,
                            );
                          }
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* DRAFT cho non-owner: API đã 403 nhưng phòng race — báo waiting */}
            {!isOwner && isDraft && (
              <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
                Exam chưa publish. Đợi giáo viên publish rồi quay lại.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer — owner-only quick actions (publish + xoá) */}
      {isOwner && (
        <footer className="shrink-0 space-y-1.5 border-t bg-muted/20 px-2 py-2">
          {isDraft && questionCount > 0 && (
            <button
              type="button"
              onClick={publish}
              disabled={publishing}
              className="block w-full rounded-md border border-success/30 bg-success/5 px-2 py-1.5 text-center text-[11px] font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-50"
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
            className="block w-full rounded-md border border-destructive/30 px-2 py-1.5 text-center text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
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

/** 1 row trong lịch sử attempts. */
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
      className="flex w-full items-center gap-2 rounded-md border border-divider bg-card px-2 py-1.5 text-left text-[11px] transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <span
        className={cn(
          'inline-block rounded px-1 py-0.5 font-semibold',
          isOngoing
            ? 'bg-warning/10 text-warning'
            : 'bg-success/10 text-success',
        )}
      >
        {isOngoing ? 'Đang làm' : attempt.status}
      </span>
      <div className="min-w-0 flex-1">
        {!isOngoing && max > 0 ? (
          <span className="font-mono tabular-nums">
            {score.toFixed(1)}/{max}
            {pct !== null && (
              <span className="ml-1 text-muted-foreground">({pct}%)</span>
            )}
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
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
  );
}
