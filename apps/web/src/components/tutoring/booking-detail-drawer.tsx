/**
 * BookingDetailModal — xem chi tiết 1 đơn học trong modal LỚN ở giữa màn hình.
 *
 * Mở overlay căn giữa (kiểu Atom Guide / recipe-overlay) thay vì nhảy trang.
 * Hiển thị: đối tác, môn·cấp, thời gian, giá, lời nhắn, phòng học, ghi chú buổi
 * + nút hành động (xác nhận / huỷ / hoàn thành — tái dùng BookingActions).
 * Phần nâng cao (thanh toán / đánh giá) có link "Mở trang đầy đủ".
 *
 * Fetch GET /api/tutoring/bookings/[id] khi mở; refetch sau mỗi action.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarClock,
  Loader2,
  MessageSquareText,
  StickyNote,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { BookingActions } from './booking-actions';
import { BookingPaymentBox } from './booking-payment-box';
import { BookingReviewForm } from './booking-review-form';

type Detail = {
  booking: {
    id: string;
    studyGroupId: string | null;
    subjectSlug: string;
    level: string;
    startAt: string;
    endAt: string;
    rateVnd: number;
    status: 'PENDING_TUTOR' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    studentMessage: string | null;
    sessionNotes: string | null;
    cancelReason: string | null;
    tutorName: string | null;
    tutorAvatarUrl: string | null;
    studentName: string | null;
    studentImage: string | null;
    studyGroupName: string | null;
  };
  review: { rating: number; comment: string | null } | null;
  payment: { id: string; orderCode: string; amountVnd: number; provider: string; status: string } | null;
  role: 'student' | 'tutor';
};

const STATUS_META: Record<Detail['booking']['status'], { label: string; cls: string }> = {
  PENDING_TUTOR: { label: 'Chờ xác nhận', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20' },
  CONFIRMED: { label: 'Đã xác nhận', cls: 'bg-primary/10 text-primary ring-primary/20' },
  IN_PROGRESS: { label: 'Đang học', cls: 'bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 ring-discovery-500/20' },
  COMPLETED: { label: 'Đã hoàn thành', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20' },
  CANCELLED: { label: 'Đã huỷ', cls: 'bg-muted/60 text-muted-foreground ring-border' },
};

function fmtRange(startAt: string, endAt: string): string {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const date = s.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hm = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${hm(s)}–${hm(e)}`;
}

export function BookingDetailModal({
  bookingId,
  open,
  onOpenChange,
  onChanged,
}: {
  bookingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Báo list cha refetch sau khi đơn đổi trạng thái. */
  onChanged?: () => void;
}) {
  // GET chi tiết đơn qua React Query — chỉ fetch khi modal mở + có id.
  // Mỗi đơn cache riêng theo key → mở lại không phải tải lại.
  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: qk.tutoringBookingDetail(bookingId ?? ''),
    queryFn: () => apiGet<Detail>(`/api/tutoring/bookings/${bookingId}`),
    enabled: open && !!bookingId,
  });

  const b = data?.booking;
  const role = data?.role ?? 'student';
  const payment = data?.payment ?? null;
  const review = data?.review ?? null;
  const subj = b ? SUBJECT_BY_SLUG[b.subjectSlug] : undefined;
  const peerName = b ? (role === 'student' ? b.tutorName : b.studentName) : null;
  const peerImg = b ? (role === 'student' ? b.tutorAvatarUrl : b.studentImage) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-auto max-h-[88vh] w-[94vw] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogTitle className="sr-only">Chi tiết đơn học</DialogTitle>

        {/* Header bar */}
        <div className="flex shrink-0 items-center border-b border-divider px-5 py-3.5 pr-14">
          <h2 className="text-sm font-semibold tracking-tight">Chi tiết đơn học</h2>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading && !b ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tải…
            </div>
          ) : !b ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Không tải được đơn.</p>
          ) : (
            <div className="mx-auto max-w-xl space-y-5">
              {/* Đối tác + trạng thái */}
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={peerImg ?? undefined} />
                  <AvatarFallback>{(peerName ?? '?')[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold tracking-tight">
                    {peerName ?? 'Ẩn danh'}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {role === 'student' ? 'Gia sư' : 'Học viên'}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset',
                    STATUS_META[b.status].cls,
                  )}
                >
                  {STATUS_META[b.status].label}
                </span>
              </div>

              {/* Thông tin */}
              <div className="space-y-2.5 rounded-xl bg-muted/30 p-3.5 text-[13px]">
                <Row label="Môn">
                  {subj?.emoji ?? '📚'} {subj?.name ?? b.subjectSlug} ·{' '}
                  {LEVEL_NAMES[b.level as keyof typeof LEVEL_NAMES] ?? b.level}
                </Row>
                <Row label="Thời gian" icon={CalendarClock}>
                  {fmtRange(b.startAt, b.endAt)}
                </Row>
                <Row label="Học phí">
                  <span className="font-mono tabular-nums font-semibold">
                    {b.rateVnd.toLocaleString('vi-VN')}đ
                  </span>
                </Row>
              </div>

              {b.studentMessage && (
                <Block icon={MessageSquareText} title="Lời nhắn từ học viên">
                  {b.studentMessage}
                </Block>
              )}

              {b.sessionNotes && (
                <Block icon={StickyNote} title="Ghi chú buổi học">
                  {b.sessionNotes}
                </Block>
              )}

              {b.status === 'CANCELLED' && b.cancelReason && (
                <Block title="Lý do huỷ">{b.cancelReason}</Block>
              )}

              {b.studyGroupId && (
                <Link
                  href={`/groups/${b.studyGroupId}`}
                  className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Users className="h-4 w-4" />
                  Vào phòng học: {b.studyGroupName ?? 'Phòng riêng'}
                  <ArrowUpRight className="ml-auto h-4 w-4" />
                </Link>
              )}

              {/* Thanh toán — student, đã xác nhận/đang học, chưa capture */}
              {role === 'student' &&
                (b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS') &&
                payment &&
                payment.status !== 'CAPTURED' && (
                  <BookingPaymentBox bookingId={b.id} payment={payment} />
                )}

              {/* Đánh giá — student sau khi hoàn thành */}
              {role === 'student' && b.status === 'COMPLETED' && (
                <BookingReviewForm
                  bookingId={b.id}
                  existing={review ? { rating: review.rating, comment: review.comment ?? '' } : null}
                />
              )}

              <BookingActions
                bookingId={b.id}
                status={b.status}
                startAt={b.startAt}
                role={role}
                hasStudyGroup={!!b.studyGroupId}
                onDone={() => {
                  void refetch();
                  onChanged?.();
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: typeof CalendarClock;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="inline-flex w-20 shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon?: typeof CalendarClock;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {title}
      </p>
      <p className="whitespace-pre-wrap rounded-xl bg-muted/30 p-3 text-[13px] leading-relaxed text-foreground/85">
        {children}
      </p>
    </div>
  );
}
