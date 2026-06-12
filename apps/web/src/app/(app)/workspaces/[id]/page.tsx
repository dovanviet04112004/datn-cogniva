import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { WorkspaceNotebook } from '@/components/workspaces/v5/workspace-notebook';

const SOURCES_COOKIE = 'cogniva.ws-sources-open';
const STUDIO_COOKIE = 'cogniva.ws-studio-open';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

type WorkspaceDetail = {
  workspace: {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
  };
  documents: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
    createdAt: string;
    pageCount: number | null;
    chunks: number;
  }>;
};

export default async function WorkspaceDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');

  const { id } = await params;

  const data = await apiServerOrNull<WorkspaceDetail>(`/api/workspaces/${id}`);
  if (!data) notFound();

  const cookieStore = await cookies();
  const sourcesCookie = cookieStore.get(SOURCES_COOKIE)?.value;
  const studioCookie = cookieStore.get(STUDIO_COOKIE)?.value;
  const initialSourcesOpen = sourcesCookie !== 'false';
  const initialStudioOpen = studioCookie !== 'false';

  return (
    <WorkspaceNotebook
      workspace={{
        id: data.workspace.id,
        name: data.workspace.name,
        description: data.workspace.description,
        createdAt: data.workspace.createdAt,
      }}
      documents={data.documents}
      initialSourcesOpen={initialSourcesOpen}
      initialStudioOpen={initialStudioOpen}
    />
  );
}
