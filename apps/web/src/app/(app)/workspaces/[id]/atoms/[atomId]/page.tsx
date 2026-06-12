import { notFound, redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { PageShell } from '@/components/layout/page-shell';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { AtomDetailClient } from '@/components/atoms/atom-detail-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string; atomId: string }>;
};

type AtomView = {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  examples: string[];
  difficulty: number | null;
  previewQuestion: string | null;
  previewAnswer: string | null;
  mastery: {
    score: number;
    attempts: number;
    correct: number;
    lastSeenAt: string | null;
    lastQuizAt: string | null;
    lastFlashcardAt: string | null;
    lastExamAt: string | null;
  } | null;
  counts: {
    flashcards: number;
    quizQuestions: number;
    examQuestions: number;
  };
};

export default async function AtomDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');

  const { id: workspaceId, atomId } = await params;

  const wsData = await apiServerOrNull<{ workspace: { id: string; name: string } }>(
    `/api/workspaces/${workspaceId}`,
  );
  if (!wsData) notFound();

  const atomData = await apiServerOrNull<{ atom: AtomView }>(`/api/atoms/${atomId}`);
  if (!atomData) notFound();
  const atom = atomData.atom;

  return (
    <PageShell>
      <Breadcrumbs
        segments={[
          { href: '/workspaces', label: 'Workspaces' },
          { href: `/workspaces/${workspaceId}`, label: wsData.workspace.name },
          {
            href: `/workspaces/${workspaceId}?tab=practice`,
            label: 'Practice',
          },
          { label: atom.name },
        ]}
      />

      <AtomDetailClient workspaceId={workspaceId} atom={atom} />
    </PageShell>
  );
}
