/**
 * /api/groups/[id]/channels/[channelId] — update + delete channel.
 *
 * PUT  : update name/topic/position/slowModeSeconds (ADMIN+)
 * DELETE: xoá channel (ADMIN+) — cascade messages + voice_state + read_state
 *
 * Constraint: KHÔNG cho phép xoá channel cuối cùng của group (luôn còn ít nhất 1).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onGroupChanged } from '@/lib/cache/invalidate';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const UPDATE_SCHEMA = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\p{L}0-9\-_]+$/u)
    .optional(),
  topic: z.string().max(200).nullable().optional(),
  position: z.number().int().min(0).optional(),
  slowModeSeconds: z.number().int().min(0).max(21600).nullable().optional(),
  voiceMaxParticipants: z.number().int().min(1).max(100).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  // V3 Forum: tag list mod set cho channel
  availableTags: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        color: z.string().max(20).optional(),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  const { id: groupId, channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.update')) {
    return NextResponse.json({ error: 'Không có quyền sửa channel' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(studyGroupChannel)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.topic !== undefined && { topic: parsed.data.topic }),
      ...(parsed.data.position !== undefined && { position: parsed.data.position }),
      ...(parsed.data.slowModeSeconds !== undefined && {
        slowModeSeconds: parsed.data.slowModeSeconds,
      }),
      ...(parsed.data.voiceMaxParticipants !== undefined && {
        voiceMaxParticipants: parsed.data.voiceMaxParticipants,
      }),
      ...(parsed.data.categoryId !== undefined && { categoryId: parsed.data.categoryId }),
      ...(parsed.data.availableTags !== undefined && { availableTags: parsed.data.availableTags }),
    })
    .where(and(eq(studyGroupChannel.id, channelId), eq(studyGroupChannel.groupId, groupId)))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  // Channel đổi (name/topic/position/...) → bust groupDetail (chứa channels list).
  await onGroupChanged(groupId);

  return NextResponse.json({ channel: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  const { id: groupId, channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const me = await getMembership(groupId, session.user.id);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'channel.delete')) {
    return NextResponse.json({ error: 'Không có quyền xoá channel' }, { status: 403 });
  }

  // Đảm bảo group còn ít nhất 1 channel sau khi xoá
  const countRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.groupId, groupId));
  const count = countRow[0]?.count ?? 0;
  if (count <= 1) {
    return NextResponse.json(
      { error: 'Group phải có ít nhất 1 channel — tạo channel khác trước' },
      { status: 400 },
    );
  }

  const result = await db
    .delete(studyGroupChannel)
    .where(and(eq(studyGroupChannel.id, channelId), eq(studyGroupChannel.groupId, groupId)))
    .returning({ id: studyGroupChannel.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });
  }

  // Channel bị xoá → bust groupDetail (channels list đổi).
  await onGroupChanged(groupId);

  return NextResponse.json({ deleted: true });
}
