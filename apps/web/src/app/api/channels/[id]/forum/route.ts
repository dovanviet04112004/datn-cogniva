/**
 * GET /api/channels/[id]/forum — list forum posts (root messages, không phải reply).
 *
 * Sort: theo query param `sort`, default 'latest':
 *   - 'latest'  : COALESCE(thread_last_at, created_at) DESC  (default)
 *   - 'newest'  : created_at DESC
 *   - 'replies' : thread_count DESC, created_at DESC
 *
 * Pinned posts luôn ưu tiên lên đầu bất kể sort.
 *
 * Query params:
 *   - limit  : 1-50 (default 20)
 *   - before : threadLastAt cursor (ISO string) — chỉ áp dụng sort='latest'
 *   - tag    : filter posts có tag này
 *   - sort   : 'latest' | 'newest' | 'replies' (default 'latest')
 *
 * Response:
 *   { posts: [...], hasMore: bool, availableTags: [...] }
 *
 * Post format:
 *   { id, title, content (preview 200 chars), authorId, authorName,
 *     authorImage, tags, replyCount, lastActivityAt, createdAt, pinned,
 *     hasSolution (V2 G5.4) }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';

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
const SORT_OPTIONS = ['latest', 'newest', 'replies'] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;

  const [ch] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  if (ch.type !== 'FORUM') {
    return NextResponse.json({ error: 'Channel không phải FORUM' }, { status: 400 });
  }

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
  const tag = url.searchParams.get('tag');
  const sortParam = (url.searchParams.get('sort') ?? 'latest') as SortOption;
  const sort: SortOption = SORT_OPTIONS.includes(sortParam) ? sortParam : 'latest';

  // Build where clauses
  const conditions = [
    eq(studyGroupMessage.channelId, channelId),
    isNull(studyGroupMessage.threadRootId),
    isNull(studyGroupMessage.deletedAt),
  ];
  if (before && sort === 'latest') {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      // Cursor chỉ hỗ trợ sort='latest' để giữ pagination đơn giản & ổn định.
      conditions.push(
        lt(
          sql`COALESCE(${studyGroupMessage.threadLastAt}, ${studyGroupMessage.createdAt})`,
          beforeDate,
        ),
      );
    }
  }
  if (tag) {
    // jsonb contains operator
    conditions.push(sql`${studyGroupMessage.tags} @> ${JSON.stringify([tag.toLowerCase()])}`);
  }

  // V2 G5.4: subquery check thread có solution không (any reply is_solution=true)
  const hasSolutionSql = sql<boolean>`EXISTS (
    SELECT 1 FROM study_group_message sol
    WHERE sol.thread_root_id = ${studyGroupMessage.id}
      AND sol.is_solution = true
  )`;

  // Sort order — pinned luôn ưu tiên đầu, sau đó áp dụng sort option
  const orderBy = (() => {
    const head = desc(studyGroupMessage.pinned);
    if (sort === 'newest') return [head, desc(studyGroupMessage.createdAt)];
    if (sort === 'replies')
      return [head, desc(studyGroupMessage.threadCount), desc(studyGroupMessage.createdAt)];
    return [
      head,
      desc(sql`COALESCE(${studyGroupMessage.threadLastAt}, ${studyGroupMessage.createdAt})`),
    ];
  })();

  const rows = await db
    .select({
      id: studyGroupMessage.id,
      title: studyGroupMessage.title,
      content: studyGroupMessage.content,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      tags: studyGroupMessage.tags,
      replyCount: studyGroupMessage.threadCount,
      lastActivityAt: studyGroupMessage.threadLastAt,
      createdAt: studyGroupMessage.createdAt,
      pinned: studyGroupMessage.pinned,
      hasSolution: hasSolutionSql,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit);

  return NextResponse.json({
    posts: rows.map((r) => ({
      ...r,
      // Preview content (200 chars)
      content: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
    })),
    hasMore: rows.length === limit,
    availableTags: ch.availableTags ?? [],
    sort,
  });
}
