/**
 * /admin/groups/[id] — chi tiết group + members + actions.
 */
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import {
  GroupDetailClient,
  type GroupDetailData,
} from '@/components/admin/groups/group-detail-client';
import { requireAdmin } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export default async function AdminGroupDetailPage({ params }: Params) {
  const admin = await requireAdmin();
  const { id } = await params;

  const hdr = await headers();
  const cookie = hdr.get('cookie') ?? '';
  const host = hdr.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const res = await fetch(`${proto}://${host}/api/admin/groups/${id}`, {
    headers: { cookie },
    cache: 'no-store',
  });
  if (res.status === 404) notFound();
  if (!res.ok) {
    throw new Error(`Lỗi tải group: ${res.status}`);
  }
  const data = (await res.json()) as GroupDetailData;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/admin/groups"
        className="inline-flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <ChevronLeft className="h-4 w-4" />
        Về danh sách
      </Link>
      <GroupDetailClient data={data} adminRole={admin.role} />
    </div>
  );
}
