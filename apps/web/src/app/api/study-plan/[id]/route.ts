/**
 * /api/study-plan/[id] — toggle status (PATCH) + delete (DELETE).
 *
 * PATCH body: { status: 'PENDING' | 'DONE' }
 *   Khi DONE → set completed_at = now; khi PENDING → completed_at = null.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyPlanItem } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onStudyPlanChanged } from '@/lib/cache/invalidate';
import { studyPlanDayKey } from '@/lib/study-plan/materialize';

export const runtime = 'nodejs';

const PATCH_SCHEMA = z.object({
  status: z.enum(['PENDING', 'DONE']).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(studyPlanItem)
    .where(and(eq(studyPlanItem.id, id), eq(studyPlanItem.userId, session.user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Partial<typeof studyPlanItem.$inferInsert> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description;
  }
  if (parsed.data.dueDate !== undefined) {
    updates.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    updates.completedAt = parsed.data.status === 'DONE' ? new Date() : null;
  }

  const [updated] = await db
    .update(studyPlanItem)
    .set(updates)
    .where(eq(studyPlanItem.id, id))
    .returning();

  await onStudyPlanChanged(session.user.id, studyPlanDayKey());
  return NextResponse.json({ item: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await db
    .delete(studyPlanItem)
    .where(and(eq(studyPlanItem.id, id), eq(studyPlanItem.userId, session.user.id)))
    .returning({ id: studyPlanItem.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await onStudyPlanChanged(session.user.id, studyPlanDayKey());
  return NextResponse.json({ deleted: true });
}
