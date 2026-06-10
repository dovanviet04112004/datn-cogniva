/**
 * CreateRoomDialog — modal tạo room mới.
 *
 * Field cơ bản: name, description, visibility, maxMembers.
 * Sau khi tạo xong → router.push('/rooms/{id}/lobby').
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ComboSelect } from '@/components/ui/combo-select';

type Visibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';

export function CreateRoomDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [visibility, setVisibility] = React.useState<Visibility>('UNLISTED');
  const [maxMembers, setMaxMembers] = React.useState(10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
          maxMembers,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] ?? 'Tạo phòng thất bại');
      }
      const { room } = await res.json();
      toast.success('Đã tạo phòng');
      router.push(`/rooms/${room.id}/lobby`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" />
          Tạo phòng
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo phòng học mới</DialogTitle>
          <DialogDescription>
            Phòng học video realtime — chia sẻ link/code cho bạn bè để cùng học.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Tên phòng *</Label>
            <input
              id="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Ôn tập Toán cuối kỳ"
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Mô tả</Label>
            <textarea
              id="desc"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(tuỳ chọn) — nội dung phòng học sẽ thảo luận"
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vis">Chế độ</Label>
              {/* Chế độ hiển thị phòng — enum Visibility, cast string */}
              <ComboSelect
                id="vis"
                value={visibility}
                onChange={(v) => setVisibility(v as Visibility)}
                options={[
                  { value: 'PRIVATE', label: 'Riêng tư — chỉ mời' },
                  { value: 'UNLISTED', label: 'Có link/code' },
                  { value: 'PUBLIC', label: 'Công khai' },
                ]}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max">Tối đa</Label>
              <input
                id="max"
                type="number"
                min={2}
                max={50}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
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
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Tạo phòng
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
