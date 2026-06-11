import { FlagsClient } from '@/components/admin/system/flags-client';
import { listAllFlags } from '@/lib/system/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminFlagsPage() {
  const raw = await listAllFlags();
  const flags = raw.map((f) => ({
    ...f,
    updatedAt: f.updatedAt.toISOString(),
  }));
  return <FlagsClient initial={flags} />;
}
