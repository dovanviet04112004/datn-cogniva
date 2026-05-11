/**
 * POST /api/groups/join — join group bằng invite code.
 *
 * Body: { code: string }
 * Trả: { group } nếu join thành công, 404 nếu code invalid, 409 nếu đã là member.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroup, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  code: z.string().min(4).max(20),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();

  const [group] = await db
    .select()
    .from(studyGroup)
    .where(eq(studyGroup.inviteCode, code))
    .limit(1);
  if (!group) return NextResponse.json({ error: 'Invite code không hợp lệ' }, { status: 404 });

  // Kiểm tra đã là member chưa
  const [existing] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, group.id),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: 'Bạn đã trong group' }, { status: 409 });
  }

  await db.insert(studyGroupMember).values({
    groupId: group.id,
    userId: session.user.id,
    role: 'MEMBER',
  });

  return NextResponse.json({ group });
}
