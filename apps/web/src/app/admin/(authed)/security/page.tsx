import { requireAdmin } from '@/lib/admin/guard';
import { apiServer } from '@/lib/api-server';
import { TwoFactorClient } from '@/components/admin/two-factor-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  await requireAdmin();
  const { user } = await apiServer<{ user: { twoFactorEnabled: boolean } }>('/api/auth/me');
  return <TwoFactorClient enabled={user.twoFactorEnabled ?? false} />;
}
