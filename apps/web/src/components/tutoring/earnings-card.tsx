/**
 * EarningsCard — tutor xem tổng earnings + request payout.
 *
 * Hiển thị:
 *   - 4 metric: total earned, released (qua escrow), pending payout, withdrawable
 *   - Form quick request payout (input amount + bank info)
 *   - List payout requests gần đây
 *
 * Client component — fetch /api/tutoring/payouts khi mount.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Summary = {
  earned: number;
  released: number;
  paidOut: number;
  pending: number;
  withdrawable: number;
};

type Payout = {
  id: string;
  amountVnd: number;
  status: string;
  method: string;
  requestedAt: string;
  processedAt: string | null;
  note: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: typeof Clock }> = {
  REQUESTED: {
    label: 'Đang chờ',
    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20',
    Icon: Clock,
  },
  APPROVED: {
    label: 'Đã duyệt',
    color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20',
    Icon: CheckCircle2,
  },
  PAID: {
    label: 'Đã thanh toán',
    color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
    Icon: CheckCircle2,
  },
  REJECTED: {
    label: 'Bị từ chối',
    color: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
    Icon: XCircle,
  },
};

export function EarningsCard() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.tutoringPayouts(),
    queryFn: () =>
      apiGet<{
        summary: Summary;
        payouts: Payout[];
        tutor: { verificationStatus: string } | null;
      }>('/api/tutoring/payouts'),
  });
  const summary = data?.summary ?? null;
  const payouts = data?.payouts ?? [];
  const verificationStatus = data?.tutor?.verificationStatus ?? 'NONE';
  // invalidate để refetch sau khi gửi yêu cầu rút tiền.
  const load = () => qc.invalidateQueries({ queryKey: qk.tutoringPayouts() });

  const [amount, setAmount] = React.useState('');
  const [bankName, setBankName] = React.useState('');
  const [accountNumber, setAccountNumber] = React.useState('');
  const [accountHolder, setAccountHolder] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    const amountVnd = parseInt(amount, 10);
    if (!amountVnd || amountVnd < 50000) {
      toast.error('Số tiền tối thiểu 50K');
      return;
    }
    if (!bankName || !accountNumber || !accountHolder) {
      toast.error('Điền đủ thông tin tài khoản');
      return;
    }
    setSubmitting(true);
    try {
      await apiSend('/api/tutoring/payouts', 'POST', {
        amountVnd,
        method: 'BANK_TRANSFER',
        accountDetails: { bankName, accountNumber, accountHolder },
      });
      toast.success('Đã gửi yêu cầu rút tiền — admin sẽ xử lý trong 3-5 ngày');
      setAmount('');
      void load();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-soft">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-4">
      {/* 4-metric grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Tổng earned" value={summary.earned} accent="bg-primary" />
        <Metric label="Đã release" value={summary.released} accent="bg-emerald-500" />
        <Metric label="Đang chờ rút" value={summary.pending} accent="bg-amber-500" />
        <Metric
          label="Rút được"
          value={summary.withdrawable}
          accent="bg-discovery-500"
          highlight
        />
      </div>

      {/* Payout request form */}
      {verificationStatus === 'KYC_VERIFIED' && summary.withdrawable >= 50000 ? (
        <div className="space-y-3 rounded-2xl bg-card p-5 shadow-soft">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-primary" />
            Yêu cầu rút tiền
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              type="number"
              placeholder={`Số tiền (≤ ${summary.withdrawable.toLocaleString('vi-VN')}đ)`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={50000}
            />
            <Input
              placeholder="Tên ngân hàng (VD: Vietcombank)"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
            <Input
              placeholder="Số tài khoản"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
            <Input
              placeholder="Chủ tài khoản (VD: NGUYEN VAN A)"
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Banknote className="mr-1 h-4 w-4" />
              )}
              Gửi yêu cầu
            </Button>
          </div>
        </div>
      ) : verificationStatus !== 'KYC_VERIFIED' ? (
        <div className="rounded-2xl border border-dashed border-divider bg-card/40 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Cần KYC verified trước khi rút tiền.{' '}
            <Link href="/tutors/me/kyc" className="font-semibold text-primary hover:underline">
              Upload CCCD ngay →
            </Link>
          </p>
        </div>
      ) : (
        <p className="rounded-2xl bg-card/40 p-4 text-center text-xs text-muted-foreground">
          Số dư rút được {'<'} 50K — chưa đủ minimum payout. Hoàn thành thêm buổi học để tích luỹ.
        </p>
      )}

      {/* Payouts list */}
      {payouts.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Lịch sử rút tiền
          </h3>
          <ul className="space-y-1.5">
            {payouts.map((p) => {
              const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.REQUESTED!;
              const Icon = cfg.Icon;
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-soft"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold tabular-nums">
                      {p.amountVnd.toLocaleString('vi-VN')}đ
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(p.requestedAt).toLocaleString('vi-VN')}
                      {p.note && ` · ${p.note}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                      cfg.color,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {cfg.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  highlight,
}: {
  label: string;
  value: number;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-card p-3 shadow-soft',
        highlight && 'ring-1 ring-inset ring-primary/30',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums leading-tight">
        {value.toLocaleString('vi-VN')}đ
      </p>
    </div>
  );
}
