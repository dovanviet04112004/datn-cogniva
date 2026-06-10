/**
 * BookingsListClient — tutoring bookings cross-marketplace.
 *
 * UX:
 *   - Search email tutor/student
 *   - Filter status chip
 *   - Table dense: time slot · subject · tutor · student · rate · status · payment
 *   - Click row → detail
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { cn } from '@/lib/utils';

type BookingStatus =
  | 'PENDING_TUTOR'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

type Row = {
  id: string;
  status: BookingStatus;
  subjectSlug: string;
  level: string;
  startAt: string;
  endAt: string;
  rateVnd: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  tutorProfileId: string;
  tutorUserId: string | null;
  tutorName: string | null;
  tutorEmail: string | null;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  paymentStatus: string | null;
  paymentProvider: string | null;
  paymentAmountVnd: number | null;
};

const STATUS_LIST: { val: '' | BookingStatus; label: string }[] = [
  { val: '', label: 'Tất cả' },
  { val: 'PENDING_TUTOR', label: 'Pending' },
  { val: 'CONFIRMED', label: 'Confirmed' },
  { val: 'IN_PROGRESS', label: 'In progress' },
  { val: 'COMPLETED', label: 'Completed' },
  { val: 'CANCELLED', label: 'Cancelled' },
];

export function BookingsListClient() {
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [status, setStatus] = React.useState<'' | BookingStatus>('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildQuery = (cursorParam?: string) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (status) p.set('status', status);
    if (cursorParam) p.set('cursor', cursorParam);
    p.set('limit', '50');
    return p.toString();
  };

  type Page = { bookings: Row[]; nextCursor: string | null; total: number | null };
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.adminTutoringBookings(debouncedQ, status),
    queryFn: ({ pageParam }) =>
      apiGet<Page>(
        `/api/admin/tutoring/bookings?${buildQuery(pageParam ?? undefined)}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = React.useMemo(
    () => data?.pages.flatMap((p) => p.bookings) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? null;
  const loadMore = () => {
    if (hasNextPage && !loadingMore) void fetchNextPage();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Tutoring bookings</h1>
          {total !== null && (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {total.toLocaleString('vi-VN')} total
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400">
          Bookings cross-marketplace. Click row để force cancel hoặc refund payment.
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Email tutor hoặc student…"
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

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_LIST.map((s) => (
          <button
            key={s.val}
            onClick={() => setStatus(s.val)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              status === s.val
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Slot</th>
              <th className="px-3 py-2.5">Subject</th>
              <th className="px-3 py-2.5">Tutor</th>
              <th className="px-3 py-2.5">Student</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Payment</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-xs text-slate-500">
                  Không có booking nào.
                </td>
              </tr>
            ) : (
              rows.map((b) => <BookingRow key={b.id} b={b} />)
            )}
          </tbody>
        </table>
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
    </div>
  );
}

function BookingRow({ b }: { b: Row }) {
  return (
    <tr className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40">
      <td className="px-3 py-2">
        <Link
          href={`/admin/tutoring/bookings/${b.id}`}
          className="block leading-tight text-slate-100"
        >
          <p className="font-mono text-[11px] tabular-nums">
            {new Date(b.startAt).toLocaleString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="font-mono text-[10px] text-slate-500">
            → {new Date(b.endAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </Link>
      </td>
      <td className="px-3 py-2">
        <p className="truncate font-mono text-[11px] text-slate-300">{b.subjectSlug}</p>
        <p className="font-mono text-[10px] text-slate-500">{b.level}</p>
      </td>
      <td className="px-3 py-2">
        {b.tutorUserId ? (
          <Link
            href={`/admin/users/${b.tutorUserId}`}
            className="flex flex-col leading-tight hover:text-red-300"
          >
            <span className="truncate text-[11.5px] text-slate-300">{b.tutorName ?? '—'}</span>
            <span className="truncate font-mono text-[10px] text-slate-500">
              {b.tutorEmail ?? '—'}
            </span>
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2">
        <Link
          href={`/admin/users/${b.studentId}`}
          className="flex flex-col leading-tight hover:text-red-300"
        >
          <span className="truncate text-[11.5px] text-slate-300">
            {b.studentName ?? '—'}
          </span>
          <span className="truncate font-mono text-[10px] text-slate-500">
            {b.studentEmail ?? '—'}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-slate-200">
        {b.rateVnd.toLocaleString('vi-VN')}₫
      </td>
      <td className="px-3 py-2">
        <BookingStatusPill status={b.status} />
      </td>
      <td className="px-3 py-2">
        {b.paymentStatus ? (
          <PaymentPill status={b.paymentStatus} />
        ) : (
          <span className="text-[10.5px] text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/tutoring/bookings/${b.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function BookingStatusPill({ status }: { status: BookingStatus }) {
  const cls = {
    PENDING_TUTOR: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    CONFIRMED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    IN_PROGRESS: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-300',
  }[status];
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cls,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function PaymentPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    CREATED: 'border-slate-600/30 bg-slate-700/20 text-slate-400',
    AUTHORIZED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    CAPTURED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    REFUNDED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  const c = cls[status] ?? cls.CREATED!;
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        c,
      )}
    >
      {status}
    </span>
  );
}
