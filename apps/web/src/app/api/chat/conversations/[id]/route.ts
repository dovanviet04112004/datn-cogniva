/**
 * GET /api/chat/conversations/[id] — load 1 hội thoại + toàn bộ message
 * theo thứ tự cũ → mới (để hydrate useChat ở client).
 *
 * Verify ownership: trả 404 nếu conversation không thuộc user (chống IDOR).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';

import { conversation, db, message } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const messages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  return NextResponse.json({ conversation: conv, messages });
}
