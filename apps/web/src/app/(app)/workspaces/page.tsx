import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';
import { WorkspacesDashboardClient } from '@/components/workspaces/workspaces-dashboard-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WorkspacesOverview = {
  workspaces: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    documentCount: number;
    lastActivityAt: string | null;
  }>;
  totalDocs: number;
  recentDocs: Array<{
    id: string;
    filename: string;
    createdAt: string;
    workspaceId: string;
    workspaceName: string | null;
  }>;
};

export default async function WorkspacesPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/workspaces');

  const data = await apiServer<WorkspacesOverview>('/api/workspaces/overview');

  return (
    <WorkspacesDashboardClient
      workspaces={data.workspaces}
      totalDocs={data.totalDocs}
      recentDocs={data.recentDocs}
    />
  );
}
