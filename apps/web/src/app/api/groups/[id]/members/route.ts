/**
 * GET /api/groups/[id]/members — list members + role + nickname + online status.
 *
 * Online status: V1 chỉ trả lastSeenAt (UI parse < 5 min = online).
 * Realtime: presence overlay giờ chạy qua Socket.IO presence channel (apps/realtime).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';

import { db, dbReplica, studyGroupMember, user } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Access-check (guard) NGOÀI cache — myRole là per-user, không cache chung ──
  const [mine] = await dbReplica
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!mine) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // ── Member list (TTL 60s) — chung mọi member, bust khi join/leave
  // (onGroupMembershipChanged) hoặc đổi role/nickname (onGroupChanged). dbReplica
  // vì read thuần. mutedUntil/lastSeenAt/joinedAt/statusExpiresAt giữ string:
  // consumer chỉ NextResponse.json → không date-math, không cần re-hydrate Date.
  const members = await cached(ck.groupMembers(groupId), 60, () =>
    dbReplica
      .select({
        userId: studyGroupMember.userId,
        name: user.name,
        image: user.image,
        role: studyGroupMember.role,
        nickname: studyGroupMember.nickname,
        mutedUntil: studyGroupMember.mutedUntil,
        lastSeenAt: studyGroupMember.lastSeenAt,
        joinedAt: studyGroupMember.joinedAt,
        // V2 G3: user status fields cho member-sidebar dot color
        status: user.status,
        statusText: user.statusText,
        statusEmoji: user.statusEmoji,
        statusExpiresAt: user.statusExpiresAt,
      })
      .from(studyGroupMember)
      .innerJoin(user, eq(user.id, studyGroupMember.userId))
      .where(eq(studyGroupMember.groupId, groupId))
      .orderBy(asc(studyGroupMember.joinedAt)),
  );

  return NextResponse.json({ members, myRole: mine.role });
}
