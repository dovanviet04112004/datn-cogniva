import { requireAdmin } from '@/lib/admin/guard';
import { ReportsListClient } from '@/components/admin/moderation/reports-list-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const admin = await requireAdmin();
  return <ReportsListClient adminRole={admin.role} />;
}
