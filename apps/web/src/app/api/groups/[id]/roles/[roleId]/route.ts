/**
 * PUT    /api/groups/[id]/roles/[roleId] — update role (color, name, permissions, hoisted)
 * DELETE /api/groups/[id]/roles/[roleId] — xoá role (cascade member_role)
 *
 * Restrictions:
 *   - Role managed (is_managed=true) — không xoá, không sửa legacy_role.
 *     Vẫn cho phép sửa color, hoisted, mentionable, permissions (admin tuỳ
 *     biến permissions trong default role).
 *   - DELETE role thì members có role đó tự rớt qua cascade (vẫn còn role
 *     khác — `MEMBER` default).
 *
 * Permission: `manageRoles` (V2) hoặc legacy ADMIN+ qua effectivePermissions.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupMember, studyGroupRole } from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  ALL_PERMISSION_KEYS,
  hasPermission,
  type PermissionKey,
} from '@/lib/group/effective-permissions';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; roleId: string }> };

const UPDATE_SCHEMA = z
  .object({
    name: z.string().min(1).max(50).trim().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    hoisted: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.number().int().min(0).max(95).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Body rỗng' });

async function requireManager(groupId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) {
    return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  if (!(await hasPermission(member.id, 'manageRoles'))) {
    return {
      err: NextResponse.json(
        { error: 'Bạn không có quyền quản lý role' },
        { status: 403 },
      ),
    };
  }
  return { memberId: member.id };
}

export async function PUT(request: Request, ctx: RouteContext) {
  const { id: groupId, roleId } = await ctx.params;
  const r = await requireManager(groupId);
  if (r.err) return r.err;

  // Verify role thuộc group
  const [row] = await db
    .select({
      id: studyGroupRole.id,
      isManaged: studyGroupRole.isManaged,
      legacyRole: studyGroupRole.legacyRole,
    })
    .from(studyGroupRole)
    .where(and(eq(studyGroupRole.id, roleId), eq(studyGroupRole.groupId, groupId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Role không tồn tại' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Managed role: không cho đổi name (vì legacy_role link by name "Chủ nhóm",…)
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    if (row.isManaged) {
      return NextResponse.json(
        { error: 'Không đổi được tên role mặc định' },
        { status: 400 },
      );
    }
    updates.name = parsed.data.name;
  }
  if (parsed.data.color !== undefined) updates.color = parsed.data.color;
  if (parsed.data.hoisted !== undefined) updates.hoisted = parsed.data.hoisted;
  if (parsed.data.mentionable !== undefined)
    updates.mentionable = parsed.data.mentionable;
  if (parsed.data.position !== undefined) {
    // OWNER position luôn 100 (managed) — không cho đổi
    if (row.legacyRole === 'OWNER') {
      return NextResponse.json(
        { error: 'Không đổi được position của OWNER' },
        { status: 400 },
      );
    }
    updates.position = parsed.data.position;
  }
  if (parsed.data.permissions !== undefined) {
    for (const key of Object.keys(parsed.data.permissions)) {
      if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) {
        return NextResponse.json(
          { error: `permission key không hợp lệ: ${key}` },
          { status: 400 },
        );
      }
    }
    updates.permissions = parsed.data.permissions;
  }

  try {
    const [updated] = await db
      .update(studyGroupRole)
      .set(updates)
      .where(eq(studyGroupRole.id, roleId))
      .returning();
    return NextResponse.json({ role: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    if (msg.includes('study_group_role_group_name_uniq')) {
      return NextResponse.json({ error: 'Tên role đã tồn tại' }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: groupId, roleId } = await ctx.params;
  const r = await requireManager(groupId);
  if (r.err) return r.err;

  const [row] = await db
    .select({ isManaged: studyGroupRole.isManaged })
    .from(studyGroupRole)
    .where(and(eq(studyGroupRole.id, roleId), eq(studyGroupRole.groupId, groupId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Role không tồn tại' }, { status: 404 });
  }
  if (row.isManaged) {
    return NextResponse.json(
      { error: 'Không xoá được role mặc định (OWNER/ADMIN/MODERATOR/MEMBER)' },
      { status: 400 },
    );
  }

  await db.delete(studyGroupRole).where(eq(studyGroupRole.id, roleId));
  return NextResponse.json({ ok: true });
}
