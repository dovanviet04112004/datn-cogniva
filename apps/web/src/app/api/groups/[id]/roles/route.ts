/**
 * GET  /api/groups/[id]/roles — list role + member count per role
 * POST /api/groups/[id]/roles — tạo custom role (yêu cầu `manageRoles`)
 *
 * Spec V2 G1: docs/plans/study-group-v2.md §G1.
 *
 * - GET trả mọi role của group sort theo position DESC (cao trước).
 *   Mỗi row có `memberCount` để UI hiện "X members".
 * - POST: validate name unique trong group, default color #9aa3af, position
 *   tự increment max+1, permissions JSON từ body (validate keys).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupMember,
  studyGroupMemberRole,
  studyGroupRole,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  ALL_PERMISSION_KEYS,
  hasPermission,
  type PermissionKey,
  type PermissionMap,
} from '@/lib/group/effective-permissions';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/** Z schema cho permissions object — chỉ accept key trong ALL_PERMISSION_KEYS. */
function isValidPermissionMap(input: unknown): input is PermissionMap {
  if (typeof input !== 'object' || input === null) return false;
  for (const key of Object.keys(input)) {
    if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) return false;
    const v = (input as Record<string, unknown>)[key];
    if (typeof v !== 'boolean') return false;
  }
  return true;
}

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#9aa3af'),
  permissions: z.record(z.string(), z.boolean()).default({}),
  hoisted: z.boolean().default(false),
  mentionable: z.boolean().default(false),
});

/** Verify session + member, return memberId. 401/403 → throw NextResponse. */
async function requireMember(groupId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return {
      err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
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
    return {
      err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return { session, memberId: member.id };
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: groupId } = await ctx.params;
  const r = await requireMember(groupId);
  if (r.err) return r.err;

  // Subquery count member per role
  const memberCounts = db
    .select({
      roleId: studyGroupMemberRole.roleId,
      n: count().as('n'),
    })
    .from(studyGroupMemberRole)
    .groupBy(studyGroupMemberRole.roleId)
    .as('mc');

  const rows = await db
    .select({
      id: studyGroupRole.id,
      name: studyGroupRole.name,
      color: studyGroupRole.color,
      position: studyGroupRole.position,
      permissions: studyGroupRole.permissions,
      hoisted: studyGroupRole.hoisted,
      mentionable: studyGroupRole.mentionable,
      isManaged: studyGroupRole.isManaged,
      legacyRole: studyGroupRole.legacyRole,
      memberCount: sql<number>`coalesce(${memberCounts.n}, 0)::int`,
    })
    .from(studyGroupRole)
    .leftJoin(memberCounts, eq(memberCounts.roleId, studyGroupRole.id))
    .where(eq(studyGroupRole.groupId, groupId))
    .orderBy(desc(studyGroupRole.position));

  return NextResponse.json({ roles: rows });
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: groupId } = await ctx.params;
  const r = await requireMember(groupId);
  if (r.err) return r.err;

  if (!(await hasPermission(r.memberId, 'manageRoles'))) {
    return NextResponse.json(
      { error: 'Bạn không có quyền quản lý role' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!isValidPermissionMap(parsed.data.permissions)) {
    return NextResponse.json(
      { error: 'permissions chứa key không hợp lệ' },
      { status: 400 },
    );
  }

  // Position = max(position) + 1, capped < 100 (OWNER reserved)
  const [maxRow] = await db
    .select({ p: sql<number>`coalesce(max(${studyGroupRole.position}), 0)::int` })
    .from(studyGroupRole)
    .where(eq(studyGroupRole.groupId, groupId));
  const nextPos = Math.min((maxRow?.p ?? 0) + 1, 95);

  try {
    const [inserted] = await db
      .insert(studyGroupRole)
      .values({
        groupId,
        name: parsed.data.name,
        color: parsed.data.color,
        position: nextPos,
        permissions: parsed.data.permissions,
        hoisted: parsed.data.hoisted,
        mentionable: parsed.data.mentionable,
        isManaged: false,
        legacyRole: null,
      })
      .returning();

    return NextResponse.json({ role: inserted }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    if (msg.includes('study_group_role_group_name_uniq')) {
      return NextResponse.json(
        { error: 'Đã có role cùng tên trong group' },
        { status: 409 },
      );
    }
    throw err;
  }
}
