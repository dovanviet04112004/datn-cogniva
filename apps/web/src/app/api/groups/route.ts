/**
 * /api/groups — list groups của user + tạo group mới.
 *
 * GET: trả mảng groups user là member kèm số thành viên + iconUrl + myRole.
 * POST body { name, description? }: tạo group, auto:
 *   - Owner làm OWNER member
 *   - Tạo channel #chung TEXT default
 *   - Tạo invite code đầu tiên (cả legacy studyGroup.inviteCode + studyGroupInvite mới)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  dbReplica,
  studyGroup,
  studyGroupChannel,
  studyGroupInvite,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onGroupMembershipChanged } from '@/lib/cache/invalidate';
import { generateInviteCode } from '@/lib/group/code';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Cache-aside per-user (TTL 60s): sidebar study-groups là app-shell hot path,
  // được fetch trên mọi route group. Invalidate khi join/leave (onGroupMembershipChanged)
  // bust ck.groupsList(userId). Đọc qua dbReplica vì read thuần, không read-your-own-write.
  const rows = await cached(ck.groupsList(session.user.id), 60, () =>
    dbReplica
      .select({
        id: studyGroup.id,
        name: studyGroup.name,
        description: studyGroup.description,
        ownerUserId: studyGroup.ownerUserId,
        inviteCode: studyGroup.inviteCode,
        iconUrl: studyGroup.iconUrl,
        createdAt: studyGroup.createdAt,
        myRole: studyGroupMember.role,
        memberCount: sql<number>`(SELECT count(*)::int FROM study_group_member WHERE group_id = ${studyGroup.id})`,
      })
      .from(studyGroup)
      .innerJoin(studyGroupMember, eq(studyGroupMember.groupId, studyGroup.id))
      .where(eq(studyGroupMember.userId, session.user.id))
      .orderBy(desc(studyGroup.createdAt)),
  );

  // createdAt giữ dạng string sau cache: consumer chỉ NextResponse.json (client fetch),
  // không date-math → không cần re-hydrate Date.
  return NextResponse.json({ groups: rows });
}

const CREATE_SCHEMA = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Tạo group + auto-add owner làm OWNER member + tạo #chung TEXT channel.
  // Dùng transaction để rollback toàn bộ nếu 1 step fail.
  const legacyCode = generateInviteCode();
  const inviteCode = generateInviteCode();

  const { group, channel } = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(studyGroup)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        ownerUserId: session.user.id,
        inviteCode: legacyCode,
      })
      .returning();
    if (!g) throw new Error('insert group failed');

    await tx.insert(studyGroupMember).values({
      groupId: g.id,
      userId: session.user.id,
      role: 'OWNER',
    });

    const [c] = await tx
      .insert(studyGroupChannel)
      .values({
        groupId: g.id,
        name: 'chung',
        type: 'TEXT',
        position: 0,
        createdBy: session.user.id,
        topic: 'Chat tổng',
      })
      .returning();

    // Invite mặc định — unlimited use, không expires
    await tx.insert(studyGroupInvite).values({
      groupId: g.id,
      code: inviteCode,
      createdBy: session.user.id,
    });

    return { group: g, channel: c };
  });

  // Owner vừa được thêm làm member → bust groupsList(owner) để sidebar hiện group mới.
  // Dùng onGroupMembershipChanged (superset: cũng bust groupDetail/groupMembers,
  // dù 2 cache đó còn chưa tồn tại cho group vừa tạo) thay vì onGroupChanged.
  await onGroupMembershipChanged(session.user.id, group.id);

  return NextResponse.json({ group, defaultChannel: channel }, { status: 201 });
}
