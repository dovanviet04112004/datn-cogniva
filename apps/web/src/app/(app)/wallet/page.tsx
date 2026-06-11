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
