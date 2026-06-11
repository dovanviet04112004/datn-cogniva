import { requireAdmin } from '@/lib/admin/guard';
import { BannedListClient } from '@/components/admin/moderation/banned-list-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminBannedPage() {
  const admin = await requireAdmin();
  return <BannedListClient adminRole={admin.role} />;
}
