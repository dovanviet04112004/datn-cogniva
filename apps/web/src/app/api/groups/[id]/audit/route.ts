/**
 * GET /api/groups/[id]/audit — list mod actions audit log của group.
 *
 * ADMIN+ mới đọc được. Query audit_log với:
 *   - action LIKE 'study_group.%'
 *   - resource_id = groupId (cho action gắn vào group)
 *   - hoặc resource_id IN (channels/messages của group) — V3
 *
 * V2: chỉ filter theo resource_id = groupId là đủ cho member.role-changed,
 * member.kicked, member.muted. Channel/message deletion sẽ filter qua
 * metadata.channelId hoặc cần join (V3 wire).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';

import { auditLog, db, studyGroupMember, user as userTable } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const MAX_LIMIT = 100;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [me] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  if (me.role !== 'OWNER' && me.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Chỉ ADMIN+ xem audit log' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), MAX_LIMIT);

  // Lấy mọi audit có action prefix 'study_group.' VÀ
  //   - resource_id = groupId (member/channel/group actions)
  //   - HOẶC metadata->>groupId = groupId (cho message actions có groupId trong metadata)
  const rows = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      actorName: userTable.name,
      actorImage: userTable.image,
      action: auditLog.action,
      result: auditLog.result,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      timestamp: auditLog.timestamp,
    })
    .from(auditLog)
    .leftJoin(userTable, eq(userTable.id, auditLog.actorId))
    .where(
      and(
        like(auditLog.action, 'study_group.%'),
        or(
          eq(auditLog.resourceId, groupId),
          sql`${auditLog.metadata}->>'groupId' = ${groupId}`,
        ),
      ),
    )
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);

  return NextResponse.json({ entries: rows });
}
