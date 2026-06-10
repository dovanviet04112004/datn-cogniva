/**
 * /api/channels/[id]/messages — list + post message trong text channel.
 *
 * GET ?before=msgId&limit=50 — cursor pagination (lấy message older hơn `before`)
 *   - Mặc định trả 50 msg mới nhất nếu không có `before`
 *   - Sort DESC theo createdAt, client reverse khi render
 *
 * POST { content, replyToId?, mentions? } — gửi message
 *   - Check: member group + channel.type = TEXT (hoặc ANNOUNCEMENT + ADMIN)
 *   - Check: không bị mute (mutedUntil)
 *   - Slow mode: check khoảng cách giữa 2 msg cuối của user
 *   - Broadcast: trigger realtime `private-channel-{id}` event `message:new`
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroup,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, isMuted, type GroupRole } from '@/lib/group/permissions';
import { fireMentionEvents, parseMentions } from '@/lib/group/mention-notify';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const LIST_LIMIT_MAX = 100;

const ATTACHMENT_SCHEMA = z.object({
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
    attachments: z.array(ATTACHMENT_SCHEMA).max(10).optional(),
    mentions: z
      .array(
        z.object({
          type: z.enum(['user', 'channel', 'everyone']),
          id: z.string(),
        }),
      )
      .max(20)
      .optional(),
    // ── V3 Forum fields (chỉ áp dụng khi channel.type=FORUM, root post) ──
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(40)).max(5).optional(),
  })
  // Empty content OK nếu có attachment
  .refine(
    (d) => (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0),
    { message: 'Cần content hoặc attachment', path: ['content'] },
  );

/** Load channel + verify membership. Trả về { channel, member } hoặc null nếu fail. */
async function loadContext(channelId: string, userId: string) {
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
      and(eq(studyGroupMember.groupId, ch.groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  if (!member) return null;
  // Phase 2 admin moderation — load group để biết group có bị suspend chưa.
  // Member vẫn read được (xem suspension notice + lịch sử), nhưng POST sẽ chặn.
  const [grp] = await db
    .select({ id: studyGroup.id, suspendedAt: studyGroup.suspendedAt, suspendReason: studyGroup.suspendReason })
    .from(studyGroup)
    .where(eq(studyGroup.id, ch.groupId))
    .limit(1);
  return { channel: ch, member, group: grp ?? null };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadContext(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const beforeId = url.searchParams.get('before');
  const limitParam = Number(url.searchParams.get('limit') ?? 50);
  const limit = Math.min(Math.max(limitParam, 1), LIST_LIMIT_MAX);

  // Nếu có cursor `before`, lấy createdAt của message đó để filter
  let beforeDate: Date | null = null;
  if (beforeId) {
    const [cursor] = await db
      .select({ createdAt: studyGroupMessage.createdAt })
      .from(studyGroupMessage)
      .where(eq(studyGroupMessage.id, beforeId))
      .limit(1);
    if (cursor) beforeDate = cursor.createdAt;
  }

  const rows = await db
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
      threadCount: studyGroupMessage.threadCount,
      threadLastAt: studyGroupMessage.threadLastAt,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(
      beforeDate
        ? and(
            eq(studyGroupMessage.channelId, channelId),
            lt(studyGroupMessage.createdAt, beforeDate),
            // Exclude thread replies — chỉ trả root message
            isNull(studyGroupMessage.threadRootId),
          )
        : and(
            eq(studyGroupMessage.channelId, channelId),
            isNull(studyGroupMessage.threadRootId),
          ),
    )
    .orderBy(desc(studyGroupMessage.createdAt))
    .limit(limit);

  // Reverse để client render từ cũ → mới
  const messages = rows.reverse();
  const hasMore = rows.length === limit;

  return NextResponse.json({ messages, hasMore });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadContext(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { channel, member, group } = ctx;

  // Phase 2 admin moderation gate — group bị admin suspend thì chặn gửi mới.
  // Read (GET) vẫn cho phép để member thấy lịch sử + suspension notice.
  if (group?.suspendedAt) {
    return NextResponse.json(
      {
        error: 'Group đang bị suspend bởi admin',
        suspendReason: group.suspendReason,
      },
      { status: 423 },
    );
  }

  // ANNOUNCEMENT: chỉ ADMIN+ post. VOICE/STAGE: cho phép — phiên chat
  // ephemeral cũ đã thay bằng persistent (Discord-style voice channel chat).
  // Message lưu vào DB, AI mention support qua /ai-reply.
  if (channel.type === 'ANNOUNCEMENT') {
    if (!can(member.role as GroupRole, 'group.update-meta')) {
      return NextResponse.json(
        { error: 'Channel ANNOUNCEMENT chỉ ADMIN+ post' },
        { status: 403 },
      );
    }
  } else if (!can(member.role as GroupRole, 'message.send')) {
    return NextResponse.json({ error: 'Không có quyền gửi message' }, { status: 403 });
  }

  if (isMuted(member)) {
    return NextResponse.json({ error: 'Bạn đang bị mute trong group' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Slow mode: check msg cuối cùng của user
  if (channel.slowModeSeconds && channel.slowModeSeconds > 0) {
    const [lastMsg] = await db
      .select({ createdAt: studyGroupMessage.createdAt })
      .from(studyGroupMessage)
      .where(
        and(
          eq(studyGroupMessage.channelId, channelId),
          eq(studyGroupMessage.authorId, session.user.id),
        ),
      )
      .orderBy(desc(studyGroupMessage.createdAt))
      .limit(1);
    if (lastMsg) {
      const elapsed = (Date.now() - lastMsg.createdAt.getTime()) / 1000;
      if (elapsed < channel.slowModeSeconds) {
        const wait = Math.ceil(channel.slowModeSeconds - elapsed);
        return NextResponse.json(
          { error: `Slow mode — chờ ${wait}s nữa`, retryAfter: wait },
          { status: 429 },
        );
      }
    }
  }

  // Parse mention từ content nếu client không gửi sẵn (auto-detect @[name](id) syntax)
  const mentions = parsed.data.mentions ?? parseMentions(parsed.data.content);

  // FORUM channel: root post (không có replyToId) BẮT BUỘC có title.
  // Reply trong thread thì không cần title (chỉ content).
  const isForumPost =
    channel.type === 'FORUM' && !parsed.data.replyToId;
  if (channel.type === 'FORUM' && isForumPost && !parsed.data.title?.trim()) {
    return NextResponse.json(
      { error: 'Forum post cần tiêu đề' },
      { status: 400 },
    );
  }

  // Insert message
  const [created] = await db
    .insert(studyGroupMessage)
    .values({
      channelId,
      authorId: session.user.id,
      content: parsed.data.content ?? '',
      replyToId: parsed.data.replyToId ?? null,
      attachments: parsed.data.attachments && parsed.data.attachments.length > 0
        ? parsed.data.attachments
        : null,
      mentions: mentions.length > 0 ? mentions : null,
      title: isForumPost ? parsed.data.title?.trim() ?? null : null,
      tags:
        isForumPost && parsed.data.tags && parsed.data.tags.length > 0
          ? parsed.data.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)
          : null,
      // Forum post tự coi là root → threadLastAt = createdAt để sort đúng ngay từ đầu
      threadLastAt: isForumPost ? new Date() : null,
    })
    .returning();
  if (!created) {
    return NextResponse.json({ error: 'Tạo message thất bại' }, { status: 500 });
  }

  // Broadcast — fire-and-forget. Outbox pattern T2+ (xem plan §8.7.3).
  const payload = {
    id: created.id,
    channelId: created.channelId,
    authorId: created.authorId,
    authorName: session.user.name,
    authorImage: session.user.image,
    content: created.content,
    contentType: created.contentType,
    replyToId: created.replyToId,
    attachments: created.attachments,
    reactions: created.reactions,
    mentions: created.mentions,
    pinned: created.pinned,
    editedAt: created.editedAt,
    deletedAt: created.deletedAt,
    createdAt: created.createdAt,
  };
  void triggerEvent(`private-channel-${channelId}`, 'message:new', payload);
  // Bắn thêm 1 event mỏng tới presence-group để UI khác (sidebar) update unread
  // badge không cần subscribe từng channel.
  void triggerEvent(`presence-group-${channel.groupId}`, 'message:new-in-channel', {
    channelId,
    authorId: created.authorId,
    messageId: created.id,
  });

  // Mention push: fire-and-forget. V2 sẽ chuyển BullMQ queue.
  if (mentions.length > 0) {
    void fireMentionEvents({
      groupId: channel.groupId,
      channelId,
      channelName: channel.name,
      messageId: created.id,
      authorId: session.user.id,
      authorName: session.user.name ?? 'Người dùng',
      mentions,
      content: created.content,
    });
  }

  // AI Tutor mention: client tự fire POST /ai-reply sau response — tránh
  // fire-and-forget không reliable trong serverless (xem ai-reply route.ts).

  return NextResponse.json({ message: payload }, { status: 201 });
}
