/**
 * /admin/system/jobs — trạng thái BullMQ queues + cron schedules.
 */
import { headers } from 'next/headers';

import { JobsClient } from '@/components/admin/system/jobs-client';
import { requireAdmin } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminJobsPage() {
  await requireAdmin();

  const hdr = await headers();
  const cookie = hdr.get('cookie') ?? '';
  const host = hdr.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const res = await fetch(`${proto}://${host}/api/admin/system/jobs`, {
    headers: { cookie },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Lỗi tải jobs: ${res.status}`);
  }
  const data = (await res.json()) as Parameters<typeof JobsClient>[0];

  return <JobsClient {...data} />;
}
