/**
 * GET /api/conversations — list conversations của user, filter optional theo
 * workspaceId. Dùng cho:
 *   - Workspace > Chat tab: `?workspaceId=X` để show conversations của workspace
 *   - Future: global history (không pass param) cho /chat sidebar refresh
 *
 * Trả mảng conversations + last_message_at (join max) cho sort UX.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { conversation, db, message } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceParam = url.searchParams.get('workspaceId');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 200);

  const conditions = [eq(conversation.userId, session.user.id)];
  if (workspaceParam === 'null') {
    conditions.push(isNull(conversation.workspaceId));
  } else if (workspaceParam) {
    conditions.push(eq(conversation.workspaceId, workspaceParam));
  }

  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      workspaceId: conversation.workspaceId,
      createdAt: conversation.createdAt,
      lastMessageAt: sql<Date | null>`(
        SELECT max(${message.createdAt})
        FROM ${message}
        WHERE ${message.conversationId} = ${conversation.id}
      )`,
    })
    .from(conversation)
    .where(and(...conditions))
    .orderBy(desc(conversation.createdAt))
    .limit(limit);

  return NextResponse.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      workspaceId: r.workspaceId,
      createdAt: r.createdAt.toISOString(),
      lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    })),
  });
}
