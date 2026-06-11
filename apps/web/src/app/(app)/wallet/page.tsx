/**
 * /wallet — V4 T3 (2026-05-22).
 *
 * Wallet management cho student/tutor:
 *   - Balance + promo credit display
 *   - Topup CTA + auto-topup config
 *   - Recent transactions (10 gần nhất, link "Xem tất cả")
 *   - Promo code redeem form
 *
 * Spec: docs/plans/tutoring-v4.md §7.8.
 */
import { redirect } from 'next/navigation';
import { Wallet } from 'lucide-react';

import { getServerSession } from '@/lib/auth-server';
import { PageShell } from '@/components/layout/page-shell';
import { PageHero } from '@/components/layout/page-hero';
import { WalletClient } from '@/components/wallet/wallet-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function WalletPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/wallet');
  return (
    <PageShell size="default" padded className="space-y-6">
      {/* Hero CHUNG thay header tự-chế — h1 → title, p → description. */}
      <PageHero
        eyebrow="Ví"
        eyebrowIcon={Wallet}
        title="Ví của tôi"
        description="Nạp tiền 1 lần — đặt buổi nhiều lần không cần qua VNPay mỗi buổi."
      />
      <WalletClient />
    </PageShell>
  );
}
