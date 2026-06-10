/**
 * /api/groups/[id]/members/[userId] — GET detail + PUT update + DELETE kick/leave.
 *
 * GET — V2 G7.2: trả detail member cho ProfileHoverCard (avatar+role+status).
 *
 * PUT body { role?, nickname? }:
 *   - role change: ADMIN+ only, không nâng/giáng role OWNER, không tự promote lên cao hơn mình
 *   - nickname change: MOD+ change member khác, self change tự do
 * DELETE:
 *   - Self (userId === me.id) → leave group. OWNER không leave được (phải DELETE group hoặc transfer).
 *   - Other (ADMIN+) → kick
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroup, studyGroupMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged, onGroupMembershipChanged } from '@/lib/cache/invalidate';
import { can, isHigherRole, type GroupRole } from '@/lib/group/permissions';
import { writeAudit } from '@/lib/observability/audit';

export const runtime = 'nodejs';

const UPDATE_SCHEMA = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']).optional(),
  nickname: z.string().max(40).nullable().optional(),
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

/**
 * GET — V2 G7.2 (2026-05-21): trả detail 1 member cho ProfileHoverCard.
 * Requester chỉ cần là member cùng group.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: groupId, userId: targetUserId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [detail] = await db
    .select({
      userId: studyGroupMember.userId,
      name: user.name,
      image: user.image,
      role: studyGroupMember.role,
      nickname: studyGroupMember.nickname,
      joinedAt: studyGroupMember.joinedAt,
      status: user.status,
      statusText: user.statusText,
      statusEmoji: user.statusEmoji,
      statusExpiresAt: user.statusExpiresAt,
    })
    .from(studyGroupMember)
    .innerJoin(user, eq(user.id, studyGroupMember.userId))
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!detail) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: groupId, userId: targetUserId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const target = await getMembership(groupId, targetUserId);
  if (!target) return NextResponse.json({ error: 'Member không tồn tại' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const isSelf = me.userId === targetUserId;
  const updates: Partial<{ role: GroupRole; nickname: string | null }> = {};

  // Role change
  if (parsed.data.role !== undefined) {
    if (isSelf) {
      return NextResponse.json({ error: 'Không thể tự đổi role' }, { status: 400 });
    }
    if (!can(me.role as GroupRole, 'member.change-role')) {
      return NextResponse.json({ error: 'Không có quyền đổi role' }, { status: 403 });
    }
    // Owner role chỉ owner mới gán (transfer ownership)
    if (parsed.data.role === 'OWNER' && me.role !== 'OWNER') {
      return NextResponse.json({ error: 'Chỉ OWNER mới chuyển quyền sở hữu' }, { status: 403 });
    }
    // Không đụng role OWNER hiện tại nếu mình không phải OWNER
    if (target.role === 'OWNER' && me.role !== 'OWNER') {
      return NextResponse.json({ error: 'Không thể đổi role OWNER' }, { status: 403 });
    }
    // ADMIN không gán role >= mình (tránh self-elevation tương đương)
    if (me.role === 'ADMIN' && !isHigherRole('ADMIN', parsed.data.role)) {
      return NextResponse.json(
        { error: 'ADMIN chỉ gán role thấp hơn mình' },
        { status: 403 },
      );
    }
    updates.role = parsed.data.role;
  }

  // Nickname change
  if (parsed.data.nickname !== undefined) {
    if (!isSelf && !can(me.role as GroupRole, 'member.change-nickname')) {
      return NextResponse.json({ error: 'Không có quyền đổi nickname' }, { status: 403 });
    }
    updates.nickname = parsed.data.nickname;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Không có gì để update' }, { status: 400 });
  }

  const [updated] = await db
    .update(studyGroupMember)
    .set(updates)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, targetUserId)),
    )
    .returning();

  // Role/nickname member đổi → groupDetail + groupMembers (cả 2 chứa role+nickname)
  // phải tươi lại cho mọi member.
  await onGroupChanged(groupId);

  // Audit log nếu là mod action (role change). Nickname change skip để giảm noise.
  if (updates.role) {
    void writeAudit({
      action: 'study_group.member.role-changed',
      result: 'success',
      actorId: session.user.id,
      actorType: 'user',
      resourceType: 'study_group',
      resourceId: groupId,
      metadata: {
        targetUserId,
        oldRole: target.role,
        newRole: updates.role,
      },
    });
  }

  return NextResponse.json({ member: updated });
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

  const isSelf = me.userId === targetUserId;

  if (isSelf) {
    // Leave — OWNER không leave được
    if (me.role === 'OWNER') {
      return NextResponse.json(
        { error: 'OWNER phải transfer ownership hoặc xoá group trước khi leave' },
        { status: 400 },
      );
    }
  } else {
    // Kick — cần quyền + target role thấp hơn mình
    if (!can(me.role as GroupRole, 'member.kick')) {
      return NextResponse.json({ error: 'Không có quyền kick' }, { status: 403 });
    }
    const target = await getMembership(groupId, targetUserId);
    if (!target) return NextResponse.json({ error: 'Member không tồn tại' }, { status: 404 });
    if (!isHigherRole(me.role as GroupRole, target.role as GroupRole)) {
      return NextResponse.json(
        { error: 'Chỉ kick được member role thấp hơn' },
        { status: 403 },
      );
    }
    // OWNER không bị kick
    if (target.role === 'OWNER') {
      return NextResponse.json({ error: 'Không thể kick OWNER' }, { status: 403 });
    }
    // Verify group owner check phụ
    const [grp] = await db
      .select({ ownerUserId: studyGroup.ownerUserId })
      .from(studyGroup)
      .where(eq(studyGroup.id, groupId))
      .limit(1);
    if (grp?.ownerUserId === targetUserId) {
      return NextResponse.json({ error: 'Không thể kick chủ group' }, { status: 403 });
    }
  }

  await db
    .delete(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, groupId), eq(studyGroupMember.userId, targetUserId)),
    );

  // Membership đổi (leave/kick) → groupsList của user bị xoá + groupDetail/groupMembers
  // của group. targetUserId đúng là user rời/bị kick (self-leave hoặc kick member khác).
  await onGroupMembershipChanged(targetUserId, groupId);

  // Audit log — kick action (skip self-leave)
  if (!isSelf) {
    void writeAudit({
      action: 'study_group.member.kicked',
      result: 'success',
      actorId: session.user.id,
      actorType: 'user',
      resourceType: 'study_group',
      resourceId: groupId,
      metadata: { targetUserId },
    });
  }

  return NextResponse.json({ removed: true, self: isSelf });
}
