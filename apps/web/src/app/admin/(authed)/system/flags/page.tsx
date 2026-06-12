import { FlagsClient } from '@/components/admin/system/flags-client';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Flag = {
  name: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
};

export default async function AdminFlagsPage() {
  const { flags } = await apiServer<{ flags: Flag[] }>('/api/admin/system/flags');
  return <FlagsClient initial={flags} />;
}
