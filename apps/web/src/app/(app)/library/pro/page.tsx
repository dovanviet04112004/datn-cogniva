/**
 * /library/pro — Subscription PRO landing (Phase 4 Step 5, 2026-05-27).
 *
 * Server component:
 *   - Load wallet balance + user.plan + proUntilAt để hiển thị state
 *   - Client child SubscribeProForm xử lý charge wallet
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import {
  Award,
  CheckCircle2,
  Crown,
  Library,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';

import { db, user as userTable, userWallet } from '@cogniva/db';

import { PageShell } from '@/components/layout/page-shell';
import { CancelProButton } from '@/components/library/cancel-pro-button';
import { SubscribeProForm } from '@/components/library/subscribe-pro-form';
import { getServerSession } from '@/lib/auth-server';
import { getServerT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function LibraryProPage() {
  const t = await getServerT();
  const session = await getServerSession();
  if (!session) redirect('/sign-in?next=/library/pro');

  const [row] = await db
    .select({
      plan: userTable.plan,
      proUntilAt: userTable.proUntilAt,
    })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
    .limit(1);
  const [wallet] = await db
    .select({
      balanceVnd: userWallet.balanceVnd,
      promoBalanceVnd: userWallet.promoBalanceVnd,
    })
    .from(userWallet)
    .where(eq(userWallet.userId, session.user.id))
    .limit(1);

  const isPro = row?.plan === 'PRO' && (!row.proUntilAt || row.proUntilAt > new Date());
  const totalBalance = (wallet?.balanceVnd ?? 0) + (wallet?.promoBalanceVnd ?? 0);

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl py-10">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-discovery-500/30 bg-gradient-to-br from-discovery-600/15 via-fuchsia-600/10 to-purple-700/15 p-8 shadow-md">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-discovery-500/20 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-discovery-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-discovery-700 dark:text-discovery-300">
              <Crown className="h-3 w-3" />
              {t('library.pro.badge')}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{t('library.pro.hero_title')}</h1>
            <p className="mt-2 max-w-xl text-[13.5px] text-muted-foreground">
              {t('library.pro.hero_sub')}
            </p>
          </div>
        </div>

        {/* Status */}
        {isPro && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div className="flex-1 text-[12.5px]">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                {t('library.pro.member_active')}
              </p>
              <p className="text-muted-foreground">
                {t('library.pro.expires_at')}{' '}
                {row?.proUntilAt
                  ? new Date(row.proUntilAt).toLocaleString('vi-VN')
                  : '—'}{' '}
                {t('library.pro.renew_hint')}
              </p>
            </div>
            <CancelProButton proUntilAt={row?.proUntilAt?.toISOString() ?? null} />
          </div>
        )}

        {/* Features */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {[
            { icon: Library, label: t('library.pro.feature_unlock'), sub: t('library.pro.feature_unlock_sub') },
            { icon: Zap, label: t('library.pro.feature_import'), sub: t('library.pro.feature_import_sub') },
            { icon: Sparkles, label: t('library.pro.feature_concierge'), sub: t('library.pro.feature_concierge_sub') },
            { icon: Award, label: t('library.pro.feature_badge'), sub: t('library.pro.feature_badge_sub') },
          ].map((f) => (
            <div
              key={f.label}
              className="flex items-start gap-3 rounded-xl border border-divider bg-card p-3"
            >
              <div className="rounded-md bg-discovery-500/15 p-2">
                <f.icon className="h-4 w-4 text-discovery-600" />
              </div>
              <div>
                <p className="text-[12.5px] font-semibold">{f.label}</p>
                <p className="text-[11px] text-muted-foreground">{f.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Wallet status + subscribe form */}
        <div className="mt-6 rounded-2xl border border-divider bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <p className="text-[12px] font-semibold">{t('library.pro.wallet_balance')}</p>
            </div>
            <Link
              href="/wallet"
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              {totalBalance.toLocaleString('vi-VN')}đ · {t('library.pro.top_up')}
            </Link>
          </div>
          <SubscribeProForm currentBalance={totalBalance} />
        </div>
      </div>
    </PageShell>
  );
}
