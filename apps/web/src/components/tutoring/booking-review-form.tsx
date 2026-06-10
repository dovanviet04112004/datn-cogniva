/**
 * BookingReviewForm — student rate tutor sau khi booking COMPLETED.
 *
 * Nếu `existing` non-null → render read-only mode (đã review rồi).
 * Else → form 5-star + comment, POST /api/tutoring/bookings/[id]/review.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function BookingReviewForm({
  bookingId,
  existing,
}: {
  bookingId: string;
  existing: { rating: number; comment: string } | null;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(existing?.rating ?? 5);
  const [comment, setComment] = React.useState(existing?.comment ?? '');
  const [submitting, setSubmitting] = React.useState(false);

  const readonly = !!existing;

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring/bookings/${bookingId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof e?.error === 'string' ? e.error : 'Review thất bại',
        );
      }
      toast.success('Cảm ơn đánh giá!');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card p-5 shadow-soft">
      <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
        {readonly ? 'Đánh giá của bạn' : 'Đánh giá buổi học'}
      </p>

      <div className="mt-3 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={readonly}
            onClick={() => setRating(n)}
            className={cn(
              'transition-transform',
              !readonly && 'hover:scale-110',
            )}
          >
            <Star
              className={cn(
                'h-7 w-7',
                n <= rating
                  ? 'fill-amber-500 text-amber-500'
                  : 'text-muted-foreground/40',
              )}
            />
          </button>
        ))}
        <span className="ml-2 font-mono text-sm tabular-nums">{rating}/5</span>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={2000}
        readOnly={readonly}
        placeholder="Chia sẻ cảm nhận về buổi học (tuỳ chọn)..."
        className={cn(
          'mt-4 block w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm shadow-soft transition-all focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:outline-none',
          readonly && 'cursor-not-allowed opacity-80',
        )}
      />

      {!readonly && (
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Star className="mr-1 h-4 w-4 fill-current" />
            )}
            Gửi đánh giá
          </Button>
        </div>
      )}
    </div>
  );
}
