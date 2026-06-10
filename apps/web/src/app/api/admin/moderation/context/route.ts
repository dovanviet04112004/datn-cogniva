/**
 * GET /api/admin/moderation/context?type=X&id=Y — lấy context xung quanh 1 target.
 *
 * Phase 2 V1 support:
 *   - type='ai_message'    → 2 msg trước + 2 msg sau trong cùng conversation
 *   - type='group_message' → 2 msg trước + 2 msg sau trong cùng channel
 *   - type='message'       → alias group_message (legacy)
 *
 * Trả về thread snippet để admin nhanh chóng hiểu context, không phải xem
 * toàn bộ conversation. Mỗi message kèm author info.
 */
import { NextResponse } from 'next/server';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';

import {
  db,
  message,
  studyGroupChannel,
  studyGroupMessage,
  user,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTEXT_WINDOW = 2; // 2 trước + 2 sau

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const id = url.searchParams.get('id') ?? '';

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const normalized = type === 'message' ? 'group_message' : type;

  if (normalized === 'ai_message') {
    return aiMessageContext(id);
  }
  if (normalized === 'group_message') {
    return groupMessageContext(id);
  }
  return NextResponse.json(
    {
      error: `targetType=${type} chưa support context. Hiện support: ai_message, group_message, message.`,
    },
    { status: 400 },
  );
}

/**
 * AI conversation message context — bảng `message`, scope theo conversationId.
 */
async function aiMessageContext(id: string) {
  const [target] = await db
    .select()
    .from(message)
    .where(eq(message.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  const [before, after] = await Promise.all([
    db
      .select({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })
      .from(message)
      .where(
        and(
          eq(message.conversationId, target.conversationId),
          lt(message.createdAt, target.createdAt),
        ),
      )
      .orderBy(desc(message.createdAt))
      .limit(CONTEXT_WINDOW),
    db
      .select({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })
      .from(message)
      .where(
        and(
          eq(message.conversationId, target.conversationId),
          gt(message.createdAt, target.createdAt),
        ),
      )
      .orderBy(asc(message.createdAt))
      .limit(CONTEXT_WINDOW),
  ]);

  const items = [
    ...before.reverse().map((m) => ({ ...m, isTarget: false })),
    {
      id: target.id,
      role: target.role,
      content: target.content,
      createdAt: target.createdAt,
      isTarget: true,
    },
    ...after.map((m) => ({ ...m, isTarget: false })),
  ];

  return NextResponse.json({
    type: 'ai_message',
    conversationId: target.conversationId,
    items: items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

/**
 * Group chat message context — bảng `study_group_message`, scope theo channelId.
 */
async function groupMessageContext(id: string) {
  const [target] = await db
    .select()
    .from(studyGroupMessage)
    .where(eq(studyGroupMessage.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  const [channel] = await db
    .select({ name: studyGroupChannel.name, groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, target.channelId))
    .limit(1);

  const baseSelect = {
    id: studyGroupMessage.id,
    authorId: studyGroupMessage.authorId,
    authorName: user.name,
    authorEmail: user.email,
    content: studyGroupMessage.content,
    createdAt: studyGroupMessage.createdAt,
  };

  const [before, after] = await Promise.all([
    db
      .select(baseSelect)
      .from(studyGroupMessage)
      .leftJoin(user, eq(user.id, studyGroupMessage.authorId))
      .where(
        and(
          eq(studyGroupMessage.channelId, target.channelId),
          lt(studyGroupMessage.createdAt, target.createdAt),
        ),
      )
      .orderBy(desc(studyGroupMessage.createdAt))
      .limit(CONTEXT_WINDOW),
    db
      .select(baseSelect)
      .from(studyGroupMessage)
      .leftJoin(user, eq(user.id, studyGroupMessage.authorId))
      .where(
        and(
          eq(studyGroupMessage.channelId, target.channelId),
          gt(studyGroupMessage.createdAt, target.createdAt),
        ),
      )
      .orderBy(asc(studyGroupMessage.createdAt))
      .limit(CONTEXT_WINDOW),
  ]);

  const [targetWithAuthor] = await db
    .select(baseSelect)
    .from(studyGroupMessage)
    .leftJoin(user, eq(user.id, studyGroupMessage.authorId))
    .where(eq(studyGroupMessage.id, id))
    .limit(1);

  const items = [
    ...before.reverse().map((m) => ({ ...m, isTarget: false })),
    ...(targetWithAuthor ? [{ ...targetWithAuthor, isTarget: true }] : []),
    ...after.map((m) => ({ ...m, isTarget: false })),
  ];

  return NextResponse.json({
    type: 'group_message',
    channelId: target.channelId,
    channelName: channel?.name ?? null,
    groupId: channel?.groupId ?? null,
    items: items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}
