'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Flag, Loader2, Search, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { useInfiniteQuery } from '@tanstack/react-query';

import type { AdminRole } from '@cogniva/db';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type Review = {
  id: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  hiddenBy: string | null;
  tutorProfileId: string;
  tutorUserId: string | null;
  tutorName: string | null;
  tutorEmail: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  reviewerImage: string | null;
};

type Visibility = 'visible' | 'hidden' | 'all';

export function ReviewsListClient({ adminRole }: { adminRole: AdminRole }) {
  const router = useRouter();
  const canMutate = adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN';

  const [visibility, setVisibility] = React.useState<Visibility>('visible');
  const [rating, setRating] = React.useState<'' | 1 | 2 | 3 | 4 | 5>('');
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');

  const [active, setActive] = React.useState<{ type: 'hide' | 'restore'; review: Review } | null>(
    null,
  );
  const [actionLoading, setActionLoading] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    p.set('visibility', visibility);
    if (rating !== '') p.set('rating', String(rating));
    if (debouncedQ) p.set('q', debouncedQ);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = { reviews: Review[]; nextCursor: string | null; hiddenCount: number };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: qk.adminTutoringReviews(JSON.stringify({ visibility, rating, q: debouncedQ })),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(`/api/admin/tutoring/reviews?${buildQuery(pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const reviews = React.useMemo(() => data?.pages.flatMap((p) => p.reviews) ?? [], [data]);
  const hiddenCount = data?.pages[0]?.hiddenCount ?? 0;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  const doAction = async (reason: string) => {
    if (!active) return;
    setActionLoading(true);
    const path = active.type === 'hide' ? 'hide' : 'restore';
    try {
      const res = await fetch(`/api/admin/tutoring/reviews/${active.review.id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? `${path} thất bại`);
      }
      toast.success(active.type === 'hide' ? 'Đã ẩn review' : 'Đã khôi phục review');
      setActive(null);
      void refetch();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Tutor reviews</h1>
          {hiddenCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-red-300 ring-1 ring-inset ring-red-500/30">
              <EyeOff className="h-3 w-3" />
              {hiddenCount} đã ẩn
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Reviews từ student đánh giá tutor. Hide review vi phạm — vẫn lưu DB để forensic + có thể
          restore.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['visible', 'hidden', 'all'] as Visibility[]).map((v) => (
          <button
            key={v}
            onClick={() => setVisibility(v)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              visibility === v
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
            )}
          >
            {v === 'visible' ? 'Đang hiện' : v === 'hidden' ? 'Đã ẩn' : 'Tất cả'}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-800" />
        <button
          onClick={() => setRating('')}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
            rating === ''
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
          )}
        >
          Mọi rating
        </button>
        {([1, 2, 3, 4, 5] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRating(r)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              rating === r
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
            )}
          >
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {r}
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Comment / email tutor / email reviewer…"
          className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {q && (
          <button
            onClick={() => setQ('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="py-12 text-center text-slate-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 py-12 text-center text-xs text-slate-500">
            Không có review nào.
          </div>
        ) : (
          reviews.map((r) => (
            <ReviewCard
              key={r.id}
              r={r}
              canMutate={canMutate}
              onHide={() => setActive({ type: 'hide', review: r })}
              onRestore={() => setActive({ type: 'restore', review: r })}
            />
          ))
        )}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800',
              loadingMore && 'opacity-50',
            )}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Tải thêm
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!active}
        onOpenChange={(o) => !o && setActive(null)}
        title={active?.type === 'hide' ? 'Ẩn review?' : 'Khôi phục review?'}
        description={
          active?.type === 'hide' ? (
            <span>
              Review sẽ KHÔNG hiển thị trên tutor profile (filter `WHERE hidden_at IS NULL`).
              Reviewer sẽ nhận notification. Vẫn lưu trong DB + restore được sau.
            </span>
          ) : (
            <span>
              Review sẽ hiện lại trên tutor profile bình thường. KHÔNG notify reviewer (admin
              restore là quyết định nội bộ).
            </span>
          )
        }
        confirmLabel={active?.type === 'hide' ? 'Ẩn review' : 'Khôi phục'}
        variant={active?.type === 'hide' ? 'destructive' : 'default'}
        loading={actionLoading}
        onConfirm={doAction}
      />
    </div>
  );
}

function ReviewCard({
  r,
  canMutate,
  onHide,
  onRestore,
}: {
  r: Review;
  canMutate: boolean;
  onHide: () => void;
  onRestore: () => void;
}) {
  const hidden = !!r.hiddenAt;
  const reviewerInitial = (r.reviewerName?.[0] ?? r.reviewerEmail?.[0] ?? '?').toUpperCase();

  return (
    <article
      className={cn(
        'rounded-lg border bg-slate-900/30 p-4 transition-colors',
        hidden ? 'border-red-500/30' : 'border-slate-800/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={r.reviewerImage ?? undefined} />
              <AvatarFallback className="bg-slate-800 text-[10.5px] text-slate-300">
                {reviewerInitial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <Link
                href={`/admin/users/${r.reviewerId}`}
                className="block min-w-0 text-[12.5px] font-medium leading-tight text-slate-100 hover:text-red-300"
              >
                <span className="truncate">{r.reviewerName ?? '—'}</span>
              </Link>
              <p className="truncate font-mono text-[10px] text-slate-500">
                {r.reviewerEmail ?? '—'}
              </p>
            </div>
            <span className="mx-1 text-slate-700">→</span>
            {r.tutorUserId ? (
              <Link
                href={`/admin/users/${r.tutorUserId}`}
                className="truncate text-[12px] text-slate-400 hover:text-red-300"
              >
                {r.tutorName ?? r.tutorEmail ?? '—'}
              </Link>
            ) : (
              '—'
            )}
            {hidden && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-300">
                <EyeOff className="h-2.5 w-2.5" />
                HIDDEN
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  'h-3 w-3',
                  i < r.rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-700 text-slate-700',
                )}
              />
            ))}
            <span className="ml-2 font-mono text-[10.5px] text-slate-500">
              {new Date(r.createdAt).toLocaleString('vi-VN', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <Link
              href={`/admin/tutoring/bookings/${r.bookingId}`}
              className="ml-2 font-mono text-[10px] text-slate-500 hover:text-slate-300"
            >
              booking:{r.bookingId.slice(0, 8)}
            </Link>
          </div>
          {r.comment && (
            <blockquote className="mt-2 border-l-2 border-slate-700 pl-3 text-[12px] italic text-slate-300">
              {r.comment}
            </blockquote>
          )}
          {hidden && r.hiddenReason && (
            <p className="mt-2 inline-flex items-start gap-1 rounded-md bg-red-500/5 px-2 py-1 text-[11px] text-red-300">
              <Flag className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              Hidden: {r.hiddenReason}
            </p>
          )}
        </div>

        {canMutate && (
          <div className="shrink-0">
            {hidden ? (
              <button
                onClick={onRestore}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
              >
                <Eye className="h-3 w-3" />
                Restore
              </button>
            ) : (
              <button
                onClick={onHide}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/15"
              >
                <EyeOff className="h-3 w-3" />
                Hide
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
