import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, exam, examAttempt } from '@cogniva/db';
import { getServerSession } from '@/lib/auth-server';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ExamRedirectPage({ params }: Props) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/exams/${id}`)}`);
  }

  const [row] = await db
    .select({
      id: exam.id,
      ownerId: exam.ownerId,
      workspaceId: exam.workspaceId,
      status: exam.status,
      mode: exam.mode,
    })
    .from(exam)
    .where(eq(exam.id, id))
    .limit(1);

  if (!row) redirect('/workspaces');

  const isOwner = row.ownerId === session.user.id;

  if (isOwner) {
    if (row.workspaceId) {
      redirect(`/workspaces/${row.workspaceId}?examPreview=${row.id}`);
    }
    redirect('/workspaces');
  }

  if (row.status !== 'PUBLISHED') {
    redirect('/workspaces');
  }

  if (row.workspaceId) {
    redirect(`/workspaces/${row.workspaceId}?examPreview=${row.id}`);
  }

  const [existing] = await db
    .select({ id: examAttempt.id })
    .from(examAttempt)
    .where(
      and(
        eq(examAttempt.examId, row.id),
        eq(examAttempt.userId, session.user.id),
        eq(examAttempt.status, 'IN_PROGRESS'),
      ),
    )
    .limit(1);
  if (existing) {
    redirect(`/exams/${row.id}/take/${existing.id}`);
  }
  redirect('/workspaces');
}
