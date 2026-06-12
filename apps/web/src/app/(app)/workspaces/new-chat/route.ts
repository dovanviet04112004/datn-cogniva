import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/workspaces');

  const { workspaces } = await apiServer<{ workspaces: Array<{ id: string }> }>('/api/workspaces');
  const latest = workspaces[workspaces.length - 1];

  const wsId = latest?.id ?? (await apiServer<{ id: string }>('/api/workspaces/default')).id;

  redirect(`/workspaces/${wsId}`);
}
