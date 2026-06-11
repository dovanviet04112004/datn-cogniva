'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId?: string;
  onCreated?: (newExamId: string) => void;
};

export function CreateExamDialog({ open, onOpenChange, workspaceId, onCreated }: Props) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mode, setMode] = React.useState<'PRACTICE' | 'TIMED'>('PRACTICE');
  const [duration, setDuration] = React.useState('30');
  const [maxAttempts, setMaxAttempts] = React.useState('1');
  const [shuffleQuestions, setShuffleQuestions] = React.useState(true);
  const [shuffleOptions, setShuffleOptions] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [createdExamId, setCreatedExamId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setMode('PRACTICE');
      setDuration('30');
      setMaxAttempts('1');
      setShuffleQuestions(true);
      setShuffleOptions(true);
      setSubmitting(false);
      setCreatedExamId(null);
    }
  }, [open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Nhập tiêu đề');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiSend<{ exam: { id: string } }>('/api/exams', 'POST', {
        title: title.trim(),
        description: description.trim() || undefined,
        mode,
        durationSeconds: mode === 'TIMED' ? Number(duration) * 60 : undefined,
        maxAttempts: Number(maxAttempts),
        shuffleQuestions,
        shuffleOptions,
        workspaceId,
      });
      toast.success('Tạo exam thành công');
      setCreatedExamId(data.exam.id);
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {createdExamId ? (
          <>
            <DialogHeader>
              <DialogTitle>Đã tạo exam</DialogTitle>
              <DialogDescription>
                Exam ở trạng thái DRAFT. Bước tiếp theo: thêm câu hỏi (manual hoặc AI gen) rồi
                publish.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Để sau
              </Button>
              {onCreated ? (
                <Button onClick={() => onCreated(createdExamId)}>Thêm câu hỏi →</Button>
              ) : (
                <Button
                  onClick={() => {
                    window.location.href = `/exams/${createdExamId}`;
                  }}
                >
                  Thêm câu hỏi →
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tạo exam mới</DialogTitle>
              <DialogDescription>
                Tạo xong sẽ thêm câu hỏi (manual hoặc AI gen) rồi publish.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="exam-title">Tiêu đề *</Label>
                <Input
                  id="exam-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Vd: Kiểm tra giữa kỳ — Hệ phân tán"
                  required
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="exam-description">Mô tả (tuỳ chọn)</Label>
                <textarea
                  id="exam-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn về phạm vi, yêu cầu…"
                  maxLength={2000}
                  rows={2}
                  className="border-input focus-visible:ring-ring flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                />
              </div>

              <div className="space-y-2">
                <Label>Chế độ</Label>
                <div className="grid grid-cols-2 gap-2">
                  <ModeButton
                    active={mode === 'PRACTICE'}
                    onClick={() => setMode('PRACTICE')}
                    title="Luyện tập"
                    desc="Không giới hạn, hiện đáp án sau mỗi câu"
                  />
                  <ModeButton
                    active={mode === 'TIMED'}
                    onClick={() => setMode('TIMED')}
                    title="Có thời gian"
                    desc="Đếm ngược + auto-submit"
                  />
                </div>
              </div>

              {mode === 'TIMED' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="exam-duration">Thời gian (phút)</Label>
                    <Input
                      id="exam-duration"
                      type="number"
                      min="1"
                      max="180"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exam-attempts">Số lần làm tối đa</Label>
                    <Input
                      id="exam-attempts"
                      type="number"
                      min="1"
                      max="10"
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-md border p-3">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={shuffleQuestions}
                    onChange={(e) => setShuffleQuestions(e.target.checked)}
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Xáo trộn câu hỏi</div>
                    <div className="text-muted-foreground text-xs">Thứ tự random từng học sinh</div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Xáo trộn đáp án MCQ</div>
                    <div className="text-muted-foreground text-xs">A/B/C/D random vị trí</div>
                  </div>
                </label>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Huỷ
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Đang tạo…' : 'Tạo exam'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded border p-3 text-left text-sm transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent',
      )}
    >
      <div className="font-medium">{title}</div>
      <div className="text-muted-foreground text-xs">{desc}</div>
    </button>
  );
}
