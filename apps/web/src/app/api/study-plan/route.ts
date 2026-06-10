/**
 * /api/study-plan — list (GET) + create (POST).
 *
 * GET ?status=PENDING|DONE  → list theo trạng thái, order due_date NULLS LAST.
 * POST body { title, description?, conceptId?, dueDate? } → tạo item.
 *
 * Scope user qua study_plan_item.user_id.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db, studyPlanItem } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onStudyPlanChanged } from '@/lib/cache/invalidate';
import { getStudyPlanItems } from '@/lib/study-plan/query';
import { studyPlanDayKey } from '@/lib/study-plan/materialize';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const items = await getStudyPlanItems(session.user.id, {
    status: url.searchParams.get('status'),
    kind: url.searchParams.get('kind'),
  });

  return NextResponse.json({ items });
}

const CREATE_SCHEMA = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  conceptId: z.string().optional(),
  /** ISO datetime — frontend convert từ <input type="date">. */
  dueDate: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [inserted] = await db
    .insert(studyPlanItem)
    .values({
      userId: session.user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      conceptId: parsed.data.conceptId ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    })
    .returning();

  await onStudyPlanChanged(session.user.id, studyPlanDayKey());
  return NextResponse.json({ item: inserted }, { status: 201 });
}
