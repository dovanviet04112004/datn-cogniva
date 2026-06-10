/**
 * /admin/ai/circuits — list circuit breakers + manual reset.
 */
import { requireAdmin } from '@/lib/admin/guard';
import { CircuitsClient } from '@/components/admin/ai/circuits-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminCircuitsPage() {
  const admin = await requireAdmin();
  return <CircuitsClient adminRole={admin.role} />;
}
