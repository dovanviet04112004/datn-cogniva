/**
 * GET /api/channels/[id]/threads — V2 G6.3 (2026-05-21).
 *
 * List active threads trong channel — root message có thread_count > 0,
 * sort by thread_last_at DESC. Pagination cursor `before` theo thread_last_at.
 *
 * Discord pattern: panel "Threads" trong channel header → user thấy nhanh
 * những thread đang sôi nổi mà không phải scroll qua main message stream.
 *
 * Query:
 *   - limit  : 1-50 (default 20)
 *   - before : ISO date cursor
 *   - includeArchived : '1' → bao gồm thread đã archived (V2 G6.3)
 *
 * Response:
 *   { threads: [...], hasMore }
 *
 * Thread item: { id, content (preview), title, authorId, authorName,
 *   authorImage, threadCount, threadLastAt, createdAt }
 *
 * Spec: docs/plans/study-group-v2.md §G6.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const LIMIT_MAX = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), LIMIT_MAX);
  const before = url.searchParams.get('before');
  const includeArchived = url.searchParams.get('includeArchived') === '1';

  const conditions = [
    eq(studyGroupMessage.channelId, channelId),
    isNull(studyGroupMessage.threadRootId),
    isNull(studyGroupMessage.deletedAt),
    gt(studyGroupMessage.threadCount, 0),
  ];
  if (!includeArchived) {
    conditions.push(isNull(studyGroupMessage.archivedAt));
  }
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(lt(studyGroupMessage.threadLastAt, d));
    }
  }

  const rows = await db
    .select({
      id: studyGroupMessage.id,
      title: studyGroupMessage.title,
      content: studyGroupMessage.content,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      threadCount: studyGroupMessage.threadCount,
      threadLastAt: studyGroupMessage.threadLastAt,
      createdAt: studyGroupMessage.createdAt,
      archivedAt: studyGroupMessage.archivedAt,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(and(...conditions))
    .orderBy(
      desc(sql`COALESCE(${studyGroupMessage.threadLastAt}, ${studyGroupMessage.createdAt})`),
    )
    .limit(limit);

  return NextResponse.json({
    threads: rows.map((r) => ({
      ...r,
      content: r.content.length > 140 ? r.content.slice(0, 140) + '…' : r.content,
    })),
    hasMore: rows.length === limit,
  });
}
