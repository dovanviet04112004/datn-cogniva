/**
 * GET /api/admin/groups/[id] — chi tiết group + members + stats.
 *
 * Response:
 *   group: full row + owner info
 *   members: list (max 200) sắp xếp OWNER → ADMIN → MOD → MEMBER, mỗi member
 *            kèm joinedAt + user.email/name
 *   stats: { memberCount, channelCount, messageCount }
 *
 * Action endpoint riêng: /suspend, /unsuspend.
 */
import { NextResponse } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';

import { db, studyGroup, studyGroupMember, user } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: studyGroup.id,
      name: studyGroup.name,
      description: studyGroup.description,
      iconUrl: studyGroup.iconUrl,
      bannerUrl: studyGroup.bannerUrl,
      isPublic: studyGroup.isPublic,
      maxMembers: studyGroup.maxMembers,
      inviteCode: studyGroup.inviteCode,
      suspendedAt: studyGroup.suspendedAt,
      suspendReason: studyGroup.suspendReason,
      createdAt: studyGroup.createdAt,
      ownerId: studyGroup.ownerUserId,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(studyGroup)
    .leftJoin(user, eq(user.id, studyGroup.ownerUserId))
    .where(eq(studyGroup.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  // Member list sort theo role priority (OWNER first) — Postgres CASE.
  const members = await db
    .select({
      id: studyGroupMember.id,
      userId: studyGroupMember.userId,
      role: studyGroupMember.role,
      nickname: studyGroupMember.nickname,
      joinedAt: studyGroupMember.joinedAt,
      mutedUntil: studyGroupMember.mutedUntil,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(studyGroupMember)
    .leftJoin(user, eq(user.id, studyGroupMember.userId))
    .where(eq(studyGroupMember.groupId, id))
    .orderBy(
      sql`CASE ${studyGroupMember.role}
            WHEN 'OWNER' THEN 0
            WHEN 'ADMIN' THEN 1
            WHEN 'MODERATOR' THEN 2
            WHEN 'MEMBER' THEN 3
          END`,
      asc(studyGroupMember.joinedAt),
    )
    .limit(200);

  // Stats: dùng raw SQL vì group_channel + group_message bảng riêng
  const [statsRow] = await db.execute<{
    member_count: number;
    channel_count: number;
    message_count: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM "study_group_member" WHERE group_id = ${id}) AS member_count,
      (SELECT COUNT(*)::int FROM "study_group_channel" WHERE group_id = ${id}) AS channel_count,
      (SELECT COUNT(*)::int FROM "study_group_message" gm
         JOIN "study_group_channel" gc ON gc.id = gm.channel_id
         WHERE gc.group_id = ${id}) AS message_count
  `);

  return NextResponse.json({
    group: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
    },
    members: members.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      mutedUntil: m.mutedUntil?.toISOString() ?? null,
    })),
    stats: {
      memberCount: Number(statsRow?.member_count ?? 0),
      channelCount: Number(statsRow?.channel_count ?? 0),
      messageCount: Number(statsRow?.message_count ?? 0),
    },
  });
}
