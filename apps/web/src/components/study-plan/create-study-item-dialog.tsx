'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  onCreated?: () => void;
  trigger?: React.ReactNode;
};

export function CreateStudyItemDialog({ onCreated, trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Cần tiêu đề');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/study-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('Đã tạo');
      reset();
      setOpen(false);
      onCreated?.();
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1 h-4 w-4" />
            Mục mới
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Thêm mục study plan</DialogTitle>
            <DialogDescription>
              Mục PENDING sẽ hiển thị ở cột &quot;Cần làm&quot; — tick checkbox khi hoàn thành.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-title">
                Tiêu đề <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Vd: Ôn chương Lamport clock"
                autoFocus
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-desc">Mô tả (tuỳ chọn)</Label>
              <textarea
                id="sp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Ghi chú thêm về nội dung cần ôn..."
                className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-due">Deadline (tuỳ chọn)</Label>
              <Input
                id="sp-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                'Tạo'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
