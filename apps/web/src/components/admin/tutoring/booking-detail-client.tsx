/**
 * BookingDetailClient — chi tiết 1 booking + payment + review + actions.
 *
 * Actions:
 *   - Force cancel (SUPER_ADMIN / ADMIN): khi status không phải COMPLETED/CANCELLED
 *   - Refund (SUPER_ADMIN only): khi payment status = CAPTURED
 *     + Có thể nhập amountVnd partial (default = full)
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Coins,
  Eye,
  EyeOff,
  MoreHorizontal,
  Star,
  XOctagon,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AdminRole } from '@cogniva/db';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { cn } from '@/lib/utils';

type Booking = {
  id: string;
  status: string;
  subjectSlug: string;
  level: string;
  startAt: string;
  endAt: string;
  rateVnd: number;
  studentMessage: string | null;
  sessionNotes: string | null;
  recordingId: string | null;
  studyGroupId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  tutorProfileId: string;
  tutorUserId: string | null;
  tutorHeadline: string | null;
  tutorName: string | null;
  tutorEmail: string | null;
  tutorImage: string | null;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  studentImage: string | null;
};

type Payment = {
  id: string;
  amountVnd: number;
  feeVnd: number;
  provider: string;
  providerRef: string | null;
  orderCode: string;
  status: string;
  createdAt: string;
  capturedAt: string | null;
  refundedAt: string | null;
} | null;

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
} | null;

export type BookingDetailData = {
  booking: Booking;
  payment: Payment;
  review: Review;
};

export function BookingDetailClient({
  data,
  adminRole,
}: {
  data: BookingDetailData;
  adminRole: AdminRole;
}) {
  const router = useRouter();
  const { booking: b, payment, review } = data;

  const canCancel =
    (adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN') &&
    b.status !== 'COMPLETED' &&
    b.status !== 'CANCELLED';
  const canRefund =
    adminRole === 'SUPER_ADMIN' && payment?.status === 'CAPTURED';

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [refundAmount, setRefundAmount] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);

  const doCancel = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tutoring/bookings/${b.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Cancel thất bại');
      }
      toast.success('Đã force cancel booking');
      setCancelOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel thất bại');
    } finally {
      setLoading(false);
    }
  };

  const doRefund = async (reason: string) => {
    if (!payment) return;
    const parsedAmount = refundAmount.trim()
      ? Math.floor(Number(refundAmount.replace(/[^0-9]/g, '')))
      : null;
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      toast.error('Amount không hợp lệ');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tutoring/bookings/${b.id}/refund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          amountVnd: parsedAmount ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.formErrors?.[0] ?? err?.error ?? 'Refund thất bại');
      }
      toast.success('Đã refund payment');
      setRefundOpen(false);
      setRefundAmount('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refund thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              {b.subjectSlug} · {b.level}
            </h1>
            <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
              <Calendar className="h-3 w-3" />
              {new Date(b.startAt).toLocaleString('vi-VN')} →{' '}
              {new Date(b.endAt).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p className="font-mono text-[10.5px] text-slate-600">ID: {b.id}</p>
          </div>

          {(canCancel || canRefund) && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 border-slate-800 bg-slate-900 text-slate-100"
              >
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500">
                  Hành động
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-800" />
                {canCancel && (
                  <DropdownMenuItem
                    onClick={() => setCancelOpen(true)}
                    className="cursor-pointer text-red-300 focus:bg-red-500/10 focus:text-red-200"
                  >
                    <XOctagon className="mr-2 h-3.5 w-3.5" />
                    Force cancel
                  </DropdownMenuItem>
                )}
                {canRefund && (
                  <DropdownMenuItem
                    onClick={() => setRefundOpen(true)}
                    className="cursor-pointer text-blue-300 focus:bg-blue-500/10 focus:text-blue-200"
                  >
                    <Coins className="mr-2 h-3.5 w-3.5" />
                    Refund payment
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Cancel banner */}
        {b.cancelledAt && b.cancelReason && (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-[12px] text-red-200">
            <span className="font-semibold">Đã huỷ</span> bởi{' '}
            <code className="text-[11px]">{b.cancelledBy?.slice(0, 12)}</code> lúc{' '}
            <span className="font-mono text-[11px]">
              {new Date(b.cancelledAt).toLocaleString('vi-VN')}
            </span>
            <p className="mt-1 text-[11.5px] opacity-90">Lý do: {b.cancelReason}</p>
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Status" value={<StatusBadge status={b.status} />} />
          <StatTile
            label="Rate"
            value={
              <span className="font-mono">
                {b.rateVnd.toLocaleString('vi-VN')}₫
              </span>
            }
          />
          <StatTile
            label="Created"
            value={
              <span className="font-mono text-[10px]">
                {new Date(b.createdAt).toLocaleDateString('vi-VN')}
              </span>
            }
          />
          <StatTile
            label="Study group"
            value={
              b.studyGroupId ? (
                <Link
                  href={`/admin/groups/${b.studyGroupId}`}
                  className="font-mono text-[10px] hover:text-red-300"
                >
                  {b.studyGroupId.slice(0, 8)}…
                </Link>
              ) : (
                '—'
              )
            }
          />
        </div>
      </section>

      {/* Parties */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PartyCard
          title="Tutor"
          userId={b.tutorUserId}
          name={b.tutorName}
          email={b.tutorEmail}
          image={b.tutorImage}
          extra={b.tutorHeadline}
        />
        <PartyCard
          title="Student"
          userId={b.studentId}
          name={b.studentName}
          email={b.studentEmail}
          image={b.studentImage}
          extra={b.studentMessage}
          extraLabel="Mục tiêu buổi học"
        />
      </div>

      {/* Payment */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Payment</h2>
        {payment ? (
          <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
            <KV k="Provider" v={payment.provider} />
            <KV
              k="Status"
              v={<PaymentStatusBadge status={payment.status} />}
            />
            <KV
              k="Amount"
              v={
                <span className="font-mono">
                  {payment.amountVnd.toLocaleString('vi-VN')}₫
                </span>
              }
            />
            <KV
              k="Fee"
              v={
                <span className="font-mono">
                  {payment.feeVnd.toLocaleString('vi-VN')}₫
                </span>
              }
            />
            <KV k="Order code" v={<code className="text-[10.5px]">{payment.orderCode}</code>} />
            <KV
              k="Provider ref"
              v={
                payment.providerRef ? (
                  <code className="text-[10.5px]">{payment.providerRef}</code>
                ) : (
                  '—'
                )
              }
            />
            <KV
              k="Captured"
              v={
                payment.capturedAt ? (
                  <span className="font-mono text-[10.5px]">
                    {new Date(payment.capturedAt).toLocaleString('vi-VN')}
                  </span>
                ) : (
                  '—'
                )
              }
            />
            <KV
              k="Refunded"
              v={
                payment.refundedAt ? (
                  <span className="font-mono text-[10.5px]">
                    {new Date(payment.refundedAt).toLocaleString('vi-VN')}
                  </span>
                ) : (
                  '—'
                )
              }
            />
          </dl>
        ) : (
          <p className="text-[11.5px] text-slate-500">Booking chưa có payment.</p>
        )}
      </section>

      {/* Review */}
      {review && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            Review
            {review.hiddenAt ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
                <EyeOff className="h-2.5 w-2.5" />
                HIDDEN
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                <Eye className="h-2.5 w-2.5" />
                visible
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  'h-3.5 w-3.5',
                  i < review.rating
                    ? 'fill-amber-400 text-amber-400'
                    : 'fill-slate-700 text-slate-700',
                )}
              />
            ))}
            <span className="ml-2 text-[11px] text-slate-500">
              {new Date(review.createdAt).toLocaleString('vi-VN')}
            </span>
          </div>
          {review.comment && (
            <blockquote className="mt-2 border-l-2 border-slate-700 pl-3 text-[12px] italic text-slate-300">
              {review.comment}
            </blockquote>
          )}
          {review.hiddenAt && review.hiddenReason && (
            <p className="mt-2 text-[11px] text-red-300">
              <span className="font-semibold">Hidden reason:</span>{' '}
              {review.hiddenReason}
            </p>
          )}
        </section>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Force cancel booking?"
        description={
          <span>
            Booking sẽ chuyển sang <strong>CANCELLED</strong>. Cả tutor và student
            sẽ nhận notification. Study group (nếu có) KHÔNG bị xoá. Refund phải
            gọi riêng nếu payment đã CAPTURED.
          </span>
        }
        confirmLabel="Force cancel"
        variant="destructive"
        loading={loading}
        onConfirm={doCancel}
      />

      <ConfirmDialog
        open={refundOpen}
        onOpenChange={(o) => {
          setRefundOpen(o);
          if (!o) setRefundAmount('');
        }}
        title="Refund payment?"
        description={
          <div className="space-y-2">
            <p>
              Đặt payment status = <strong>REFUNDED</strong>. Phase 4 V1 KHÔNG gọi
              VNPAY/MOMO API thật — admin manual transfer ngoài. Provider STUB tự
              flip status.
            </p>
            <div>
              <label className="block text-[10.5px] font-medium text-slate-400">
                Amount VND (để trống = refund full{' '}
                <span className="font-mono">
                  {payment?.amountVnd.toLocaleString('vi-VN')}₫
                </span>
                )
              </label>
              <input
                type="text"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="vd 50000"
                className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        }
        confirmLabel="Refund"
        variant="warning"
        loading={loading}
        onConfirm={doRefund}
      />
    </>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-slate-200">{value}</p>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {k}
      </p>
      <p className="mt-0.5 truncate text-[12px] text-slate-200">{v}</p>
    </div>
  );
}

function PartyCard({
  title,
  userId,
  name,
  email,
  image,
  extra,
  extraLabel,
}: {
  title: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  extra: string | null;
  extraLabel?: string;
}) {
  const initial = (name?.[0] ?? email?.[0] ?? '?').toUpperCase();
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </p>
      {userId ? (
        <Link
          href={`/admin/users/${userId}`}
          className="flex items-center gap-3 hover:text-red-300"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={image ?? undefined} />
            <AvatarFallback className="bg-slate-800 text-[11px] text-slate-300">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-slate-100">
              {name ?? '—'}
            </p>
            <p className="truncate font-mono text-[10.5px] text-slate-500">
              {email ?? '—'}
            </p>
          </div>
        </Link>
      ) : (
        <p className="text-[11px] text-slate-500">— user đã bị xoá</p>
      )}
      {extra && (
        <div className="mt-3 border-t border-slate-800/60 pt-3">
          {extraLabel && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {extraLabel}
            </p>
          )}
          <p className="mt-0.5 line-clamp-3 text-[12px] text-slate-300">{extra}</p>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    PENDING_TUTOR: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    CONFIRMED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    IN_PROGRESS: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cls[status] ?? cls.PENDING_TUTOR,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    CREATED: 'border-slate-600/30 bg-slate-700/20 text-slate-400',
    AUTHORIZED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    CAPTURED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    REFUNDED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
        cls[status] ?? cls.CREATED,
      )}
    >
      {status}
    </span>
  );
}

