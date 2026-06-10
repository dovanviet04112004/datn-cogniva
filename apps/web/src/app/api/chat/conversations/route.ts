/**
 * GET /api/chat/conversations — liệt kê hội thoại của user.
 *
 * Trả mảng theo thứ tự mới nhất trước, kèm số message để UI hiện badge.
 *
 * Cache-aside: list + messageCount là read thuần đọc-nhiều, mỗi lần mở sidebar
 * chat đều gọi → đáng cache 60s. Key per-user `ck.conversationsList(userId)`;
 * invalidate: onConversationsChanged (tạo conversation mới / có message mới).
 * Dùng `dbReplica` vì read thuần, KHÔNG read-your-own-write cùng request.
 * Date field `createdAt` serialize→string qua cache nhưng chỉ đi tiếp vào
 * NextResponse.json (không date-math phía server) nên giữ string, không re-hydrate.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { count, desc, eq } from 'drizzle-orm';

import { conversation, dbReplica, message } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const conversations = await cached(ck.conversationsList(userId), 60, async () => {
    // Subquery đếm message theo conversation để hiện badge ở sidebar.
    const messageCount = dbReplica
      .select({ conversationId: message.conversationId, n: count(message.id).as('n') })
      .from(message)
      .groupBy(message.conversationId)
      .as('message_count');

    return dbReplica
      .select({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        messages: messageCount.n,
      })
      .from(conversation)
      .leftJoin(messageCount, eq(conversation.id, messageCount.conversationId))
      .where(eq(conversation.userId, userId))
      .orderBy(desc(conversation.createdAt))
      .limit(50);
  });

  return NextResponse.json({ conversations });
}
