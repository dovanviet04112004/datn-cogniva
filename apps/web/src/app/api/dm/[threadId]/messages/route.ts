/**
 * GET  /api/dm/[threadId]/messages?before=&limit=50 — cursor pagination
 * POST /api/dm/[threadId]/messages — body { content, attachments?, replyToId? }
 *
 * Auth: user phải là 1 trong 2 thành viên thread (user1 hoặc user2).
 * Realtime: trigger realtime `private-dm-{threadId}` event `message:new`.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, dmMessage, dmThread, notificationLog, user as userTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { isThreadMember } from '@/lib/group/dm';
import { createNotification } from '@/lib/notifications/notify';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const LIST_LIMIT_MAX = 100;

const ATTACHMENT = z.object({
  type: z.enum(['image', 'file', 'audio', 'video']),
  url: z.string().min(1),
  name: z.string().max(200),
  size: z.number().int().min(0).max(50 * 1024 * 1024),
  mime: z.string().max(100),
});

const POST_SCHEMA = z
  .object({
    content: z.string().max(4000).optional().default(''),
    replyToId: z.string().optional(),
    attachments: z.array(ATTACHMENT).max(10).optional(),
  })
  .refine(
    (d) => (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );

async function loadThread(threadId: string, uid: string) {
  const [t] = await db.select().from(dmThread).where(eq(dmThread.id, threadId)).limit(1);
  if (!t) return null;
  if (!isThreadMember(t, uid)) return null;
  return t;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const t = await loadThread(threadId, session.user.id);
  if (!t) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const beforeId = url.searchParams.get('before');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), LIST_LIMIT_MAX);

  let beforeDate: Date | null = null;
  if (beforeId) {
    const [c] = await db
      .select({ createdAt: dmMessage.createdAt })
      .from(dmMessage)
      .where(eq(dmMessage.id, beforeId))
      .limit(1);
    if (c) beforeDate = c.createdAt;
  }

  const rows = await db
    .select({
      id: dmMessage.id,
      threadId: dmMessage.threadId,
      authorId: dmMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      content: dmMessage.content,
      replyToId: dmMessage.replyToId,
      attachments: dmMessage.attachments,
      reactions: dmMessage.reactions,
      editedAt: dmMessage.editedAt,
      deletedAt: dmMessage.deletedAt,
      createdAt: dmMessage.createdAt,
    })
    .from(dmMessage)
    .innerJoin(userTable, eq(userTable.id, dmMessage.authorId))
    .where(
      beforeDate
        ? and(eq(dmMessage.threadId, threadId), lt(dmMessage.createdAt, beforeDate))
        : eq(dmMessage.threadId, threadId),
    )
    .orderBy(desc(dmMessage.createdAt))
    .limit(limit);

  return NextResponse.json({ messages: rows.reverse(), hasMore: rows.length === limit });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const t = await loadThread(threadId, session.user.id);
  if (!t) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [created] = await db
    .insert(dmMessage)
    .values({
      threadId,
      authorId: session.user.id,
      content: parsed.data.content ?? '',
      replyToId: parsed.data.replyToId ?? null,
      attachments: parsed.data.attachments && parsed.data.attachments.length > 0
        ? parsed.data.attachments
        : null,
    })
    .returning();
  if (!created) {
    return NextResponse.json({ error: 'Tạo message thất bại' }, { status: 500 });
  }

  // Update lastMessageAt
  await db
    .update(dmThread)
    .set({ lastMessageAt: created.createdAt })
    .where(eq(dmThread.id, threadId));

  const payload = {
    id: created.id,
    threadId: created.threadId,
    authorId: created.authorId,
    authorName: session.user.name,
    authorImage: session.user.image,
    content: created.content,
    replyToId: created.replyToId,
    attachments: created.attachments,
    reactions: created.reactions,
    editedAt: created.editedAt,
    deletedAt: created.deletedAt,
    createdAt: created.createdAt,
  };
  void triggerEvent(`private-dm-${threadId}`, 'message:new', payload);
  // Notify peer (presence-user-{peerId}) để badge sidebar
  const peerId = t.user1Id === session.user.id ? t.user2Id : t.user1Id;
  void triggerEvent(`presence-user-${peerId}`, 'dm:new-message', {
    threadId,
    authorId: session.user.id,
    authorName: session.user.name,
    preview: created.content.slice(0, 100),
  });

  // Thông báo vào chuông cho peer — GỘP 1 dòng/thread (xoá unread cũ cùng
  // thread rồi insert mới) để chuông không spam mỗi tin nhắn. Non-blocking.
  const preview = created.content.slice(0, 80) || '📎 Đã gửi tệp';
  void (async () => {
    try {
      await db
        .delete(notificationLog)
        .where(
          and(
            eq(notificationLog.userId, peerId),
            eq(notificationLog.type, 'dm-message'),
            isNull(notificationLog.readAt),
            sql`${notificationLog.data}->>'threadId' = ${threadId}`,
          ),
        );
      await createNotification({
        userId: peerId,
        type: 'dm-message',
        title: `Tin nhắn từ ${session.user.name ?? 'người dùng'}`,
        body: preview,
        data: {
          threadId,
          author: {
            id: session.user.id,
            name: session.user.name ?? null,
            image: session.user.image ?? null,
          },
        },
      });
    } catch (e) {
      console.error('[dm notify]', e);
    }
  })();

  return NextResponse.json({ message: payload }, { status: 201 });
}
