/**
 * DocReviewSection V2 — collapsible form + rating distribution + consistent header.
 *
 * V2 UX (2026-05-27):
 *   - Form submit ẩn default, click "Viết đánh giá" expand
 *   - Header style đồng nhất với "Tài liệu bổ trợ"
 *   - Rating distribution bar (★5 X · ★4 Y · ...)
 *   - List reviews max-h cuộn nếu nhiều
 */
'use client';

import * as React from 'react';
import { Loader2, MessageSquare, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
// SectionHeading dùng chung toàn app (thay bản local cũ ở related-docs-section).
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  helpfulCount: number;
  createdAt: string;
  reviewerName: string | null;
  reviewerImage: string | null;
};

export function DocReviewSection({ docId }: { docId: string }) {
  const t = useT();
  const RATING_LABELS = [
    t('library.review.label.bad'),
    t('library.review.label.ok'),
    t('library.review.label.fine'),
    t('library.review.label.good'),
    t('library.review.label.excellent'),
  ] as const;
  const [rating, setRating] = React.useState(0);
  const [hoverRating, setHoverRating] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);

  const { data: reviews = [], isLoading: loading, refetch } = useQuery({
    queryKey: qk.libraryDocReviews(docId),
    queryFn: () =>
      apiGet<{ reviews: Review[] }>(`/api/library/docs/${docId}/reviews`).then(
        (d) => d.reviews,
      ),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1) {
      toast.error(t('library.review.choose_rating'));
      return;
    }
    setSubmitting(true);
    try {
      await apiSend(`/api/library/docs/${docId}/reviews`, 'POST', {
        rating,
        comment: comment.trim() || undefined,
      });
      toast.success(t('library.review.submitted'));
      setRating(0);
      setComment('');
      setFormOpen(false);
      void refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Distribution count per star (5..1) cho mini bars
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));
  const maxBucket = Math.max(1, ...distribution.map((d) => d.count));
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;
  const activeStar = hoverRating || rating;

  return (
    <section className="mt-8 space-y-4">
      {/* Tiêu đề mục đánh giá + nút "Viết đánh giá" slot action bên phải. */}
      <SectionHeading
        count={reviews.length}
        action={
          !formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="text-[11.5px] font-semibold text-primary hover:underline"
            >
              {t('library.review.write')}
            </button>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          {t('library.review.section_title')}
        </span>
      </SectionHeading>

      {/* Distribution summary — chỉ hiện khi có ≥ 1 review */}
      {reviews.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-divider bg-card p-3">
          <div className="flex flex-col items-center justify-center">
            <p className="text-2xl font-bold tabular-nums">
              {avgRating.toFixed(1)}
            </p>
            <p className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
              {'★'.repeat(Math.round(avgRating))}
              <span className="text-muted-foreground/40">
                {'☆'.repeat(5 - Math.round(avgRating))}
              </span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              {reviews.length} {t('library.review.count')}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-1">
            {distribution.map((d) => (
              <div key={d.star} className="flex items-center gap-2 text-[10.5px]">
                <span className="w-4 font-mono tabular-nums text-muted-foreground">
                  {d.star}★
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${(d.count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="w-5 text-right font-mono tabular-nums text-muted-foreground">
                  {d.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit form — collapsible */}
      {formOpen && (
        <form
          onSubmit={submit}
          className="space-y-2.5 rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold">{t('library.review.rate_this')}</p>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setRating(0);
                setComment('');
              }}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('library.review.close_form')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className="flex items-center gap-1"
            onMouseLeave={() => setHoverRating(0)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHoverRating(n)}
                className={cn(
                  'transition-colors',
                  n <= activeStar ? 'text-amber-500' : 'text-muted-foreground/30',
                )}
                aria-label={t('library.review.star').replace('{n}', String(n))}
              >
                <Star className={cn('h-6 w-6', n <= activeStar && 'fill-current')} />
              </button>
            ))}
            {activeStar > 0 && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                {RATING_LABELS[activeStar - 1]}
              </span>
            )}
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('library.review.comment_placeholder')}
            rows={3}
            maxLength={500}
            className="resize-none text-[12.5px]"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-muted-foreground">
              {comment.length}/500
            </span>
            <Button type="submit" size="sm" disabled={submitting || rating < 1}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('library.review.submit')}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('library.review.loading')}</p>
      ) : reviews.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          {t('library.review.empty')} {!formOpen && `${t('library.review.first_prefix')} `}
          {!formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="font-semibold text-primary hover:underline"
            >
              {t('library.review.write_now')}
            </button>
          )}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-divider bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={r.reviewerImage ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {(r.reviewerName ?? '?')[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold">{r.reviewerName}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </div>
                <span className="font-mono text-[11.5px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {'★'.repeat(r.rating)}
                  <span className="text-muted-foreground/40">
                    {'☆'.repeat(5 - r.rating)}
                  </span>
                </span>
              </div>
              {r.comment && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/85">
                  {r.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
