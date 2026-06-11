'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Payment = {
  id: string;
  orderCode: string;
  amountVnd: number;
  provider: string;
  status: string;
};

export function BookingPaymentBox({ bookingId, payment }: { bookingId: string; payment: Payment }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [busy, setBusy] = React.useState(false);
  const stubDone = sp.get('stub') === '1';

  React.useEffect(() => {
    if (stubDone && payment.status !== 'CAPTURED' && payment.provider === 'STUB') {
      void doCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stubDone]);

  const doCapture = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tutoring/payments/${payment.id}/capture`, {
        method: 'POST',
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Capture lỗi');
      }
      toast.success('Đã thanh toán');
      router.replace(`/tutoring/bookings/${bookingId}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/tutoring/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Intent lỗi');
      }
      const data = (await res.json()) as {
        paymentUrl: string | null;
        provider: string;
        already?: string;
      };
      if (data.already === 'CAPTURED') {
        toast.success('Đã thanh toán trước đó');
        router.refresh();
        return;
      }
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      toast.error('Không nhận được URL thanh toán');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isStub = payment.provider === 'STUB';

  return (
    <div className="border-primary/20 from-primary/5 rounded-2xl border bg-gradient-to-br to-transparent p-5">
      <div className="flex items-start gap-3">
        <div className="bg-primary/15 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <CreditCard className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            Thanh toán {payment.amountVnd.toLocaleString('vi-VN')}đ
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px]">
            {isStub
              ? 'Dev mode — STUB provider auto-capture (no real payment).'
              : `${payment.provider} · Order ${payment.orderCode}`}
          </p>
          <p
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
              payment.status === 'CREATED'
                ? 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400'
                : payment.status === 'REFUNDED'
                  ? 'bg-muted/60 text-muted-foreground ring-border'
                  : 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400',
            )}
          >
            <ShieldCheck className="h-2.5 w-2.5" />
            {payment.status}
          </p>
        </div>
      </div>

      {payment.status === 'CREATED' && (
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={pay} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="mr-1 h-4 w-4" />
            )}
            Thanh toán ngay
          </Button>
        </div>
      )}
    </div>
  );
}
