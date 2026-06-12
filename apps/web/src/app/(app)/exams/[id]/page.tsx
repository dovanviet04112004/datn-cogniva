import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServer } from '@/lib/api-server';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

type RedirectInfo = {
  found: boolean;
  isOwner: boolean;
  workspaceId: string | null;
  status: string | null;
  inProgressAttemptId: string | null;
};

export default async function ExamRedirectPage({ params }: Props) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/exams/${id}`)}`);
  }

  const info = await apiServer<RedirectInfo>(`/api/exams/${id}/redirect-info`);

  if (!info.found) redirect('/workspaces');

  if (info.isOwner) {
    if (info.workspaceId) {
      redirect(`/workspaces/${info.workspaceId}?examPreview=${id}`);
    }
    redirect('/workspaces');
  }

  if (info.status !== 'PUBLISHED') {
    redirect('/workspaces');
  }

  if (info.workspaceId) {
    redirect(`/workspaces/${info.workspaceId}?examPreview=${id}`);
  }

  if (info.inProgressAttemptId) {
    redirect(`/exams/${id}/take/${info.inProgressAttemptId}`);
  }
  redirect('/workspaces');
}
