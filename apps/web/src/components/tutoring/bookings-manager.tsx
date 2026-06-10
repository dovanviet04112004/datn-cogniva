/**
 * BookingsManager — danh sách ĐƠN học theo trạng thái, cho cả 2 phía.
 *
 * - role 'student' = đơn mình đặt (đối tác hiển thị = gia sư).
 * - role 'tutor'   = đơn mình dạy (đối tác hiển thị = học viên).
 * - showRoleToggle: user vừa là học viên vừa là gia sư → cho chuyển "Tôi học /
 *   Tôi dạy".
 *
 * Tab lọc theo nhóm trạng thái: Chờ xác nhận · Sắp/đang học · Đã xong · Đã huỷ.
 * Fetch /api/tutoring/bookings?role=… (client) rồi group tại chỗ.
 */
'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Clock, Inbox, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { BookingDetailModal } from './booking-detail-drawer';

type Booking = {
  id: string;
  tutorId: string;
  studentId: string;
  subjectSlug: string;
  level: string;
  startAt: string;
  endAt: string;
  rateVnd: number;
  status: 'PENDING_TUTOR' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  isTrial: boolean;
  tutorName: string | null;
  tutorAvatarUrl: string | null;
  studentName: string | null;
  studentImage: string | null;
};

type Bucket = 'all' | 'pending' | 'active' | 'done' | 'cancelled';

const STATUS_META: Record<
  Booking['status'],
  { label: string; cls: string; bucket: Exclude<Bucket, 'all'> }
> = {
  PENDING_TUTOR: {
    label: 'Chờ xác nhận',
    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20',
    bucket: 'pending',
  },
  CONFIRMED: {
    label: 'Đã xác nhận',
    cls: 'bg-primary/10 text-primary ring-primary/20',
    bucket: 'active',
  },
  IN_PROGRESS: {
    label: 'Đang học',
    cls: 'bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 ring-discovery-500/20',
    bucket: 'active',
  },
  COMPLETED: {
    label: 'Đã hoàn thành',
    cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
    bucket: 'done',
  },
  CANCELLED: {
    label: 'Đã huỷ',
    cls: 'bg-muted/60 text-muted-foreground ring-border',
    bucket: 'cancelled',
  },
};

const TABS: Array<{ key: Bucket; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ xác nhận' },
  { key: 'active', label: 'Sắp / đang học' },
  { key: 'done', label: 'Đã xong' },
  { key: 'cancelled', label: 'Đã huỷ' },
];

function fmtWhen(startAt: string, endAt: string): string {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const date = s.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const hm = (d: Date) =>
    d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${hm(s)}–${hm(e)}`;
}

export function BookingsManager({
  defaultRole,
  showRoleToggle,
}: {
  defaultRole: 'student' | 'tutor';
  showRoleToggle: boolean;
}) {
  const [role, setRole] = React.useState<'student' | 'tutor'>(defaultRole);
  const [bucket, setBucket] = React.useState<Bucket>('all');
  // Đơn đang mở trong drawer (null = đóng).
  const [openId, setOpenId] = React.useState<string | null>(null);

  const qc = useQueryClient();
  const { data: bookings = null, isLoading: loading } = useQuery({
    queryKey: qk.tutoringBookings(role),
    queryFn: () =>
      apiGet<{ bookings: Booking[] }>(`/api/tutoring/bookings?role=${role}`)
        .then((d) => d.bookings)
        .catch(() => [] as Booking[]),
  });
  // invalidate để refetch (drawer onChanged / sau hành động).
  const load = () => qc.invalidateQueries({ queryKey: qk.tutoringBookings(role) });

  // Deep-link: /tutoring?tab=orders&booking=<id> → auto mở modal 1 lần.
  const sp = useSearchParams();
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (autoOpened.current) return;
    const id = sp.get('booking');
    if (id) {
      autoOpened.current = true;
      setOpenId(id);
    }
  }, [sp]);

  const counts = React.useMemo(() => {
    const c: Record<Bucket, number> = {
      all: 0,
      pending: 0,
      active: 0,
      done: 0,
      cancelled: 0,
    };
    for (const b of bookings ?? []) {
      c.all++;
      c[STATUS_META[b.status].bucket]++;
    }
    return c;
  }, [bookings]);

  const filtered = (bookings ?? []).filter(
    (b) => bucket === 'all' || STATUS_META[b.status].bucket === bucket,
  );

  return (
    <div className="space-y-4">
      {/* Toggle vai trò */}
      {showRoleToggle && (
        <div className="inline-flex rounded-xl bg-muted/40 p-1 text-[12.5px] font-medium">
          {(['student', 'tutor'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                'rounded-lg px-3 py-1.5 transition-colors',
                role === r
                  ? 'bg-card text-foreground shadow-soft'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r === 'student' ? 'Tôi học' : 'Tôi dạy'}
            </button>
          ))}
        </div>
      )}

      {/* Tab trạng thái */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setBucket(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
              bucket === t.key
                ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted',
            )}
          >
            {t.label}
            <span className="font-mono tabular-nums opacity-70">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải đơn…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-divider bg-surface-secondary/40 py-12 text-center">
          <Inbox className="h-7 w-7 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {role === 'tutor'
              ? 'Chưa có đơn nào ở mục này.'
              : 'Bạn chưa có đơn nào ở mục này.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((b) => {
            const meta = STATUS_META[b.status];
            const subj = SUBJECT_BY_SLUG[b.subjectSlug];
            // Đối tác hiển thị tuỳ vai trò đang xem.
            const peerName =
              role === 'student' ? b.tutorName : b.studentName;
            const peerImg =
              role === 'student' ? b.tutorAvatarUrl : b.studentImage;
            const priceK = Math.round(b.rateVnd / 1000);
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(b.id)}
                  className="group flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated"
                >
                  <Avatar className="h-11 w-11 shrink-0">
                    <AvatarImage src={peerImg ?? undefined} />
                    <AvatarFallback>
                      {(peerName ?? '?')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold tracking-tight">
                        {peerName ?? 'Ẩn danh'}
                      </p>
                      {b.isTrial && (
                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          Học thử
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                      <span>
                        {subj?.emoji ?? '📚'} {subj?.name ?? b.subjectSlug} ·{' '}
                        {LEVEL_NAMES[b.level as keyof typeof LEVEL_NAMES] ?? b.level}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {fmtWhen(b.startAt, b.endAt)}
                      </span>
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                        meta.cls,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {priceK}K
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal chi tiết đơn — mở giữa màn hình thay vì nhảy trang */}
      <BookingDetailModal
        bookingId={openId}
        open={openId !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}
