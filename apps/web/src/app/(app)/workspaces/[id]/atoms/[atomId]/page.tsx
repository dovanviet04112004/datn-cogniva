/**
 * /workspaces/[id]/atoms/[atomId] — atom detail page.
 *
 * Hiển thị:
 *   - Header: tên + domain + mastery chip + difficulty
 *   - Definition + examples
 *   - Preview Q/A (nếu LLM đã extract)
 *   - Mastery card: score, attempts, last review per source
 *   - All flashcards của user (workspace-scoped) — click → review
 *   - All quiz questions có atom — click → quiz
 *   - All exam questions có atom — click → exam
 *
 * Phase C (atom-centric). Spec: docs/plans/atom-centric.md §5.1 (Atom detail).
 */
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, workspace } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { getAtomView } from '@/lib/atoms/get-atom';
import { PageShell } from '@/components/layout/page-shell';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { AtomDetailClient } from '@/components/atoms/atom-detail-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string; atomId: string }>;
};

export default async function AtomDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');

  const { id: workspaceId, atomId } = await params;

  // Verify workspace thuộc user
  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) notFound();

  const atom = await getAtomView(atomId, session.user.id);
  if (!atom) notFound();

  return (
    <PageShell>
      <Breadcrumbs
        segments={[
          { href: '/workspaces', label: 'Workspaces' },
          { href: `/workspaces/${workspaceId}`, label: ws.name },
          {
            href: `/workspaces/${workspaceId}?tab=practice`,
            label: 'Practice',
          },
          { label: atom.name },
        ]}
      />

      <AtomDetailClient
        workspaceId={workspaceId}
        atom={{
          id: atom.id,
          name: atom.name,
          description: atom.description,
          domain: atom.domain,
          examples: atom.examples,
          difficulty: atom.difficulty,
          previewQuestion: atom.previewQuestion,
          previewAnswer: atom.previewAnswer,
          mastery: atom.mastery
            ? {
                score: atom.mastery.score,
                attempts: atom.mastery.attempts,
                correct: atom.mastery.correct,
                lastSeenAt: atom.mastery.lastSeenAt?.toISOString() ?? null,
                lastQuizAt: atom.mastery.lastQuizAt?.toISOString() ?? null,
                lastFlashcardAt:
                  atom.mastery.lastFlashcardAt?.toISOString() ?? null,
                lastExamAt: atom.mastery.lastExamAt?.toISOString() ?? null,
              }
            : null,
          counts: atom.counts,
        }}
      />
    </PageShell>
  );
}
