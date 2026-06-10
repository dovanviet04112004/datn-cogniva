/**
 * GET /api/groups/[id]/search?q=...&limit=20
 *
 * V2 G6.1 (2026-05-21) — Postgres FTS với GIN index trên `search_vec`
 * (migration 0037). Support filter chip Discord-style:
 *   - from:userId           → filter author
 *   - in:channelId          → filter channel
 *   - has:image|file|audio|video → filter attachments
 *   - before:YYYY-MM-DD     → filter createdAt <
 *   - after:YYYY-MM-DD      → filter createdAt >
 *   - mentions:userId       → message @mention user này
 *
 * Parser ở `@/lib/group/search-query.ts` — share client + server.
 *
 * Constraints:
 *   - Phải là member group
 *   - text (sau khi parse) >= 2 ký tự HOẶC có >= 1 filter active
 *   - Skip deleted message
 *
 * Trả: { results: [{...}], sort: 'rank' | 'recent', total }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';

// Route handler chỉ có GET read thuần (FTS) → dùng `dbReplica` để offload
// heavy search query khỏi primary writer.
import {
  dbReplica,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { parseSearch, toTsQuery } from '@/lib/group/search-query';

export const runtime = 'nodejs';

const MAX_LIMIT = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [member] = await dbReplica
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), MAX_LIMIT);

  const parsed = parseSearch(q);
  const hasFilters = Object.keys(parsed.filters).length > 0;

  if (parsed.text.trim().length < 2 && !hasFilters) {
    return NextResponse.json({
      results: [],
      error: 'Cần ≥ 2 ký tự hoặc 1 filter',
      sort: 'rank',
    });
  }

  // ── Build WHERE clauses ────────────────────────────────────────────────
  const whereParts = [
    eq(studyGroupChannel.groupId, groupId),
    isNull(studyGroupMessage.deletedAt),
  ];

  // Text query → FTS qua search_vec @@ to_tsquery
  let useFts = false;
  let tsq = '';
  if (parsed.text.trim().length >= 2) {
    tsq = toTsQuery(parsed.text);
    if (tsq) {
      useFts = true;
      whereParts.push(
        sql`search_vec @@ to_tsquery('simple', ${tsq})`,
      );
    }
  }

  // from:userId
  if (parsed.filters.from) {
    whereParts.push(eq(studyGroupMessage.authorId, parsed.filters.from));
  }
  // in:channelId
  if (parsed.filters.in) {
    whereParts.push(eq(studyGroupMessage.channelId, parsed.filters.in));
  }
  // has:image|file|audio|video — jsonb array contains object with that type
  if (parsed.filters.has) {
    whereParts.push(
      sql`${studyGroupMessage.attachments} @> ${JSON.stringify([{ type: parsed.filters.has }])}::jsonb`,
    );
  }
  // before / after: ISO date string
  if (parsed.filters.before) {
    const d = new Date(parsed.filters.before);
    if (!Number.isNaN(d.getTime())) {
      whereParts.push(lt(studyGroupMessage.createdAt, d));
    }
  }
  if (parsed.filters.after) {
    const d = new Date(parsed.filters.after);
    if (!Number.isNaN(d.getTime())) {
      whereParts.push(gt(studyGroupMessage.createdAt, d));
    }
  }
  // mentions:userId — jsonb mentions array contains {type:'user', id:X}
  if (parsed.filters.mentions) {
    whereParts.push(
      sql`${studyGroupMessage.mentions} @> ${JSON.stringify([{ type: 'user', id: parsed.filters.mentions }])}::jsonb`,
    );
  }

  // ── Sort: FTS rank nếu có text query, else recent ─────────────────────
  const orderBy = useFts
    ? [
        desc(sql`ts_rank(search_vec, to_tsquery('simple', ${tsq}))`),
        desc(studyGroupMessage.createdAt),
      ]
    : [desc(studyGroupMessage.createdAt)];

  const rows = await dbReplica
    .select({
      id: studyGroupMessage.id,
      channelId: studyGroupMessage.channelId,
      channelName: studyGroupChannel.name,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      content: studyGroupMessage.content,
      attachments: studyGroupMessage.attachments,
      createdAt: studyGroupMessage.createdAt,
    })
    .from(studyGroupMessage)
    .innerJoin(studyGroupChannel, eq(studyGroupChannel.id, studyGroupMessage.channelId))
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(and(...whereParts))
    .orderBy(...orderBy)
    .limit(limit);

  // Build snippet — extract đoạn quanh match
  const lowerText = parsed.text.trim().toLowerCase();
  const results = rows.map((r) => {
    let snippet = r.content;
    if (lowerText && r.content.length > 160) {
      const firstWord = lowerText.split(' ')[0] ?? lowerText;
      const idx = r.content.toLowerCase().indexOf(firstWord);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(r.content.length, idx + 80);
        snippet =
          (start > 0 ? '…' : '') +
          r.content.slice(start, end) +
          (end < r.content.length ? '…' : '');
      } else {
        snippet = r.content.slice(0, 160) + '…';
      }
    } else if (r.content.length > 200) {
      snippet = r.content.slice(0, 200) + '…';
    }
    return { ...r, snippet };
  });

  return NextResponse.json({
    results,
    sort: useFts ? 'rank' : 'recent',
    filters: parsed.filters,
    textQuery: parsed.text,
  });
}
