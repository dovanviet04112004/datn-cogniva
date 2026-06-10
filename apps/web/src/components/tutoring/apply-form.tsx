/**
 * ApplyForm — tutor submit apply vào student request.
 *
 * Inline form (không modal) ở trang request detail. Sau success refresh router
 * để re-render thành "Bạn đã apply" state.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  requestId: string;
  suggestedRate: number;
};

export function ApplyForm({ requestId, suggestedRate }: Props) {
  const router = useRouter();
  const [message, setMessage] = React.useState('');
  const [rate, setRate] = React.useState(String(suggestedRate));
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    if (message.trim().length < 20) {
      toast.error('Tin nhắn tối thiểu 20 ký tự');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring/requests/${requestId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          proposedRateVnd: parseInt(rate, 10),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Apply thất bại');
      }
      toast.success('Đã apply — đợi học sinh phản hồi');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card p-6 shadow-soft">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight">
          Apply request này
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Giới thiệu ngắn về bản thân + đề xuất giá. Học sinh sẽ thấy + chọn.
        </p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="apply-msg">Lời chào *</Label>
          <textarea
            id="apply-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="VD: Em là gia sư Toán 5 năm kinh nghiệm, đã ôn 50+ học sinh thi đại học. Em có thể dạy theo phương pháp..."
            className="block w-full rounded-xl border border-input bg-surface px-4 py-2.5 text-sm shadow-soft transition-all duration-base focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:outline-none"
          />
          <p className="text-[11px] text-text-muted">
            {message.length}/1000 (tối thiểu 20)
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apply-rate">Đề xuất giá / giờ (VND) *</Label>
          <Input
            id="apply-rate"
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            min={10000}
            step={10000}
          />
          <p className="text-[11px] text-text-muted">
            {parseInt(rate, 10).toLocaleString('vi-VN')} VND
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Đang gửi...
              </>
            ) : (
              <>
                <Send className="mr-1 h-4 w-4" />
                Gửi apply
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
