/**
 * GET  /api/channels/[id]/messages/[msgId]/thread — list reply trong thread
 * POST /api/channels/[id]/messages/[msgId]/thread — reply vào thread
 *
 * GET trả: { root: msg, replies: [], hasMore: false }
 * POST body: { content, attachments? } → tăng thread_count + thread_last_at trên root.
 *
 * Realtime: broadcast `thread:new-reply` qua channel-{channelId} để UI update
 * thread count + tới mọi client subscribe.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, isMuted, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

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
    attachments: z.array(ATTACHMENT).max(10).optional(),
  })
  .refine(
    (d) => (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );

/** Verify quyền + load context. */
async function loadCtx(channelId: string, msgId: string, uid: string) {
  const [ch] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return null;
  const [member] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, ch.groupId), eq(studyGroupMember.userId, uid)),
    )
    .limit(1);
  if (!member) return null;
  const [root] = await db
    .select()
    .from(studyGroupMessage)
    .where(and(eq(studyGroupMessage.id, msgId), eq(studyGroupMessage.channelId, channelId)))
    .limit(1);
  if (!root) return null;
  return { channel: ch, member, root };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadCtx(channelId, msgId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Replies: nơi thread_root_id = msgId
  const replies = await db
    .select({
      id: studyGroupMessage.id,
      channelId: studyGroupMessage.channelId,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      content: studyGroupMessage.content,
      contentType: studyGroupMessage.contentType,
      replyToId: studyGroupMessage.replyToId,
      attachments: studyGroupMessage.attachments,
      reactions: studyGroupMessage.reactions,
      mentions: studyGroupMessage.mentions,
      pinned: studyGroupMessage.pinned,
      editedAt: studyGroupMessage.editedAt,
      deletedAt: studyGroupMessage.deletedAt,
      createdAt: studyGroupMessage.createdAt,
      threadRootId: studyGroupMessage.threadRootId,
      threadCount: studyGroupMessage.threadCount,
      threadLastAt: studyGroupMessage.threadLastAt,
      isSolution: studyGroupMessage.isSolution,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(eq(studyGroupMessage.threadRootId, msgId))
    .orderBy(asc(studyGroupMessage.createdAt));

  // Load root with author info
  const [rootRow] = await db
    .select({
      id: studyGroupMessage.id,
      channelId: studyGroupMessage.channelId,
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      content: studyGroupMessage.content,
      contentType: studyGroupMessage.contentType,
      replyToId: studyGroupMessage.replyToId,
      attachments: studyGroupMessage.attachments,
      reactions: studyGroupMessage.reactions,
      mentions: studyGroupMessage.mentions,
      pinned: studyGroupMessage.pinned,
      editedAt: studyGroupMessage.editedAt,
      deletedAt: studyGroupMessage.deletedAt,
      createdAt: studyGroupMessage.createdAt,
      threadRootId: studyGroupMessage.threadRootId,
      threadCount: studyGroupMessage.threadCount,
      threadLastAt: studyGroupMessage.threadLastAt,
      isSolution: studyGroupMessage.isSolution,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(eq(studyGroupMessage.id, msgId))
    .limit(1);

  return NextResponse.json({ root: rootRow, replies });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadCtx(channelId, msgId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { channel, member, root } = ctx;

  // Không reply vào thread của message đã xoá hoặc reply chính trong thread
  if (root.deletedAt) {
    return NextResponse.json({ error: 'Message gốc đã bị xoá' }, { status: 400 });
  }
  if (root.threadRootId) {
    return NextResponse.json(
      { error: 'Không thể tạo thread từ reply (chỉ message root)' },
      { status: 400 },
    );
  }
  if (!can(member.role as GroupRole, 'message.send')) {
    return NextResponse.json({ error: 'Không có quyền gửi' }, { status: 403 });
  }
  if (isMuted(member)) {
    return NextResponse.json({ error: 'Bạn đang bị mute' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Insert reply + update root.thread_count atomically
  const result = await db.transaction(async (tx) => {
    const [reply] = await tx
      .insert(studyGroupMessage)
      .values({
        channelId,
        authorId: session.user.id,
        content: parsed.data.content ?? '',
        threadRootId: msgId,
        attachments: parsed.data.attachments && parsed.data.attachments.length > 0
          ? parsed.data.attachments
          : null,
      })
      .returning();
    if (!reply) throw new Error('insert failed');

    await tx
      .update(studyGroupMessage)
      .set({
        threadCount: sql`${studyGroupMessage.threadCount} + 1`,
        threadLastAt: reply.createdAt,
        // V2 G6.3: reply mới vào archived thread → auto-unarchive
        archivedAt: null,
      })
      .where(eq(studyGroupMessage.id, msgId));

    return reply;
  });

  const payload = {
    id: result.id,
    threadRootId: msgId,
    channelId: result.channelId,
    authorId: result.authorId,
    authorName: session.user.name,
    authorImage: session.user.image,
    content: result.content,
    attachments: result.attachments,
    createdAt: result.createdAt,
  };
  // Broadcast: cả channel để update thread count badge, và channel để render reply
  // trong panel mở thread
  void triggerEvent(`private-channel-${channelId}`, 'thread:new-reply', payload);

  // Hint reuse: channel.name dùng cho audit/log nếu cần
  void channel;

  return NextResponse.json({ reply: payload }, { status: 201 });
}
