/**
 * GET /api/chat/conversations — liệt kê hội thoại của user.
 *
 * Trả mảng theo thứ tự mới nhất trước, kèm số message để UI hiện badge.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { count, desc, eq } from 'drizzle-orm';

import { conversation, db, message } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const messageCount = db
    .select({ conversationId: message.conversationId, n: count(message.id).as('n') })
    .from(message)
    .groupBy(message.conversationId)
    .as('message_count');

  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      messages: messageCount.n,
    })
    .from(conversation)
    .leftJoin(messageCount, eq(conversation.id, messageCount.conversationId))
    .where(eq(conversation.userId, session.user.id))
    .orderBy(desc(conversation.createdAt))
    .limit(50);

  return NextResponse.json({ conversations: rows });
}
