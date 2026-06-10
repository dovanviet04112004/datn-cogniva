/**
 * POST   /api/groups/[id]/members/[userId]/mute — mute member tới timestamp.
 * DELETE /api/groups/[id]/members/[userId]/mute — unmute ngay lập tức.
 *
 * MOD+ mới được mute. Target phải thấp role hơn mình. KHÔNG mute được OWNER.
 *
 * Body POST: { durationSec: number } — mute trong N giây (max 7 ngày).
 *   `mutedUntil = now + durationSec`.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { can, isHigherRole, type GroupRole } from '@/lib/group/permissions';
import { writeAudit } from '@/lib/observability/audit';

export const runtime = 'nodejs';

const MAX_MUTE_SEC = 60 * 60 * 24 * 7; // 7 ngày
const SCHEMA = z.object({
  durationSec: z.number().int().min(30).max(MAX_MUTE_SEC),
});

async function getMembership(groupId: string, userId: string) {
  const [m] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  return m ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: groupId, userId: targetUserId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'member.mute')) {
    return NextResponse.json({ error: 'Không có quyền mute' }, { status: 403 });
  }
  if (me.userId === targetUserId) {
    return NextResponse.json({ error: 'Không thể mute chính mình' }, { status: 400 });
  }

  const target = await getMembership(groupId, targetUserId);
  if (!target) return NextResponse.json({ error: 'Member không tồn tại' }, { status: 404 });
  if (target.role === 'OWNER') {
    return NextResponse.json({ error: 'Không thể mute OWNER' }, { status: 403 });
  }
  if (!isHigherRole(me.role as GroupRole, target.role as GroupRole)) {
    return NextResponse.json({ error: 'Chỉ mute được role thấp hơn' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const mutedUntil = new Date(Date.now() + parsed.data.durationSec * 1000);

  await db
    .update(studyGroupMember)
    .set({ mutedUntil })
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, targetUserId)),
    );

  // mutedUntil hiển thị trong groupMembers/groupDetail cache → bust.
  await onGroupChanged(groupId);

  void writeAudit({
    action: 'study_group.member.muted',
    result: 'success',
    actorId: session.user.id,
    actorType: 'user',
    resourceType: 'study_group',
    resourceId: groupId,
    metadata: { targetUserId, durationSec: parsed.data.durationSec, until: mutedUntil },
  });

  return NextResponse.json({ mutedUntil });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: groupId, userId: targetUserId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'member.mute')) {
    return NextResponse.json({ error: 'Không có quyền unmute' }, { status: 403 });
  }

  await db
    .update(studyGroupMember)
    .set({ mutedUntil: null })
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, targetUserId)),
    );

  await onGroupChanged(groupId);
  return NextResponse.json({ unmuted: true });
}
