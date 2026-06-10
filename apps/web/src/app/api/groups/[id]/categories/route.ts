/**
 * /api/groups/[id]/categories — list + create category.
 *
 * GET: list categories của group (member access).
 * POST { name }: tạo category (ADMIN+).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupCategory, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(80),
});

async function getMembership(groupId: string, userId: string) {
  const [m] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  return m ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const categories = await db
    .select()
    .from(studyGroupCategory)
    .where(eq(studyGroupCategory.groupId, groupId))
    .orderBy(asc(studyGroupCategory.position), asc(studyGroupCategory.createdAt));

  return NextResponse.json({ categories });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.create')) {
    return NextResponse.json({ error: 'Không có quyền tạo category' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db
    .select({ pos: studyGroupCategory.position })
    .from(studyGroupCategory)
    .where(eq(studyGroupCategory.groupId, groupId))
    .orderBy(asc(studyGroupCategory.position));
  const last = existing[existing.length - 1];
  const nextPos = last ? last.pos + 1 : 0;

  const [created] = await db
    .insert(studyGroupCategory)
    .values({ groupId, name: parsed.data.name, position: nextPos })
    .returning();

  return NextResponse.json({ category: created }, { status: 201 });
}
