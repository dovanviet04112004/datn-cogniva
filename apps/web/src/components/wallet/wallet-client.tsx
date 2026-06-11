'use client';

import * as React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Gift, Loader2, Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Wallet = {
  balanceVnd: number;
  promoBalanceVnd: number;
  promoExpiresAt: string | null;
};

type Txn = {
  id: string;
  type:
    | 'TOPUP'
    | 'BOOKING_PAY'
    | 'PACK_PURCHASE'
    | 'REFUND'
    | 'CASHBACK'
    | 'PROMO'
    | 'PAYOUT_RECEIVED'
    | 'ADJUSTMENT';
  amountVnd: number;
  balanceAfterVnd: number;
  description: string | null;
  createdAt: string;
};

const TOPUP_PRESETS = [100_000, 500_000, 1_000_000, 5_000_000];

const TXN_LABEL: Record<Txn['type'], { label: string; sign: '+' | '-' }> = {
  TOPUP: { label: 'Nạp tiền', sign: '+' },
  BOOKING_PAY: { label: 'Đặt buổi học', sign: '-' },
  PACK_PURCHASE: { label: 'Mua pack', sign: '-' },
  REFUND: { label: 'Hoàn tiền', sign: '+' },
  CASHBACK: { label: 'Cashback', sign: '+' },
  PROMO: { label: 'Promo credit', sign: '+' },
  PAYOUT_RECEIVED: { label: 'Nhận thanh toán', sign: '+' },
  ADJUSTMENT: { label: 'Điều chỉnh admin', sign: '+' },
};

export function WalletClient() {
  const qc = useQueryClient();
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.wallet(),
    queryFn: () => apiGet<{ wallet: Wallet; recentTxn: Txn[] }>('/api/wallet'),
  });
  const wallet = data?.wallet ?? null;
  const txns = data?.recentTxn ?? [];

  const [topupAmount, setTopupAmount] = React.useState<number | null>(null);
  const [topupCustom, setTopupCustom] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [promoCode, setPromoCode] = React.useState('');

  const invalidateWallet = () => qc.invalidateQueries({ queryKey: qk.wallet() });

  const topup = async () => {
    const amount = topupAmount ?? Number(topupCustom.replace(/\D/g, ''));
    if (!amount || amount < 10000) {
      toast.error('Tối thiểu 10.000đ');
      return;
    }
    setBusy(true);
    try {
      const data = await apiSend<{ autoCredited?: boolean; cashback?: number }>(
        '/api/wallet/topup',
        'POST',
        { amountVnd: amount },
      );
      if (data.autoCredited) {
        toast.success(
          (data.cashback ?? 0) > 0
            ? `Đã nạp ${amount.toLocaleString('vi-VN')}đ + cashback ${(data.cashback ?? 0).toLocaleString('vi-VN')}đ`
            : `Đã nạp ${amount.toLocaleString('vi-VN')}đ`,
        );
      }
      setTopupAmount(null);
      setTopupCustom('');
      invalidateWallet();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setBusy(true);
    try {
      const data = await apiSend<{ message?: string }>('/api/tutoring/promo/redeem', 'POST', {
        code,
      });
      toast.success(data.message ?? 'Áp dụng thành công');
      setPromoCode('');
      invalidateWallet();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !wallet) {
    return (
      <Card className="text-muted-foreground flex items-center justify-center gap-2 p-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải ví…
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 from-primary/10 via-card to-discovery-500/5 overflow-hidden bg-gradient-to-br p-6">
        <div className="flex items-start gap-3">
          <span className="bg-primary/15 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.14em]">
              Số dư khả dụng
            </p>
            <p className="mt-0.5 text-3xl font-bold tabular-nums">
              {wallet.balanceVnd.toLocaleString('vi-VN')}đ
            </p>
            {wallet.promoBalanceVnd > 0 && (
              <p className="text-discovery-700 dark:text-discovery-300 mt-1 inline-flex items-center gap-1 text-[12px]">
                <Gift className="h-3 w-3" />+ {wallet.promoBalanceVnd.toLocaleString('vi-VN')}đ
                promo credit
                {wallet.promoExpiresAt && (
                  <span className="opacity-70">
                    {' '}
                    (hết hạn {new Date(wallet.promoExpiresAt).toLocaleDateString('vi-VN')})
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className="text-primary h-4 w-4" />
          <h2 className="text-[13.5px] font-semibold tracking-tight">Nạp tiền</h2>
        </div>
        <p className="text-muted-foreground text-[11.5px]">
          Nạp ≥ 1.000.000đ → tự động cashback 5% vào promo credit (hết hạn 90 ngày).
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TOPUP_PRESETS.map((amt) => {
            const active = topupAmount === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  setTopupAmount(amt);
                  setTopupCustom('');
                }}
                className={cn(
                  'rounded-xl border px-3 py-2 text-center font-mono text-sm font-semibold tabular-nums transition-all',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-divider hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                {(amt / 1000).toLocaleString('vi-VN')}k
                {amt >= 1_000_000 && (
                  <span className="text-discovery-500 ml-1 inline-flex items-center gap-0.5 text-[10px]">
                    <Sparkles className="h-2 w-2" /> 5%
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            value={topupCustom}
            onChange={(e) => {
              setTopupCustom(e.target.value.replace(/\D/g, ''));
              setTopupAmount(null);
            }}
            placeholder="Nhập số tiền tuỳ chọn (đ)"
            className="flex-1"
          />
          <Button
            onClick={topup}
            disabled={busy || (!topupAmount && !topupCustom)}
            className="min-w-[100px]"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Nạp ngay'}
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Gift className="text-discovery-500 h-4 w-4" />
          <h2 className="text-[13.5px] font-semibold tracking-tight">Mã giảm giá</h2>
        </div>
        <div className="flex gap-2">
          <Input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            placeholder="VD: STUDENT2026"
            className="flex-1 uppercase"
            maxLength={50}
          />
          <Button onClick={redeem} disabled={busy || !promoCode.trim()} variant="outline">
            Áp dụng
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-divider bg-muted/20 flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowUpFromLine className="text-muted-foreground h-4 w-4" />
            <h2 className="text-[13.5px] font-semibold">Hoạt động gần đây</h2>
          </div>
        </div>
        {txns.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-xs">
            Chưa có giao dịch. Nạp tiền lần đầu để bắt đầu.
          </p>
        ) : (
          <ul className="divide-divider divide-y">
            {txns.map((t) => {
              const meta = TXN_LABEL[t.type];
              const isCredit = t.amountVnd > 0;
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm',
                      isCredit
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-rose-500/10 text-rose-600',
                    )}
                  >
                    {isCredit ? '+' : '−'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{meta.label}</p>
                    {t.description && (
                      <p className="text-muted-foreground truncate text-[11px]">{t.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        'font-mono text-[13px] font-semibold tabular-nums',
                        isCredit ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {isCredit ? '+' : ''}
                      {t.amountVnd.toLocaleString('vi-VN')}đ
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {new Date(t.createdAt).toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
