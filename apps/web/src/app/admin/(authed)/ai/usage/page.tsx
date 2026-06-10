/**
 * /admin/ai/usage — per-user usage breakdown + CSV export.
 */
import { UsageClient } from '@/components/admin/ai/usage-client';

export const dynamic = 'force-dynamic';

export default function AdminUsagePage() {
  return <UsageClient />;
}
