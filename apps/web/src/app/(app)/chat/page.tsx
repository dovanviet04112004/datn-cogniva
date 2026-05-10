/**
 * /chat — trang list các hội thoại + nút "New chat" để bắt đầu mới.
 *
 * Server Component: fetch conversations qua Drizzle + truy vấn count message
 * subquery (giống pattern /documents).
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { MessageSquare, Plus } from 'lucide-react';

import { conversation, db, message } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/utils';

export const runtime = 'nodejs';

export default async function ChatListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/chat');

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

  return (
    <div className="container max-w-4xl space-y-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Hỏi AI tutor về tài liệu của bạn — câu trả lời có citation jump-to-source.
          </p>
        </div>
        <Button asChild>
          <Link href="/chat/new">
            <Plus className="h-4 w-4" /> New chat
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Chưa có hội thoại</CardTitle>
            <CardDescription>
              Bấm <strong>New chat</strong> để bắt đầu. Hệ thống sẽ retrieve chunks gần
              nhất với câu hỏi từ tài liệu bạn đã upload.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((conv) => (
            <Link key={conv.id} href={`/chat/${conv.id}`} className="block">
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-center gap-3 py-4">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {conv.title ?? 'Untitled conversation'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conv.messages ?? 0} messages · {formatRelativeTime(conv.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
