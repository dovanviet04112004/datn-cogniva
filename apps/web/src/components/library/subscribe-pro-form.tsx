/**
 * SubscribeProForm — Phase 4 Step 5 (2026-05-27).
 *
 * Client-side form chọn số tháng → POST /api/library/subscribe-pro → toast +
 * refresh để parent server component re-render PRO state.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

const MONTHLY_PRICE = 199_000;
// Label dạng "{n} tháng" dịch tại render; badgeKey null = không badge.
const PRESETS: Array<{ months: number; badgeKey?: string }> = [
  { months: 1 },
  { months: 3, badgeKey: 'library.subscribe.save' },
  { months: 6, badgeKey: 'library.subscribe.popular' },
  { months: 12, badgeKey: 'library.subscribe.best_value' },
];

export function SubscribeProForm({ currentBalance }: { currentBalance: number }) {
  const t = useT();
  const router = useRouter();
  const [months, setMonths] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  const total = MONTHLY_PRICE * months;
  const enough = currentBalance >= total;

  const submit = async () => {
    if (!enough) {
      toast.error(t('library.subscribe.insufficient'));
      return;
    }
    setLoading(true);
    try {
      const data = await apiSend<{
        ok?: boolean;
        paid?: number;
        proUntilAt?: string;
        error?: string;
      }>('/api/library/subscribe-pro', 'POST', { months });
      if (!data.ok) {
        toast.error(data.error ?? t('library.subscribe.failed'));
        return;
      }
      toast.success(
        `${t('library.subscribe.success_prefix')} ${new Date(data.proUntilAt!).toLocaleDateString('vi-VN')}`,
      );
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p.months}
            type="button"
            onClick={() => setMonths(p.months)}
            className={cn(
              'relative rounded-xl border p-3 text-left transition-all',
              months === p.months
                ? 'border-discovery-500 bg-discovery-500/10 shadow-sm'
                : 'border-divider hover:border-discovery-500/40 hover:bg-muted/50',
            )}
          >
            {p.badgeKey && (
              <span className="absolute -top-2 right-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                {t(p.badgeKey)}
              </span>
            )}
            <p className="text-[12.5px] font-semibold">
              {p.months} {t('library.subscribe.month')}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {(MONTHLY_PRICE * p.months).toLocaleString('vi-VN')}đ
            </p>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-[12px]">
        <span className="text-muted-foreground">{t('library.subscribe.total')}</span>
        <span className="font-bold text-discovery-600">
          {total.toLocaleString('vi-VN')}đ
        </span>
      </div>

      {!enough && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          {t('library.subscribe.short_prefix')} {(total - currentBalance).toLocaleString('vi-VN')}đ{' '}
          {t('library.subscribe.short_suffix')}
        </p>
      )}

      <Button
        onClick={submit}
        disabled={loading || !enough}
        size="lg"
        className="w-full bg-gradient-to-r from-discovery-600 to-fuchsia-600 text-white hover:from-discovery-700 hover:to-fuchsia-700"
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Crown className="mr-1.5 h-4 w-4" />
        )}
        {t('library.subscribe.cta')} — {total.toLocaleString('vi-VN')}đ / {months} {t('library.subscribe.month')}
      </Button>
    </div>
  );
}
