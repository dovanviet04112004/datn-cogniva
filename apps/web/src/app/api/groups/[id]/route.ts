/**
 * /api/groups/[id] — chi tiết group + members + channels + delete + update.
 *
 * GET   : trả group + members + channels (sorted by position) + myRole.
 *         Chỉ member mới được xem.
 * PUT   : update name/description/iconUrl/bannerUrl/maxMembers (ADMIN+)
 * DELETE: xoá group, cascade members/channels/messages. OWNER only.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  dbReplica,
  studyGroup,
  studyGroupChannel,
  studyGroupMember,
  user,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onGroupChanged, onGroupMembershipChanged } from '@/lib/cache/invalidate';
import { can, type GroupRole } from '@/lib/group/permissions';

export const runtime = 'nodejs';

const UPDATE_SCHEMA = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  maxMembers: z.number().int().min(2).max(10_000).optional(),
  /** Channel TEXT nhận log recording (V3). NULL = auto fallback. */
  recordingLogChannelId: z.string().nullable().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Access-check (guard) NGOÀI cache ──────────────────────────────────────
  // membership là per-user, KHÔNG được nằm trong cache chung group → kiểm trước,
  // chỉ cache phần nội dung (group + members + channels) dùng chung mọi member.
  const [mine] = await dbReplica
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!mine) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // ── Phần CACHE được (TTL 120s): group meta + members + channels — chung mọi
  // member. Bust khi: đổi meta/channel (onGroupChanged) hoặc join/leave
  // (onGroupMembershipChanged). dbReplica vì read thuần. createdAt/joinedAt giữ
  // string: consumer chỉ NextResponse.json → không cần re-hydrate Date.
  const detail = await cached(ck.groupDetail(id), 120, async () => {
    const [group] = await dbReplica
      .select()
      .from(studyGroup)
      .where(eq(studyGroup.id, id))
      .limit(1);
    if (!group) return null;

    const [members, channels] = await Promise.all([
      dbReplica
        .select({
          userId: studyGroupMember.userId,
          name: user.name,
          image: user.image,
          role: studyGroupMember.role,
          nickname: studyGroupMember.nickname,
          mutedUntil: studyGroupMember.mutedUntil,
          joinedAt: studyGroupMember.joinedAt,
        })
        .from(studyGroupMember)
        .innerJoin(user, eq(user.id, studyGroupMember.userId))
        .where(eq(studyGroupMember.groupId, id))
        .orderBy(asc(studyGroupMember.joinedAt)),
      dbReplica
        .select()
        .from(studyGroupChannel)
        .where(eq(studyGroupChannel.groupId, id))
        .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt)),
    ]);

    return { group, members, channels };
  });

  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // myRole lấy từ guard (per-user) — không cache chung, gắn lại vào response.
  return NextResponse.json({ ...detail, myRole: mine.role });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [me] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, id), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (!can(me.role as GroupRole, 'group.update-meta')) {
    return NextResponse.json({ error: 'Không có quyền sửa group' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = UPDATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify recordingLogChannelId thuộc cùng group + là TEXT (chống IDOR)
  if (parsed.data.recordingLogChannelId) {
    const [ch] = await db
      .select({ id: studyGroupChannel.id, type: studyGroupChannel.type })
      .from(studyGroupChannel)
      .where(
        and(
          eq(studyGroupChannel.id, parsed.data.recordingLogChannelId),
          eq(studyGroupChannel.groupId, id),
        ),
      )
      .limit(1);
    if (!ch) {
      return NextResponse.json(
        { error: 'Channel log không thuộc group này' },
        { status: 400 },
      );
    }
    if (ch.type !== 'TEXT' && ch.type !== 'ANNOUNCEMENT') {
      return NextResponse.json(
        { error: 'Channel log phải là TEXT hoặc ANNOUNCEMENT' },
        { status: 400 },
      );
    }
  }

  const [updated] = await db
    .update(studyGroup)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.iconUrl !== undefined && { iconUrl: parsed.data.iconUrl }),
      ...(parsed.data.bannerUrl !== undefined && { bannerUrl: parsed.data.bannerUrl }),
      ...(parsed.data.maxMembers !== undefined && { maxMembers: parsed.data.maxMembers }),
      ...(parsed.data.recordingLogChannelId !== undefined && {
        recordingLogChannelId: parsed.data.recordingLogChannelId,
      }),
    })
    .where(eq(studyGroup.id, id))
    .returning();

  // Meta group đổi (name/icon/banner/...) → bust groupDetail + groupMembers chung member.
  await onGroupChanged(id);

  return NextResponse.json({ group: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await db
    .delete(studyGroup)
    .where(and(eq(studyGroup.id, id), eq(studyGroup.ownerUserId, session.user.id)))
    .returning({ id: studyGroup.id });
  if (result.length === 0) {
    return NextResponse.json({ error: 'Not owner or not found' }, { status: 403 });
  }

  // Group bị xoá: bust groupDetail/groupMembers (onGroupChanged) + groupsList của
  // OWNER (session.user.id chính là owner do WHERE ownerUserId ở trên).
  // Lưu ý: list của các member KHÁC không bust được ở đây (invalidator chỉ nhận 1
  // userId) — dựa vào TTL 60s của groupsList để tự hết hạn.
  await onGroupChanged(id);
  await onGroupMembershipChanged(session.user.id, id);

  return NextResponse.json({ deleted: true });
}
