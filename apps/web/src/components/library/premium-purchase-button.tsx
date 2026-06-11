'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Lock, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/context';

export function PremiumPurchaseButton({
  docId,
  priceVnd,
  creatorSharePct,
}: {
  docId: string;
  priceVnd: number;
  creatorSharePct: number;
}) {
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [purchased, setPurchased] = React.useState(false);

  const buy = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/purchase`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        already?: boolean;
        isPro?: boolean;
        error?: string;
        required?: number;
        available?: number;
      };
      if (!res.ok) {
        if (res.status === 402) {
          toast.error(
            `${data.error}. ${t('library.purchase.need_prefix')} ${data.required?.toLocaleString('vi-VN')}đ, ${t('library.purchase.need_have')} ${data.available?.toLocaleString('vi-VN')}đ.`,
          );
        } else {
          toast.error(data.error ?? t('library.purchase.failed'));
        }
        return;
      }
      setPurchased(true);
      if (data.isPro) {
        toast.success(t('library.purchase.pro_unlock'));
      } else if (data.already) {
        toast.info(t('library.purchase.already'));
      } else {
        toast.success(
          `${t('library.purchase.success_prefix')} ${priceVnd.toLocaleString('vi-VN')}đ`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (purchased) {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t('library.purchase.owned_loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      <Button
        onClick={buy}
        disabled={loading}
        size="lg"
        className="bg-discovery-600 hover:bg-discovery-700 text-white"
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <ShoppingCart className="mr-1.5 h-4 w-4" />
        )}
        {t('library.purchase.buy_now')} {priceVnd.toLocaleString('vi-VN')}đ
      </Button>
      <p className="text-muted-foreground text-center text-[10.5px]">
        <Lock className="inline-block h-2.5 w-2.5" /> {t('library.purchase.creator_gets')}{' '}
        {creatorSharePct}% · {t('library.purchase.cogniva_keeps')} {100 - creatorSharePct}% ·{' '}
        <Link href="/wallet" className="font-semibold underline">
          {t('library.purchase.wallet_balance')}
        </Link>
      </p>
    </div>
  );
}

export function PremiumLockedPreview({
  docId,
  priceVnd,
  creatorSharePct,
  thumbUrl,
  title,
}: {
  docId: string;
  priceVnd: number;
  creatorSharePct: number;
  thumbUrl: string | null;
  title: string;
}) {
  const t = useT();
  return (
    <div className="border-discovery-500/30 bg-card relative overflow-hidden rounded-2xl border shadow-md">
      <div className="relative h-[560px] w-full overflow-hidden">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={title}
            className="h-full w-full scale-110 object-cover blur-md brightness-50"
          />
        ) : (
          <div className="from-discovery-600/30 h-full w-full bg-gradient-to-br via-fuchsia-600/20 to-purple-700/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="bg-discovery-500/20 ring-discovery-500/10 rounded-full p-3 ring-4">
          <Lock className="text-discovery-300 h-7 w-7" />
        </div>
        <div>
          <p className="text-discovery-300 text-[11px] font-semibold uppercase tracking-wider">
            {t('library.purchase.premium_doc')}
          </p>
          <p className="mt-1 max-w-sm text-[16px] font-semibold text-white">{title}</p>
          <p className="mt-2 text-[12px] text-white/70">{t('library.purchase.buy_once')}</p>
        </div>
        <PremiumPurchaseButton
          docId={docId}
          priceVnd={priceVnd}
          creatorSharePct={creatorSharePct}
        />
        <p className="max-w-sm text-[10.5px] text-white/60">
          {t('library.purchase.or')}{' '}
          <Link href="/library/pro" className="text-discovery-300 font-semibold underline">
            {t('library.purchase.upgrade_pro')}
          </Link>{' '}
          {t('library.purchase.upgrade_pro_suffix')}
        </p>
      </div>
    </div>
  );
}
