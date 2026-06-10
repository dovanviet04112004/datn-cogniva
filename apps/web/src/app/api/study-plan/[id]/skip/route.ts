/**
 * POST /api/study-plan/[id]/skip — user "swap" 1 proposal sang alternative.
 *
 * Flow:
 *   1. Verify item thuộc user + kind != manual + status = PENDING
 *   2. Mark item SKIPPED + completedAt = now
 *   3. (Optional) generate 1 atom thay thế cùng kind, dueDate = today
 *      → cho phép user "đổi 1 cái khác" thay vì xoá hẳn
 *
 * Phase B MVP: chỉ mark SKIPPED, KHÔNG generate replacement (giữ logic
 * đơn giản; user có thể reload page để tự thấy alternative qua
 * materializeProposalForToday → nhưng materialize check existing nên sẽ
 * không gen lại — defer feature này Phase B+).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';

import { db, studyPlanItem } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onStudyPlanChanged } from '@/lib/cache/invalidate';
import { studyPlanDayKey } from '@/lib/study-plan/materialize';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [item] = await db
    .select()
    .from(studyPlanItem)
    .where(
      and(
        eq(studyPlanItem.id, id),
        eq(studyPlanItem.userId, session.user.id),
        ne(studyPlanItem.kind, 'manual'), // chỉ AI proposal mới skip được
      ),
    )
    .limit(1);

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Item đã ${item.status}, không skip được` },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(studyPlanItem)
    .set({
      status: 'SKIPPED',
      completedAt: new Date(),
    })
    .where(eq(studyPlanItem.id, id))
    .returning();

  await onStudyPlanChanged(session.user.id, studyPlanDayKey());
  return NextResponse.json({ item: updated });
}
