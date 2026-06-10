/**
 * POST /api/groups/join — join group bằng invite code.
 *
 * Body: { code: string }
 * Resolution order:
 *   1. Tìm trong study_group_invite (new multi-invite table)
 *      → check uses_count < max_uses + expires_at chưa hết hạn
 *      → INCREMENT uses_count
 *   2. Fallback: legacy study_group.inviteCode (backward compat)
 *
 * Lỗi:
 *   - 400 body invalid
 *   - 401 chưa login
 *   - 404 code không tồn tại
 *   - 409 đã là member
 *   - 410 invite đã hết hạn / hết lượt
 *   - 423 group đã đạt maxMembers
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroup,
  studyGroupInvite,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupMembershipChanged } from '@/lib/cache/invalidate';
import { normalizeInviteCode } from '@/lib/group/code';
import { createNotification } from '@/lib/notifications/notify';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  code: z.string().min(4).max(32),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const code = normalizeInviteCode(parsed.data.code);

  // Resolve code: prefer new invite table → fallback legacy inviteCode
  const [invite] = await db
    .select()
    .from(studyGroupInvite)
    .where(eq(studyGroupInvite.code, code))
    .limit(1);

  let groupId: string | null = null;
  let inviteId: string | null = null;

  if (invite) {
    // Check expiry + usage limits
    const now = new Date();
    if (invite.expiresAt && invite.expiresAt < now) {
      return NextResponse.json({ error: 'Invite đã hết hạn' }, { status: 410 });
    }
    if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) {
      return NextResponse.json({ error: 'Invite hết lượt sử dụng' }, { status: 410 });
    }
    groupId = invite.groupId;
    inviteId = invite.id;
  } else {
    // Legacy fallback — query study_group.inviteCode
    const [legacy] = await db
      .select({ id: studyGroup.id })
      .from(studyGroup)
      .where(eq(studyGroup.inviteCode, code))
      .limit(1);
    if (!legacy) {
      return NextResponse.json({ error: 'Invite code không hợp lệ' }, { status: 404 });
    }
    groupId = legacy.id;
  }

  // Load group để check maxMembers
  const [group] = await db
    .select()
    .from(studyGroup)
    .where(eq(studyGroup.id, groupId))
    .limit(1);
  if (!group) return NextResponse.json({ error: 'Group không tồn tại' }, { status: 404 });

  // Đã là member?
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
    return NextResponse.json({ group, alreadyMember: true }, { status: 200 });
  }

  // Check maxMembers
  const countRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(studyGroupMember)
    .where(eq(studyGroupMember.groupId, group.id));
  const count = countRow[0]?.count ?? 0;
  if (count >= group.maxMembers) {
    return NextResponse.json({ error: 'Group đã đầy thành viên' }, { status: 423 });
  }

  // Insert member + (nếu invite mới) INCR uses_count — chạy trong txn
  await db.transaction(async (tx) => {
    await tx.insert(studyGroupMember).values({
      groupId: group.id,
      userId: session.user.id,
      role: 'MEMBER',
    });
    if (inviteId) {
      await tx
        .update(studyGroupInvite)
        .set({ usesCount: sql`${studyGroupInvite.usesCount} + 1` })
        .where(eq(studyGroupInvite.id, inviteId));
    }
  });

  // User vừa join → bust groupsList của họ (sidebar hiện group mới) + groupDetail/
  // groupMembers (member list +1) qua onGroupMembershipChanged.
  await onGroupMembershipChanged(session.user.id, group.id);

  // Thông báo cho chủ nhóm: có thành viên mới (realtime, non-blocking).
  if (group.ownerUserId !== session.user.id) {
    void createNotification({
      userId: group.ownerUserId,
      type: 'group-join',
      title: 'Thành viên mới',
      body: `${session.user.name ?? 'Ai đó'} đã tham gia nhóm ${group.name}.`,
      data: { groupId: group.id },
    }).catch((e) => console.error('[group.join notify]', e));
  }

  return NextResponse.json({ group });
}
