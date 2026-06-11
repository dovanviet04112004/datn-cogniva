'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  groupId: string;
  type: 'TEXT' | 'VOICE' | 'ANNOUNCEMENT' | 'STAGE' | 'FORUM';
  children: React.ReactNode;
};

export function CreateChannelButton({ groupId, type, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Cần tên channel');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().toLowerCase().replace(/\s+/g, '-'),
          type,
          topic: topic.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      toast.success('Đã tạo channel');
      setName('');
      setTopic('');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="cursor-pointer" aria-label="Tạo channel">
          {children}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo channel {type}</DialogTitle>
          <DialogDescription>
            {type === 'TEXT' && 'Channel chat — mọi member có thể gửi tin nhắn.'}
            {type === 'VOICE' && 'Channel voice — audio/video qua LiveKit.'}
            {type === 'ANNOUNCEMENT' && 'Chỉ ADMIN+ post được. Member chỉ đọc.'}
            {type === 'STAGE' &&
              'Stage channel — audience nghe, speaker nói. Mod promote audience.'}
            {type === 'FORUM' && 'Forum channel — mỗi post = thread. Q&A, thảo luận chuyên đề.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ch-name">Tên</Label>
            <Input
              id="ch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'TEXT' ? 'toán-cao-cấp' : 'phòng-học'}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-topic">Mô tả (optional)</Label>
            <Input
              id="ch-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Hỏi đáp môn..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'Đang tạo...' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
