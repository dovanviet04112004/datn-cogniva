/**
 * GET /api/groups/[id]/channels/[channelId]/permissions — list override matrix
 * PUT /api/groups/[id]/channels/[channelId]/permissions — upsert override (role hoặc user)
 * DELETE /api/groups/[id]/channels/[channelId]/permissions/[overrideId] (qua subroute)
 *
 * Spec V2 G1: docs/plans/study-group-v2.md §G1.
 *
 * Format PUT body:
 *   { roleId?: string, userId?: string, overrides: { [PermissionKey]: 'allow' | 'deny' | 'inherit' } }
 *
 * Exactly 1 trong (roleId, userId) phải set. Upsert qua (channel_id, role_id|user_id) unique.
 *
 * Permission: `manageChannels` (V2) qua effectivePermissions.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupChannelPermission,
  studyGroupMember,
  studyGroupRole,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  ALL_PERMISSION_KEYS,
  hasPermission,
  type PermissionKey,
} from '@/lib/group/effective-permissions';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string; channelId: string }> };

const OVERRIDE_VALUE = z.enum(['allow', 'deny', 'inherit']);

const PUT_SCHEMA = z
  .object({
    roleId: z.string().optional(),
    userId: z.string().optional(),
    overrides: z.record(z.string(), OVERRIDE_VALUE),
  })
  .refine((v) => (v.roleId && !v.userId) || (!v.roleId && v.userId), {
    message: 'Phải set chính xác 1 trong (roleId, userId)',
  });

async function requireManager(groupId: string, channelId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Verify channel thuộc group
  const [ch] = await db
    .select({ id: studyGroupChannel.id })
    .from(studyGroupChannel)
    .where(
      and(
        eq(studyGroupChannel.id, channelId),
        eq(studyGroupChannel.groupId, groupId),
      ),
    )
    .limit(1);
  if (!ch) {
    return {
      err: NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 }),
    };
  }

  // Verify caller member + permission
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
  if (!(await hasPermission(member.id, 'manageChannels'))) {
    return {
      err: NextResponse.json(
        { error: 'Bạn không có quyền quản lý channel' },
        { status: 403 },
      ),
    };
  }
  return { memberId: member.id };
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: groupId, channelId } = await ctx.params;
  const r = await requireManager(groupId, channelId);
  if (r.err) return r.err;

  const rows = await db
    .select({
      id: studyGroupChannelPermission.id,
      roleId: studyGroupChannelPermission.roleId,
      userId: studyGroupChannelPermission.userId,
      overrides: studyGroupChannelPermission.overrides,
    })
    .from(studyGroupChannelPermission)
    .where(eq(studyGroupChannelPermission.channelId, channelId));

  return NextResponse.json({ overrides: rows });
}

export async function PUT(request: Request, ctx: RouteContext) {
  const { id: groupId, channelId } = await ctx.params;
  const r = await requireManager(groupId, channelId);
  if (r.err) return r.err;

  const body = await request.json().catch(() => null);
  const parsed = PUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate keys
  for (const key of Object.keys(parsed.data.overrides)) {
    if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) {
      return NextResponse.json(
        { error: `Permission key không hợp lệ: ${key}` },
        { status: 400 },
      );
    }
  }

  // Verify role thuộc group nếu set
  if (parsed.data.roleId) {
    const [role] = await db
      .select({ id: studyGroupRole.id })
      .from(studyGroupRole)
      .where(
        and(
          eq(studyGroupRole.id, parsed.data.roleId),
          eq(studyGroupRole.groupId, groupId),
        ),
      )
      .limit(1);
    if (!role) {
      return NextResponse.json(
        { error: 'Role không thuộc group' },
        { status: 400 },
      );
    }
  }

  // Upsert: nếu đã có (channel, target) → update, else insert
  const existing = parsed.data.roleId
    ? await db
        .select({ id: studyGroupChannelPermission.id })
        .from(studyGroupChannelPermission)
        .where(
          and(
            eq(studyGroupChannelPermission.channelId, channelId),
            eq(studyGroupChannelPermission.roleId, parsed.data.roleId),
          ),
        )
        .limit(1)
    : await db
        .select({ id: studyGroupChannelPermission.id })
        .from(studyGroupChannelPermission)
        .where(
          and(
            eq(studyGroupChannelPermission.channelId, channelId),
            eq(studyGroupChannelPermission.userId, parsed.data.userId!),
          ),
        )
        .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(studyGroupChannelPermission)
      .set({ overrides: parsed.data.overrides })
      .where(eq(studyGroupChannelPermission.id, existing[0].id))
      .returning();
    return NextResponse.json({ override: updated });
  }

  const [inserted] = await db
    .insert(studyGroupChannelPermission)
    .values({
      channelId,
      roleId: parsed.data.roleId ?? null,
      userId: parsed.data.userId ?? null,
      overrides: parsed.data.overrides,
    })
    .returning();
  return NextResponse.json({ override: inserted }, { status: 201 });
}
