/**
 * /exams/new — form tạo exam mới (DRAFT). Sau submit → redirect /exams/[id]
 * để thêm câu hỏi.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NewExamPage() {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mode, setMode] = React.useState<'PRACTICE' | 'TIMED'>('PRACTICE');
  const [duration, setDuration] = React.useState('30'); // phút
  const [maxAttempts, setMaxAttempts] = React.useState('1');
  const [shuffleQuestions, setShuffleQuestions] = React.useState(true);
  const [shuffleOptions, setShuffleOptions] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Nhập tiêu đề');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          mode,
          durationSeconds: mode === 'TIMED' ? Number(duration) * 60 : undefined,
          maxAttempts: Number(maxAttempts),
          shuffleQuestions,
          shuffleOptions,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { exam: { id: string } };
      toast.success('Tạo exam thành công');
      router.push(`/exams/${data.exam.id}`);
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Tạo exam mới</h1>
        <p className="text-sm text-muted-foreground">
          Sau khi tạo xong, bạn sẽ thêm câu hỏi (manual hoặc AI gen) rồi publish.
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Tiêu đề *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Vd: Kiểm tra giữa kỳ Toán 11"
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Mô tả (tuỳ chọn)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn về phạm vi, yêu cầu, …"
              maxLength={2000}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <Label>Chế độ</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('PRACTICE')}
                className={`rounded border p-3 text-left text-sm ${
                  mode === 'PRACTICE'
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent'
                }`}
              >
                <div className="font-medium">Luyện tập</div>
                <div className="text-xs text-muted-foreground">
                  Không giới hạn thời gian, hiện đáp án sau mỗi câu
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('TIMED')}
                className={`rounded border p-3 text-left text-sm ${
                  mode === 'TIMED'
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent'
                }`}
              >
                <div className="font-medium">Có thời gian</div>
                <div className="text-xs text-muted-foreground">
                  Đếm ngược, auto-submit khi hết
                </div>
              </button>
            </div>
          </div>

          {mode === 'TIMED' && (
            <div className="space-y-2">
              <Label htmlFor="duration">Thời gian (phút)</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                max="180"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="maxAttempts">Số lần làm tối đa</Label>
            <Input
              id="maxAttempts"
              type="number"
              min="1"
              max="10"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
            />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
                className="mt-1"
              />
              <div className="text-sm">
                <div className="font-medium">Xáo trộn thứ tự câu hỏi</div>
                <div className="text-xs text-muted-foreground">
                  Mỗi học sinh thấy thứ tự khác nhau (chống nhìn bài)
                </div>
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
                <div className="font-medium">Xáo trộn thứ tự đáp án MCQ</div>
                <div className="text-xs text-muted-foreground">
                  Đáp án A/B/C/D random vị trí
                </div>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Đang tạo...' : 'Tạo exam'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
