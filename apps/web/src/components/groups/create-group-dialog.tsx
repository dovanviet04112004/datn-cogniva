'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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

export function CreateGroupDialog({ onCreated, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Cần tên group');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      toast.success('Tạo group thành công');
      setName('');
      setDescription('');
      setOpen(false);
      if (data.group?.id) {
        router.push(`/groups/${data.group.id}`);
      } else {
        onCreated?.();
      }
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
            Tạo group
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Tạo study group mới</DialogTitle>
            <DialogDescription>
              Group có channels chat, voice, forum. Bạn sẽ là OWNER có toàn quyền invite + kick +
              xoá.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">
                Tên group <span className="text-destructive">*</span>
              </Label>
              <Input
                id="g-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vd: Lớp KTPM-K15"
                autoFocus
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-desc">Mô tả (tuỳ chọn)</Label>
              <Input
                id="g-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Vd: Group chat lớp Kỹ thuật phần mềm khóa 15"
                maxLength={500}
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
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                'Tạo group'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
