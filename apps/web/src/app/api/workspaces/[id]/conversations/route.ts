/**
 * GET /api/workspaces/[id]/conversations — list conversations của workspace.
 *
 * V6 (2026-05-20): workspace giờ hỗ trợ nhiều cuộc hội thoại (giống
 * NotebookLM notebook). ChatView render switcher dropdown để user chuyển
 * giữa các conv hoặc tạo mới.
 *
 * Order: lastMessageAt DESC (gần nhất trên) — conversation chưa có
 * message dùng createdAt thay thế.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { conversation, db, message, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: workspaceId } = await params;

  // Verify ownership
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastMessageAt: sql<Date | null>`(
        SELECT MAX(${message.createdAt})
        FROM ${message}
        WHERE ${message.conversationId} = ${conversation.id}
      )`,
      messageCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${message}
        WHERE ${message.conversationId} = ${conversation.id}
      )`,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, session.user.id),
        eq(conversation.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(conversation.createdAt))
    .limit(50);

  const conversations = rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    messageCount: r.messageCount,
  }));

  return NextResponse.json({ conversations });
}
