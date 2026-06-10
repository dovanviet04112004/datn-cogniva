/**
 * PUT /api/groups/[id]/members/[userId]/roles — bulk set roles cho 1 member.
 *
 * Spec V2 G1: docs/plans/study-group-v2.md §G1.
 *
 * Body: { roleIds: string[] }
 *
 * Behavior:
 *   - Replace ALL roles của member (transactional delete + insert)
 *   - Verify role belongs to group (anti-cross-group spoof)
 *   - Permission: `manageRoles`
 *   - Backward-compat: cập nhật `studyGroupMember.role` enum theo legacy_role
 *     của role có position cao nhất trong list (để code cũ vẫn đọc đúng).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupMember,
  studyGroupMemberRole,
  studyGroupRole,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { hasPermission } from '@/lib/group/effective-permissions';
import type { GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; userId: string }> };

const BODY = z.object({
  roleIds: z.array(z.string().min(1)).max(20),
});

export async function PUT(request: Request, ctx: RouteContext) {
  const { id: groupId, userId: targetUserId } = await ctx.params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify caller membership + permission
  const [caller] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await hasPermission(caller.id, 'manageRoles'))) {
    return NextResponse.json(
      { error: 'Bạn không có quyền quản lý role' },
      { status: 403 },
    );
  }

  // Verify target member
  const [target] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!target) {
    return NextResponse.json(
      { error: 'Member không tồn tại trong group' },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify roles thuộc group
  const validRoles =
    parsed.data.roleIds.length > 0
      ? await db
          .select({
            id: studyGroupRole.id,
            position: studyGroupRole.position,
            legacyRole: studyGroupRole.legacyRole,
          })
          .from(studyGroupRole)
          .where(
            and(
              eq(studyGroupRole.groupId, groupId),
              inArray(studyGroupRole.id, parsed.data.roleIds),
            ),
          )
      : [];

  if (validRoles.length !== parsed.data.roleIds.length) {
    return NextResponse.json(
      { error: 'Có role không thuộc group' },
      { status: 400 },
    );
  }

  // Đảm bảo member luôn có ít nhất 1 role (Discord pattern — @everyone implicit)
  if (validRoles.length === 0) {
    return NextResponse.json(
      { error: 'Phải gán ít nhất 1 role cho member' },
      { status: 400 },
    );
  }

  // Compute legacy role để backward-compat (highest position trong list)
  const highestRole = [...validRoles].sort((a, b) => b.position - a.position)[0];
  const legacyRoleEnum: GroupRole =
    (highestRole?.legacyRole as GroupRole) ?? 'MEMBER';

  // Transaction: delete all + insert new + update legacy enum
  await db.transaction(async (tx) => {
    await tx
      .delete(studyGroupMemberRole)
      .where(eq(studyGroupMemberRole.memberId, target.id));

    if (validRoles.length > 0) {
      await tx.insert(studyGroupMemberRole).values(
        validRoles.map((r) => ({
          memberId: target.id,
          roleId: r.id,
        })),
      );
    }

    await tx
      .update(studyGroupMember)
      .set({ role: legacyRoleEnum })
      .where(eq(studyGroupMember.id, target.id));
  });

  // Role member đổi → groupMembers + groupDetail cache (đều chứa role) cũ.
  await onGroupChanged(groupId);
  return NextResponse.json({ ok: true, legacyRole: legacyRoleEnum });
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: groupId, userId: targetUserId } = await ctx.params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify caller member
  const [caller] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [target] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select({
      id: studyGroupRole.id,
      name: studyGroupRole.name,
      color: studyGroupRole.color,
      position: studyGroupRole.position,
    })
    .from(studyGroupMemberRole)
    .innerJoin(
      studyGroupRole,
      eq(studyGroupRole.id, studyGroupMemberRole.roleId),
    )
    .where(eq(studyGroupMemberRole.memberId, target.id))
    .orderBy(desc(studyGroupRole.position));

  return NextResponse.json({ roles: rows });
}
